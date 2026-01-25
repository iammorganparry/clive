import type { ChildProcess } from "node:child_process";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import { expect, vi } from "vitest";
import {
  createMockChildProcess,
  createMockTokenBudgetService,
} from "../../../../__tests__/mock-factories";
import {
  createMockVSCodeServiceLayer,
  type createVSCodeMock,
} from "../../../../__tests__/mock-factories/index.js";
import { APPROVAL } from "../../hitl-utils.js";
import { ToolCallAbortRegistry } from "../../tool-call-abort-registry";
import type { BashExecuteInput, BashExecuteOutput } from "../../types";
import {
  createBashExecuteTool,
  isReadOnlyCommand,
  type SpawnFn,
} from "../bash-execute";
import { executeTool } from "./test-helpers";

// Mock vscode globally for tools that use VSCodeService.Default internally
vi.mock("vscode", async () => {
  const { createVSCodeMock } = await import(
    "../../../../__tests__/mock-factories/vscode-mock.js"
  );
  return createVSCodeMock();
});

describe("bashExecuteTool", () => {
  let _mockVSCodeServiceLayer: ReturnType<
    typeof createMockVSCodeServiceLayer
  >["layer"];
  let _mockVscode: ReturnType<typeof createVSCodeMock>;
  let mockSpawn: ReturnType<typeof vi.fn<SpawnFn>>;
  let streamingCallback:
    | ((chunk: { command: string; output: string }) => void)
    | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    streamingCallback = undefined;
    mockSpawn = vi.fn<SpawnFn>();

    // Create mock VSCodeService layer
    const { layer, mockVscode: vsMock } = createMockVSCodeServiceLayer();
    _mockVSCodeServiceLayer = layer;
    _mockVscode = vsMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Command Validation", () => {
    it.effect("should reject blocked commands", () =>
      Effect.gen(function* () {
        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(mockBudget, undefined, mockSpawn);
        const blockedCommands = [
          "rm file.txt",
          "mv old new",
          "sudo apt update",
          "curl http://example.com",
          "kill 1234",
          "npm install package",
        ];

        for (const command of blockedCommands) {
          const input: BashExecuteInput = { command };
          const promise = executeTool(tool, input, {} as BashExecuteOutput);
          const result = yield* Effect.exit(Effect.promise(() => promise));

          expect(Exit.isFailure(result)).toBe(true);
          if (Exit.isFailure(result)) {
            const error = Cause.squash(result.cause);
            expect(error instanceof Error && error.message).toContain(
              "Command not allowed",
            );
          }
        }
      }),
    );

    it.effect("should allow safe commands", () =>
      Effect.gen(function* () {
        const mockBudget = yield* Effect.sync(() =>
          createMockTokenBudgetService(),
        );
        const tool = yield* Effect.sync(() =>
          createBashExecuteTool(mockBudget, undefined, mockSpawn),
        );

        // Mock successful command execution
        yield* Effect.sync(() => {
          const child = createMockChildProcess({
            onClose: (handler) => {
              setTimeout(() => (handler as (code: number) => void)(0), 10);
            },
          });
          mockSpawn.mockReturnValue(child as unknown as ChildProcess);
        });

        const input: BashExecuteInput = { command: "echo hello" };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);
        yield* Effect.promise(() => promise);

        yield* Effect.sync(() => {
          expect(mockSpawn).toHaveBeenCalled();
        });
      }),
    );
  });

  describe("Command Execution", () => {
    it.effect("should execute valid commands successfully", () =>
      Effect.gen(function* () {
        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(mockBudget, undefined, mockSpawn);
        let stdoutHandler: ((data: Buffer) => void) | undefined;
        let closeHandler: ((code: number) => void) | undefined;

        const mockChild = createMockChildProcess({
          onStdoutData: (handler) => {
            stdoutHandler = handler;
          },
          onClose: (handler) => {
            closeHandler = handler as (code: number) => void;
          },
        });
        mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

        const input: BashExecuteInput = { command: "echo test" };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

        // Wait for handlers to be registered
        yield* Effect.promise(() => Promise.resolve());

        // Simulate stdout data
        if (stdoutHandler) {
          stdoutHandler(Buffer.from("test output\n"));
        }

        // Simulate process completion
        if (closeHandler) {
          closeHandler(0);
        }

        const result = yield* Effect.promise(() => promise);
        expect(result.stdout).toContain("test");
        expect(result.exitCode).toBe(0);
      }),
    );

    it.effect("should handle stderr output", () =>
      Effect.gen(function* () {
        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(mockBudget, undefined, mockSpawn);
        let _stdoutHandler: ((data: Buffer) => void) | undefined;
        let stderrHandler: ((data: Buffer) => void) | undefined;
        let closeHandler: ((code: number) => void) | undefined;

        const mockChild = createMockChildProcess({
          onStdoutData: (handler) => {
            _stdoutHandler = handler;
          },
          onStderrData: (handler) => {
            stderrHandler = handler;
          },
          onClose: (handler) => {
            closeHandler = handler as (code: number) => void;
          },
        });
        mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

        const input: BashExecuteInput = { command: "command-with-error" };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

        // Wait for handlers to be registered
        yield* Effect.promise(() => Promise.resolve());

        // Simulate stderr
        if (stderrHandler) {
          stderrHandler(Buffer.from("error message\n"));
        }

        // Simulate process completion
        if (closeHandler) {
          closeHandler(1);
        }

        const result = yield* Effect.promise(() => promise);
        expect(result.stderr).toContain("error message");
        expect(result.exitCode).toBe(1);
      }),
    );

    it.effect("should handle command execution errors", () =>
      Effect.gen(function* () {
        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(mockBudget, undefined, mockSpawn);
        let errorHandler: ((error: Error) => void) | undefined;

        const mockChild = createMockChildProcess({
          onError: (handler) => {
            errorHandler = handler as (error: Error) => void;
          },
        });
        mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

        const input: BashExecuteInput = { command: "invalid-command" };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

        // Wait for handlers to be registered
        yield* Effect.promise(() => Promise.resolve());

        // Simulate process error
        if (errorHandler) {
          errorHandler(new Error("Command not found"));
        }

        const result = yield* Effect.exit(Effect.promise(() => promise));
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const error = Cause.squash(result.cause);
          expect(error instanceof Error && error.message).toContain(
            "Command execution failed",
          );
        }
      }),
    );
  });

  describe("Timeout Handling", () => {
    it.effect("should timeout long-running commands", () =>
      Effect.gen(function* () {
        // Setup fake timers
        yield* Effect.sync(() => vi.useFakeTimers());

        try {
          const mockBudget = yield* Effect.sync(() =>
            createMockTokenBudgetService(),
          );
          const tool = yield* Effect.sync(() =>
            createBashExecuteTool(mockBudget, undefined, mockSpawn),
          );

          const mockChild = yield* Effect.sync(() => {
            const child = createMockChildProcess();
            mockSpawn.mockReturnValue(child as unknown as ChildProcess);
            return child;
          });

          const input: BashExecuteInput = { command: "sleep 100" };

          // Create promise - executeTool returns a Promise
          const promise = executeTool(tool, input, {} as BashExecuteOutput);

          // Attach catch handler immediately to prevent unhandled rejection
          promise.catch(() => {
            // Error is expected, ignore it here
          });

          // Advance fake timers - this will trigger the timeout
          yield* Effect.promise(() => vi.advanceTimersByTimeAsync(30001));

          // Wait for promise to settle and check result
          const result = yield* Effect.exit(Effect.promise(() => promise));

          yield* Effect.sync(() => {
            expect(Exit.isFailure(result)).toBe(true);
            if (Exit.isFailure(result)) {
              const error = Cause.squash(result.cause);
              expect(error instanceof Error && error.message).toContain(
                "timed out",
              );
            }
            expect(mockChild.kill).toHaveBeenCalled();
          });
        } finally {
          // Cleanup fake timers
          yield* Effect.sync(() => {
            vi.runAllTimersAsync();
            vi.useRealTimers();
          });
        }
      }),
    );
  });

  describe("Streaming Output", () => {
    it.effect("should call streaming callback with output chunks", () =>
      Effect.gen(function* () {
        const streamingChunks: Array<{ command: string; output: string }> = [];
        streamingCallback = (chunk) => {
          streamingChunks.push(chunk);
        };

        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(
          mockBudget,
          streamingCallback,
          mockSpawn,
        );
        let stdoutHandler: ((data: Buffer) => void) | undefined;
        let closeHandler: ((code: number) => void) | undefined;

        const mockChild = createMockChildProcess({
          onStdoutData: (handler) => {
            stdoutHandler = handler;
          },
          onClose: (handler) => {
            closeHandler = handler as (code: number) => void;
          },
        });
        mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

        const input: BashExecuteInput = { command: "echo line1 && echo line2" };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

        // Wait for handlers to be registered
        yield* Effect.promise(() => Promise.resolve());

        // Simulate streaming output
        if (stdoutHandler) {
          stdoutHandler(Buffer.from("line1\n"));
          stdoutHandler(Buffer.from("line2\n"));
        }

        // Simulate process completion
        if (closeHandler) {
          closeHandler(0);
        }

        yield* Effect.promise(() => promise);

        // Streaming callback should be called with chunks
        expect(streamingChunks.length).toBeGreaterThan(0);
        expect(
          streamingChunks.some((chunk) => chunk.output.includes("line1")),
        ).toBe(true);
      }),
    );

    it.effect("should emit remaining output on completion", () =>
      Effect.gen(function* () {
        const streamingChunks: Array<{ command: string; output: string }> = [];
        streamingCallback = (chunk) => {
          streamingChunks.push(chunk);
        };

        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(
          mockBudget,
          streamingCallback,
          mockSpawn,
        );
        let stdoutHandler: ((data: Buffer) => void) | undefined;
        let closeHandler: ((code: number) => void) | undefined;

        const mockChild = createMockChildProcess({
          onStdoutData: (handler) => {
            stdoutHandler = handler;
          },
          onClose: (handler) => {
            closeHandler = handler as (code: number) => void;
          },
        });
        mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

        const input: BashExecuteInput = { command: "printf 'partial'" };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

        // Wait for handlers to be registered
        yield* Effect.promise(() => Promise.resolve());

        // Simulate partial output (no newline)
        if (stdoutHandler) {
          stdoutHandler(Buffer.from("partial"));
        }

        // Simulate process completion
        if (closeHandler) {
          closeHandler(0);
        }

        yield* Effect.promise(() => promise);

        // Should emit remaining output on close
        expect(streamingChunks.length).toBeGreaterThan(0);
      }),
    );

    it.effect(
      "should emit command with streaming output for test commands",
      () =>
        Effect.gen(function* () {
          const streamingChunks: Array<{ command: string; output: string }> =
            [];
          streamingCallback = (chunk) => {
            streamingChunks.push(chunk);
          };

          const mockBudget = createMockTokenBudgetService();
          const tool = createBashExecuteTool(
            mockBudget,
            streamingCallback,
            mockSpawn,
          );
          let stdoutHandler: ((data: Buffer) => void) | undefined;
          let closeHandler: ((code: number) => void) | undefined;

          const mockChild = createMockChildProcess({
            onStdoutData: (handler) => {
              stdoutHandler = handler;
            },
            onClose: (handler) => {
              closeHandler = handler as (code: number) => void;
            },
          });
          mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

          const testCommand = "vitest run test.spec.ts";
          const input: BashExecuteInput = { command: testCommand };
          const promise = executeTool(tool, input, {} as BashExecuteOutput);

          // Wait for handlers to be registered
          yield* Effect.promise(() => Promise.resolve());

          // Simulate test output streaming
          if (stdoutHandler) {
            stdoutHandler(Buffer.from("✓ test1 (100ms)\n"));
            stdoutHandler(Buffer.from("✓ test2 (200ms)\n"));
          }

          // Simulate process completion
          if (closeHandler) {
            closeHandler(0);
          }

          yield* Effect.promise(() => promise);

          // Verify streaming chunks include the command
          expect(streamingChunks.length).toBeGreaterThan(0);
          expect(
            streamingChunks.every((chunk) => chunk.command === testCommand),
          ).toBe(true);
          expect(
            streamingChunks.some((chunk) => chunk.output.includes("test1")),
          ).toBe(true);
          expect(
            streamingChunks.some((chunk) => chunk.output.includes("test2")),
          ).toBe(true);
        }),
    );

    it.effect("should stream vitest output in proper format", () =>
      Effect.gen(function* () {
        const streamingChunks: Array<{ command: string; output: string }> = [];
        streamingCallback = (chunk) => {
          streamingChunks.push(chunk);
        };

        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(
          mockBudget,
          streamingCallback,
          mockSpawn,
        );
        let stdoutHandler: ((data: Buffer) => void) | undefined;
        let closeHandler: ((code: number) => void) | undefined;

        const mockChild = createMockChildProcess({
          onStdoutData: (handler) => {
            stdoutHandler = handler;
          },
          onClose: (handler) => {
            closeHandler = handler as (code: number) => void;
          },
        });
        mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

        const testCommand = "npx vitest run src/utils.test.ts";
        const input: BashExecuteInput = { command: testCommand };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

        // Wait for handlers to be registered
        yield* Effect.promise(() => Promise.resolve());

        // Simulate realistic vitest output with incremental streaming
        if (stdoutHandler) {
          stdoutHandler(Buffer.from("✓ should validate input (50ms)\n"));
          stdoutHandler(Buffer.from("✓ should handle errors (30ms)\n"));
          stdoutHandler(Buffer.from("✗ should fail gracefully (20ms)\n"));
          stdoutHandler(Buffer.from("  Error: Expected true but got false\n"));
        }

        // Simulate process completion
        if (closeHandler) {
          closeHandler(1); // Exit code 1 for failures
        }

        yield* Effect.promise(() => promise);

        // Verify structure of streaming chunks
        expect(streamingChunks.length).toBeGreaterThan(0);
        for (const chunk of streamingChunks) {
          expect(chunk).toHaveProperty("command");
          expect(chunk).toHaveProperty("output");
          expect(chunk.command).toBe(testCommand);
          expect(typeof chunk.output).toBe("string");
        }
      }),
    );

    it.effect("should stream jest output with correct format", () =>
      Effect.gen(function* () {
        const streamingChunks: Array<{ command: string; output: string }> = [];
        streamingCallback = (chunk) => {
          streamingChunks.push(chunk);
        };

        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(
          mockBudget,
          streamingCallback,
          mockSpawn,
        );
        let stdoutHandler: ((data: Buffer) => void) | undefined;
        let closeHandler: ((code: number) => void) | undefined;

        const mockChild = createMockChildProcess({
          onStdoutData: (handler) => {
            stdoutHandler = handler;
          },
          onClose: (handler) => {
            closeHandler = handler as (code: number) => void;
          },
        });
        mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

        const testCommand = "jest test auth.test.js";
        const input: BashExecuteInput = { command: testCommand };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

        // Wait for handlers to be registered
        yield* Effect.promise(() => Promise.resolve());

        // Simulate jest output
        if (stdoutHandler) {
          stdoutHandler(Buffer.from("PASS tests/auth.test.js\n"));
          stdoutHandler(
            Buffer.from("  ✓ login with valid credentials (100ms)\n"),
          );
          stdoutHandler(Buffer.from("  ✓ logout (50ms)\n"));
        }

        // Simulate process completion
        if (closeHandler) {
          closeHandler(0);
        }

        yield* Effect.promise(() => promise);

        // Verify streaming chunks contain command and parseable test output
        expect(streamingChunks.length).toBeGreaterThan(0);
        const allOutput = streamingChunks.map((c) => c.output).join("");
        expect(allOutput).toContain("login with valid credentials");
        expect(allOutput).toContain("logout");
      }),
    );
  });

  describe("Token Budget Integration", () => {
    it.effect("should truncate output when exceeding budget", () =>
      Effect.gen(function* () {
        const mockBudget = createMockTokenBudgetService();
        const largeOutput = "x".repeat(100000);
        mockBudget.truncateToFit = vi.fn(() =>
          Effect.succeed({
            content: largeOutput.substring(0, 1000),
            wasTruncated: true,
          }),
        );

        const tool = createBashExecuteTool(mockBudget, undefined, mockSpawn);
        let stdoutHandler: ((data: Buffer) => void) | undefined;
        let closeHandler: ((code: number) => void) | undefined;

        const mockChild = createMockChildProcess({
          onStdoutData: (handler) => {
            stdoutHandler = handler;
          },
          onClose: (handler) => {
            closeHandler = handler as (code: number) => void;
          },
        });
        mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

        const input: BashExecuteInput = { command: "generate-large-output" };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

        // Wait for handlers to be registered
        yield* Effect.promise(() => Promise.resolve());

        // Simulate large output
        if (stdoutHandler) {
          stdoutHandler(Buffer.from(largeOutput));
        }

        // Simulate process completion
        if (closeHandler) {
          closeHandler(0);
        }

        const result = yield* Effect.promise(() => promise);
        expect(result.wasTruncated).toBe(true);
        expect(mockBudget.truncateToFit).toHaveBeenCalled();
        expect(mockBudget.consume).toHaveBeenCalled();
      }),
    );

    it.effect("should consume tokens for output", () =>
      Effect.gen(function* () {
        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(mockBudget, undefined, mockSpawn);
        let stdoutHandler: ((data: Buffer) => void) | undefined;
        let closeHandler: ((code: number) => void) | undefined;

        const mockChild = createMockChildProcess({
          onStdoutData: (handler) => {
            stdoutHandler = handler;
          },
          onClose: (handler) => {
            closeHandler = handler as (code: number) => void;
          },
        });
        mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

        const input: BashExecuteInput = { command: "echo test" };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

        // Wait for handlers to be registered
        yield* Effect.promise(() => Promise.resolve());

        // Simulate output
        if (stdoutHandler) {
          stdoutHandler(Buffer.from("test output\n"));
        }

        // Simulate process completion
        if (closeHandler) {
          closeHandler(0);
        }

        yield* Effect.promise(() => promise);

        expect(mockBudget.truncateToFit).toHaveBeenCalled();
        expect(mockBudget.consume).toHaveBeenCalled();
      }),
    );
  });

  describe("Workspace Root", () => {
    it.effect("should execute commands from workspace root", () =>
      Effect.gen(function* () {
        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(mockBudget, undefined, mockSpawn);
        let closeHandler: ((code: number) => void) | undefined;

        const mockChild = createMockChildProcess({
          onClose: (handler) => {
            closeHandler = handler as (code: number) => void;
          },
        });
        mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

        const input: BashExecuteInput = { command: "pwd" };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

        // Wait for handlers to be registered
        yield* Effect.promise(() => Promise.resolve());

        // Simulate process completion
        if (closeHandler) {
          closeHandler(0);
        }

        yield* Effect.promise(() => promise);

        // Verify spawn was called with correct cwd
        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            cwd: "/test-workspace",
          }),
        );
      }),
    );
  });

  describe("isReadOnlyCommand", () => {
    it("should identify read-only commands", () => {
      const readOnlyCommands = [
        "cat file.txt",
        "head -n 10 file.txt",
        "tail -f file.txt",
        "grep pattern file.txt",
        "find . -name '*.ts'",
        "ls -la",
        "pwd",
        "tree",
        "wc -l file.txt",
        "diff file1 file2",
        "git status",
        "git log --oneline",
        "git diff HEAD",
        "npm list",
        "npm outdated",
      ];

      for (const cmd of readOnlyCommands) {
        expect(isReadOnlyCommand(cmd)).toBe(true);
      }
    });

    it("should identify write/modify commands", () => {
      const writeCommands = [
        "echo hello > file.txt", // Output redirection
        "cat file.txt | sort > out", // Pipe with redirection
        "npx vitest run", // Test execution
        "npm run build", // Build command
        "touch newfile.txt", // Create file
        "mkdir new-dir", // Create directory
        "git commit -m 'msg'", // Git write operation
        "git push", // Git write operation
        "printf 'text' > file.md", // Write file
      ];

      for (const cmd of writeCommands) {
        expect(isReadOnlyCommand(cmd)).toBe(false);
      }
    });

    it("should handle edge cases", () => {
      expect(isReadOnlyCommand("  cat file.txt  ")).toBe(true); // Whitespace
      expect(isReadOnlyCommand("CAT file.txt")).toBe(false); // Case sensitive
      expect(isReadOnlyCommand("grep > output.txt pattern")).toBe(false); // Redirect
    });
  });

  describe("Approval Flow", () => {
    it.effect(
      "should execute read-only commands without approval when setting is 'always'",
      () =>
        Effect.gen(function* () {
          const mockBudget = createMockTokenBudgetService();
          const getApprovalSetting = () => Effect.succeed("always" as const);
          const waitForApproval = vi.fn();

          const tool = createBashExecuteTool(
            mockBudget,
            undefined,
            mockSpawn,
            waitForApproval,
            getApprovalSetting,
          );

          // Mock successful command execution
          yield* Effect.sync(() => {
            const child = createMockChildProcess({
              onClose: (handler) => {
                setTimeout(() => (handler as (code: number) => void)(0), 10);
              },
            });
            mockSpawn.mockReturnValue(child as unknown as ChildProcess);
          });

          const input: BashExecuteInput = { command: "cat file.txt" };
          const promise = executeTool(tool, input, {} as BashExecuteOutput);
          yield* Effect.promise(() => promise);

          yield* Effect.sync(() => {
            expect(waitForApproval).not.toHaveBeenCalled();
          });
        }),
    );

    it.effect(
      "should wait for approval for write commands when setting is 'always'",
      () =>
        Effect.gen(function* () {
          const mockBudget = createMockTokenBudgetService();
          const getApprovalSetting = () => Effect.succeed("always" as const);
          const waitForApproval = vi.fn().mockResolvedValue(APPROVAL.YES);

          const tool = createBashExecuteTool(
            mockBudget,
            undefined,
            mockSpawn,
            waitForApproval,
            getApprovalSetting,
          );

          // Mock successful command execution
          yield* Effect.sync(() => {
            const child = createMockChildProcess({
              onClose: (handler) => {
                setTimeout(() => (handler as (code: number) => void)(0), 10);
              },
            });
            mockSpawn.mockReturnValue(child as unknown as ChildProcess);
          });

          const input: BashExecuteInput = { command: "npx vitest run" };
          const promise = executeTool(tool, input, {} as BashExecuteOutput);
          yield* Effect.promise(() => promise);

          yield* Effect.sync(() => {
            expect(waitForApproval).toHaveBeenCalled();
          });
        }),
    );

    it.effect("should reject command when approval is denied", () =>
      Effect.gen(function* () {
        const mockBudget = createMockTokenBudgetService();
        const getApprovalSetting = () => Effect.succeed("always" as const);
        const waitForApproval = vi.fn().mockResolvedValue(APPROVAL.NO);

        const tool = createBashExecuteTool(
          mockBudget,
          undefined,
          mockSpawn,
          waitForApproval,
          getApprovalSetting,
        );

        const input: BashExecuteInput = { command: "npx vitest run" };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);
        const result = yield* Effect.exit(Effect.promise(() => promise));

        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const error = Cause.squash(result.cause);
          expect(
            error instanceof Error && error.message.includes("denied"),
          ).toBe(true);
        }
      }),
    );

    it.effect("should not require approval when setting is 'auto'", () =>
      Effect.gen(function* () {
        const mockBudget = createMockTokenBudgetService();
        const getApprovalSetting = () => Effect.succeed("auto" as const);
        const waitForApproval = vi.fn();

        const tool = createBashExecuteTool(
          mockBudget,
          undefined,
          mockSpawn,
          waitForApproval,
          getApprovalSetting,
        );

        // Mock successful command execution
        yield* Effect.sync(() => {
          const child = createMockChildProcess({
            onClose: (handler) => {
              setTimeout(() => (handler as (code: number) => void)(0), 10);
            },
          });
          mockSpawn.mockReturnValue(child as unknown as ChildProcess);
        });

        const input: BashExecuteInput = { command: "npx vitest run" };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);
        yield* Effect.promise(() => promise);

        yield* Effect.sync(() => {
          expect(waitForApproval).not.toHaveBeenCalled();
        });
      }),
    );
  });

  describe("abort handling", () => {
    it.effect("should register toolCallId with ToolCallAbortRegistry", () =>
      Effect.gen(function* () {
        const mockBudget = yield* Effect.sync(() =>
          createMockTokenBudgetService(),
        );
        const child = yield* Effect.sync(() =>
          createMockChildProcess({
            onClose: (handler) => {
              setTimeout(() => (handler as (code: number) => void)(0), 50);
            },
          }),
        );
        yield* Effect.sync(() =>
          mockSpawn.mockReturnValue(child as unknown as ChildProcess),
        );

        const tool = yield* Effect.sync(() =>
          createBashExecuteTool(mockBudget, undefined, mockSpawn),
        );
        const toolCallId = "test-abort-1";

        // Execute with explicit toolCallId
        if (!tool.execute) {
          yield* Effect.fail(new Error("Tool execute function is undefined"));
        }
        const executeResult = (
          tool.execute as NonNullable<typeof tool.execute>
        )({ command: "echo test" }, { toolCallId, messages: [] });
        const promise = Promise.resolve(executeResult);

        // The toolCallId should be registered while running
        yield* Effect.sync(() => {
          expect(ToolCallAbortRegistry.isRunning(toolCallId)).toBe(true);
        });

        yield* Effect.promise(() => promise);

        // After completion, it should be cleaned up
        yield* Effect.sync(() => {
          expect(ToolCallAbortRegistry.isRunning(toolCallId)).toBe(false);
        });
      }).pipe(Effect.provide(_mockVSCodeServiceLayer)),
    );

    it.effect(
      "should abort command when ToolCallAbortRegistry.abort is called",
      () =>
        Effect.gen(function* () {
          const mockBudget = yield* Effect.sync(() =>
            createMockTokenBudgetService(),
          );
          let killCalled = false;

          const child = yield* Effect.sync(() =>
            createMockChildProcess({
              kill: () => {
                killCalled = true;
                return true;
              },
              // Don't auto-close - we'll abort instead
            }),
          );
          yield* Effect.sync(() =>
            mockSpawn.mockReturnValue(child as unknown as ChildProcess),
          );

          const tool = yield* Effect.sync(() =>
            createBashExecuteTool(mockBudget, undefined, mockSpawn),
          );
          const toolCallId = "test-abort-2";

          if (!tool.execute) {
            yield* Effect.fail(new Error("Tool execute function is undefined"));
          }
          const executeResult = (
            tool.execute as NonNullable<typeof tool.execute>
          )({ command: "sleep 100" }, { toolCallId, messages: [] });
          const promise = Promise.resolve(executeResult);

          // Abort after a short delay
          yield* Effect.sync(() => {
            setTimeout(() => {
              ToolCallAbortRegistry.abort(toolCallId);
            }, 10);
          });

          const result = yield* Effect.exit(Effect.promise(() => promise));

          yield* Effect.sync(() => {
            // Cancellation now resolves with a cancelled result instead of rejecting
            expect(Exit.isSuccess(result)).toBe(true);
            if (Exit.isSuccess(result)) {
              const output = result.value as {
                cancelled?: boolean;
                message?: string;
              };
              expect(output.cancelled).toBe(true);
              expect(output.message).toContain("cancelled");
            }
            expect(killCalled).toBe(true);
          });
        }).pipe(Effect.provide(_mockVSCodeServiceLayer)),
    );

    it.effect("should use AI SDK provided toolCallId from options", () =>
      Effect.gen(function* () {
        const mockBudget = yield* Effect.sync(() =>
          createMockTokenBudgetService(),
        );
        const child = yield* Effect.sync(() =>
          createMockChildProcess({
            onClose: (handler) => {
              setTimeout(() => (handler as (code: number) => void)(0), 10);
            },
          }),
        );
        yield* Effect.sync(() =>
          mockSpawn.mockReturnValue(child as unknown as ChildProcess),
        );

        const tool = yield* Effect.sync(() =>
          createBashExecuteTool(mockBudget, undefined, mockSpawn),
        );
        const aiSdkToolCallId = "toolu_01ABC123";

        if (!tool.execute) {
          yield* Effect.fail(new Error("Tool execute function is undefined"));
        }
        const executeResult = (
          tool.execute as NonNullable<typeof tool.execute>
        )(
          { command: "echo test" },
          { toolCallId: aiSdkToolCallId, messages: [] },
        );
        const promise = Promise.resolve(executeResult);

        // Should be registered with the AI SDK's toolCallId
        yield* Effect.sync(() => {
          expect(ToolCallAbortRegistry.isRunning(aiSdkToolCallId)).toBe(true);
        });

        yield* Effect.promise(() => promise);
      }).pipe(Effect.provide(_mockVSCodeServiceLayer)),
    );

    it.effect(
      "should reject immediately if stream signal is already aborted before execution",
      () =>
        Effect.gen(function* () {
          const mockBudget = yield* Effect.sync(() =>
            createMockTokenBudgetService(),
          );
          const child = yield* Effect.sync(() =>
            createMockChildProcess({
              onClose: (handler) => {
                setTimeout(() => (handler as (code: number) => void)(0), 10);
              },
            }),
          );
          yield* Effect.sync(() =>
            mockSpawn.mockReturnValue(child as unknown as ChildProcess),
          );

          // Create an already-aborted signal
          const abortController = new AbortController();
          abortController.abort();

          const tool = yield* Effect.sync(() =>
            createBashExecuteTool(
              mockBudget,
              undefined,
              mockSpawn,
              undefined,
              undefined,
              abortController.signal,
            ),
          );
          const toolCallId = "test-pre-aborted-signal";

          if (!tool.execute) {
            yield* Effect.fail(new Error("Tool execute function is undefined"));
          }
          const executeResult = (
            tool.execute as NonNullable<typeof tool.execute>
          )({ command: "echo test" }, { toolCallId, messages: [] });
          const promise = Promise.resolve(executeResult);

          const result = yield* Effect.exit(Effect.promise(() => promise));

          yield* Effect.sync(() => {
            expect(Exit.isFailure(result)).toBe(true);
            if (Exit.isFailure(result)) {
              const error = Cause.squash(result.cause);
              expect(error instanceof Error && error.message).toContain(
                "cancelled before execution",
              );
            }
            // Should NOT be registered since it was rejected immediately
            expect(ToolCallAbortRegistry.isRunning(toolCallId)).toBe(false);
            // Spawn should NOT have been called
            expect(mockSpawn).not.toHaveBeenCalled();
          });
        }).pipe(Effect.provide(_mockVSCodeServiceLayer)),
    );

    it.effect(
      "should reject immediately if abortAll is called right after registration",
      () =>
        Effect.gen(function* () {
          const mockBudget = yield* Effect.sync(() =>
            createMockTokenBudgetService(),
          );

          // Don't set up child to close - we want to test the abort path
          const child = yield* Effect.sync(() => createMockChildProcess());
          yield* Effect.sync(() =>
            mockSpawn.mockReturnValue(child as unknown as ChildProcess),
          );

          const tool = yield* Effect.sync(() =>
            createBashExecuteTool(mockBudget, undefined, mockSpawn),
          );

          // Register a tool and abort it before execution starts
          const toolCallId = "test-abort-during-registration";

          // First, let's abort all tools to ensure clean state
          ToolCallAbortRegistry.abortAll();

          // Now register a new tool call and immediately abort
          const controller = ToolCallAbortRegistry.register(toolCallId);
          controller.abort();
          ToolCallAbortRegistry.cleanup(toolCallId);

          // Create a new tool execution with a different ID
          const toolCallId2 = "test-abort-after-registration";

          if (!tool.execute) {
            yield* Effect.fail(new Error("Tool execute function is undefined"));
          }

          // Execute the tool
          const executeResult = (
            tool.execute as NonNullable<typeof tool.execute>
          )(
            { command: "echo test" },
            { toolCallId: toolCallId2, messages: [] },
          );
          const promise = Promise.resolve(executeResult);

          // Immediately abort after registration happens (simulating race condition)
          yield* Effect.sync(() => {
            // The tool should be running at this point
            if (ToolCallAbortRegistry.isRunning(toolCallId2)) {
              ToolCallAbortRegistry.abort(toolCallId2);
            }
          });

          yield* Effect.exit(Effect.promise(() => promise));

          yield* Effect.sync(() => {
            // Either the tool was aborted successfully, or it completed before abort
            // In either case, it should no longer be running
            expect(ToolCallAbortRegistry.isRunning(toolCallId2)).toBe(false);
          });
        }).pipe(Effect.provide(_mockVSCodeServiceLayer)),
    );

    it.effect(
      "should cleanup registry on cancellation during approval wait",
      () =>
        Effect.gen(function* () {
          const mockBudget = yield* Effect.sync(() =>
            createMockTokenBudgetService(),
          );
          const getApprovalSetting = () => Effect.succeed("always" as const);

          // Create a promise that we can control
          let rejectApproval: (reason: Error) => void;
          const waitForApproval = vi.fn(
            () =>
              new Promise<unknown>((_, reject) => {
                rejectApproval = reject;
              }),
          );

          const tool = yield* Effect.sync(() =>
            createBashExecuteTool(
              mockBudget,
              undefined,
              mockSpawn,
              waitForApproval,
              getApprovalSetting,
            ),
          );
          const toolCallId = "test-abort-during-approval";

          if (!tool.execute) {
            yield* Effect.fail(new Error("Tool execute function is undefined"));
          }
          const executeResult = (
            tool.execute as NonNullable<typeof tool.execute>
          )({ command: "npx vitest run" }, { toolCallId, messages: [] });
          const promise = Promise.resolve(executeResult);

          // Wait for approval to be requested
          yield* Effect.promise(() => Promise.resolve());

          // Abort the tool while waiting for approval
          yield* Effect.sync(() => {
            ToolCallAbortRegistry.abort(toolCallId);
            // Also reject the approval promise to simulate user cancellation
            rejectApproval(new Error("Cancelled"));
          });

          const result = yield* Effect.exit(Effect.promise(() => promise));

          yield* Effect.sync(() => {
            expect(Exit.isFailure(result)).toBe(true);
            // Registry should be cleaned up
            expect(ToolCallAbortRegistry.isRunning(toolCallId)).toBe(false);
          });
        }).pipe(Effect.provide(_mockVSCodeServiceLayer)),
    );
  });
});
