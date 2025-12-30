import { describe, expect, vi, beforeEach, afterEach } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Cause, } from "effect";
import type { ChildProcess } from "node:child_process";
import type * as vscode from "vscode";
import * as vscodeEffects from "../../../../lib/vscode-effects";
import type { BashExecuteInput, BashExecuteOutput } from "../../types";
import { createBashExecuteTool, type SpawnFn } from "../bash-execute";
import { executeTool } from "./test-helpers";
import {
    createMockChildProcess,
  createMockTokenBudgetService,
} from "../../../../__tests__/mock-factories";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Mock vscode-effects
vi.mock("../../../../lib/vscode-effects", () => ({
  getWorkspaceRoot: vi.fn(),
}));


describe("bashExecuteTool", () => {
  let mockSpawn: ReturnType<typeof vi.fn<SpawnFn>>;
  let streamingCallback: ((chunk: { command: string; output: string }) => void) | undefined;
  let testWorkspaceDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    streamingCallback = undefined;
    mockSpawn = vi.fn<SpawnFn>();

    // Create a real temp directory for OverlayFs
    testWorkspaceDir = join(tmpdir(), `clive-test-${Date.now()}`);
    mkdirSync(testWorkspaceDir, { recursive: true });

    // Mock workspace root with real directory
    vi.mocked(vscodeEffects.getWorkspaceRoot).mockReturnValue(
      Effect.succeed({
        fsPath: testWorkspaceDir,
        scheme: "file",
      } as vscode.Uri),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Command Validation", () => {
    it.effect("should reject blocked commands", () =>
      Effect.gen(function* () {
        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(mockBudget, undefined, mockSpawn);
        // Use npm/npx commands to test real shell blocking (not just-bash)
        const blockedCommands = [
          "npm run test && sudo apt update",  // sudo blocked in real shell
          "npx vitest && curl http://example.com",  // curl blocked in real shell
          "npm install && kill 1234",  // kill blocked in real shell
        ];

        for (const command of blockedCommands) {
          const input: BashExecuteInput = { command };
          const promise = executeTool(tool, input, {} as BashExecuteOutput);
          const result = yield* Effect.exit(Effect.promise(() => promise));

          expect(Exit.isFailure(result)).toBe(true);
          if (Exit.isFailure(result)) {
            const error = Cause.squash(result.cause);
            expect(error instanceof Error && error.message).toContain("Command not allowed");
          }
        }
      }),
    );

    it.effect("should allow safe commands", () =>
      Effect.gen(function* () {
        const mockBudget = yield* Effect.sync(() => createMockTokenBudgetService());
        const tool = yield* Effect.sync(() => createBashExecuteTool(mockBudget, undefined, mockSpawn));

        // Mock successful command execution for npm command (routes to real shell)
        yield* Effect.sync(() => {
          const child = createMockChildProcess({
            onClose: (handler) => {
              setTimeout(() => (handler as (code: number) => void)(0), 10);
            },
          });
          mockSpawn.mockReturnValue(child as unknown as ChildProcess);
        });

        const input: BashExecuteInput = { command: "npm run test" };  // npm routes to real shell
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

        const input: BashExecuteInput = { command: "npm run test" };  // npm routes to real shell
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

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

        const input: BashExecuteInput = { command: "npm run failing-test" };  // npm routes to real shell
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

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

        const input: BashExecuteInput = { command: "npx invalid-command" };  // npx routes to real shell
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

        // Simulate process error
        if (errorHandler) {
          errorHandler(new Error("Command not found"));
        }

        const result = yield* Effect.exit(Effect.promise(() => promise));
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const error = Cause.squash(result.cause);
          expect(error instanceof Error && error.message).toContain("Command execution failed");
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
          const mockBudget = yield* Effect.sync(() => createMockTokenBudgetService());
          const tool = yield* Effect.sync(() => createBashExecuteTool(mockBudget, undefined, mockSpawn));

          const mockChild = yield* Effect.sync(() => {
            const child = createMockChildProcess();
            mockSpawn.mockReturnValue(child as unknown as ChildProcess);
            return child;
          });

          const input: BashExecuteInput = { command: "npm run sleep-long" };  // npm routes to real shell
          
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
              expect(error instanceof Error && error.message).toContain("timed out");
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
        const tool = createBashExecuteTool(mockBudget, streamingCallback, mockSpawn);
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

        const input: BashExecuteInput = { command: "npm run multiline" };  // npm routes to real shell
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

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
        expect(streamingChunks.some((chunk) => chunk.output.includes("line1"))).toBe(true);
      }),
    );

    it.effect("should emit remaining output on completion", () =>
      Effect.gen(function* () {
        const streamingChunks: Array<{ command: string; output: string }> = [];
        streamingCallback = (chunk) => {
          streamingChunks.push(chunk);
        };

        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(mockBudget, streamingCallback, mockSpawn);
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

        const input: BashExecuteInput = { command: "npm run partial-output" };  // npm routes to real shell
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

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

    it.effect("should emit command with streaming output for test commands", () =>
      Effect.gen(function* () {
        const streamingChunks: Array<{ command: string; output: string }> = [];
        streamingCallback = (chunk) => {
          streamingChunks.push(chunk);
        };

        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(mockBudget, streamingCallback, mockSpawn);
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

        const testCommand = "npx vitest run test.spec.ts";  // npx routes to real shell
        const input: BashExecuteInput = { command: testCommand };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

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
        expect(streamingChunks.every((chunk) => chunk.command === testCommand)).toBe(true);
        expect(streamingChunks.some((chunk) => chunk.output.includes("test1"))).toBe(true);
        expect(streamingChunks.some((chunk) => chunk.output.includes("test2"))).toBe(true);
      }),
    );

    it.effect("should stream vitest output in proper format", () =>
      Effect.gen(function* () {
        const streamingChunks: Array<{ command: string; output: string }> = [];
        streamingCallback = (chunk) => {
          streamingChunks.push(chunk);
        };

        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(mockBudget, streamingCallback, mockSpawn);
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
        const tool = createBashExecuteTool(mockBudget, streamingCallback, mockSpawn);
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

        const testCommand = "npx jest test auth.test.js";  // npx routes to real shell
        const input: BashExecuteInput = { command: testCommand };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

        // Simulate jest output
        if (stdoutHandler) {
          stdoutHandler(Buffer.from("PASS tests/auth.test.js\n"));
          stdoutHandler(Buffer.from("  ✓ login with valid credentials (100ms)\n"));
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

        const input: BashExecuteInput = { command: "npx generate-large-output" };  // npx routes to real shell
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

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

        const input: BashExecuteInput = { command: "npm test" };  // npm routes to real shell
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

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

  describe("Hybrid Execution Model", () => {
    it.effect("should use just-bash sandbox for safe commands (ls)", () =>
      Effect.gen(function* () {
        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(mockBudget, undefined, mockSpawn);

        const input: BashExecuteInput = { command: "ls -la" };
        const result = yield* Effect.promise(() => executeTool(tool, input, {} as BashExecuteOutput));

        yield* Effect.sync(() => {
          // Verify mockSpawn was NOT called (just-bash doesn't use spawn)
          expect(mockSpawn).not.toHaveBeenCalled();
          // Verify we got a result (just-bash executed successfully)
          expect(result.exitCode).toBeDefined();
        });
      }),
    );

    it.effect("should use real shell for npm commands", () =>
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

        const input: BashExecuteInput = { command: "npm test" };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

        // Simulate process completion
        if (closeHandler) {
          closeHandler(0);
        }

        yield* Effect.promise(() => promise);

        yield* Effect.sync(() => {
          // Verify mockSpawn WAS called (real shell for npm)
          expect(mockSpawn).toHaveBeenCalled();
          expect(mockSpawn).toHaveBeenCalledWith(
            "npm test",
            expect.objectContaining({
              shell: true,
              cwd: testWorkspaceDir,
            }),
          );
        });
      }),
    );

    it.effect("should use real shell for npx commands", () =>
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

        const input: BashExecuteInput = { command: "npx vitest run test.spec.ts" };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

        // Simulate process completion
        if (closeHandler) {
          closeHandler(0);
        }

        yield* Effect.promise(() => promise);

        yield* Effect.sync(() => {
          // Verify mockSpawn WAS called (real shell for npx)
          expect(mockSpawn).toHaveBeenCalled();
          expect(mockSpawn).toHaveBeenCalledWith(
            "npx vitest run test.spec.ts",
            expect.objectContaining({
              shell: true,
            }),
          );
        });
      }),
    );

    it.effect("should use just-bash for cat, grep, find commands", () =>
      Effect.gen(function* () {
        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(mockBudget, undefined, mockSpawn);

        const safeCommands = [
          "cat package.json",
          "grep -r 'test' src/",
          "find . -name '*.ts'",
        ];

        for (const command of safeCommands) {
          // Clear mocks between commands
          yield* Effect.sync(() => mockSpawn.mockClear());

          const input: BashExecuteInput = { command };
          yield* Effect.promise(() => executeTool(tool, input, {} as BashExecuteOutput));

          yield* Effect.sync(() => {
            // Verify mockSpawn was NOT called (just-bash handles these)
            expect(mockSpawn).not.toHaveBeenCalled();
          });
        }
      }),
    );

    it.effect("should only validate blocked patterns for real shell commands", () =>
      Effect.gen(function* () {
        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(mockBudget, undefined, mockSpawn);

        // This would be blocked in real shell but is safe in just-bash sandbox
        // Note: rm/mv are now allowed in just-bash since writes stay in memory
        const input: BashExecuteInput = { command: "echo 'test' > /tmp/file.txt" };
        const result = yield* Effect.promise(() => executeTool(tool, input, {} as BashExecuteOutput));

        yield* Effect.sync(() => {
          // Should execute successfully via just-bash (no validation error)
          expect(result.exitCode).toBeDefined();
          // Verify spawn was NOT called (used just-bash)
          expect(mockSpawn).not.toHaveBeenCalled();
        });
      }),
    );

    it.effect("should still block dangerous patterns in real shell commands", () =>
      Effect.gen(function* () {
        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(mockBudget, undefined, mockSpawn);

        // Real shell command with blocked pattern
        const input: BashExecuteInput = { command: "npm install && sudo apt update" };
        const promise = executeTool(tool, input, {} as BashExecuteOutput);
        const result = yield* Effect.exit(Effect.promise(() => promise));

        yield* Effect.sync(() => {
          // Should fail with validation error
          expect(Exit.isFailure(result)).toBe(true);
          if (Exit.isFailure(result)) {
            const error = Cause.squash(result.cause);
            expect(error instanceof Error && error.message).toContain("Command not allowed");
          }
        });
      }),
    );

    it.effect("should use real shell for pnpm, yarn, and bun commands", () =>
      Effect.gen(function* () {
        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(mockBudget, undefined, mockSpawn);

        const packageManagerCommands = [
          "pnpm test",
          "yarn run build",
          "bun test",
        ];

        for (const command of packageManagerCommands) {
          // Clear mocks between commands
          yield* Effect.sync(() => mockSpawn.mockClear());

          let closeHandler: ((code: number) => void) | undefined;
          const mockChild = yield* Effect.sync(() => 
            createMockChildProcess({
              onClose: (handler) => {
                closeHandler = handler as (code: number) => void;
              },
            })
          );
          yield* Effect.sync(() => {
            mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);
          });

          const input: BashExecuteInput = { command };
          const promise = executeTool(tool, input, {} as BashExecuteOutput);

          // Simulate process completion
          if (closeHandler) {
            closeHandler(0);
          }

          yield* Effect.promise(() => promise);

          yield* Effect.sync(() => {
            // Verify mockSpawn WAS called (real shell for package managers)
            expect(mockSpawn).toHaveBeenCalled();
            expect(mockSpawn).toHaveBeenCalledWith(
              command,
              expect.objectContaining({
                shell: true,
              }),
            );
          });
        }
      }),
    );

    it.effect("should use real shell for direct runtime commands (node, deno, bun)", () =>
      Effect.gen(function* () {
        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(mockBudget, undefined, mockSpawn);

        const runtimeCommands = [
          "node script.js",
          "deno run app.ts",
          "bun run index.ts",
        ];

        for (const command of runtimeCommands) {
          // Clear mocks between commands
          yield* Effect.sync(() => mockSpawn.mockClear());

          let closeHandler: ((code: number) => void) | undefined;
          const mockChild = yield* Effect.sync(() => 
            createMockChildProcess({
              onClose: (handler) => {
                closeHandler = handler as (code: number) => void;
              },
            })
          );
          yield* Effect.sync(() => {
            mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);
          });

          const input: BashExecuteInput = { command };
          const promise = executeTool(tool, input, {} as BashExecuteOutput);

          // Simulate process completion
          if (closeHandler) {
            closeHandler(0);
          }

          yield* Effect.promise(() => promise);

          yield* Effect.sync(() => {
            // Verify mockSpawn WAS called (real shell for runtimes)
            expect(mockSpawn).toHaveBeenCalled();
            expect(mockSpawn).toHaveBeenCalledWith(
              command,
              expect.objectContaining({
                shell: true,
              }),
            );
          });
        }
      }),
    );

    it.effect("should emit streaming output for just-bash commands", () =>
      Effect.gen(function* () {
        const streamingChunks: Array<{ command: string; output: string }> = []
        const streamingCallback = (chunk: { command: string; output: string }) => {
          streamingChunks.push(chunk);
        };

        const mockBudget = createMockTokenBudgetService();
        const tool = createBashExecuteTool(mockBudget, streamingCallback, mockSpawn);

        const input: BashExecuteInput = { command: "echo 'hello from just-bash'" };
        yield* Effect.promise(() => executeTool(tool, input, {} as BashExecuteOutput));

        yield* Effect.sync(() => {
          // Verify streaming callback was called
          expect(streamingChunks.length).toBeGreaterThan(0);
          // Verify output contains the echo result
          const allOutput = streamingChunks.map((c) => c.output).join("");
          expect(allOutput).toContain("hello from just-bash");
        });
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

        const input: BashExecuteInput = { command: "npm run pwd" };  // npm routes to real shell
        const promise = executeTool(tool, input, {} as BashExecuteOutput);

        // Simulate process completion
        if (closeHandler) {
          closeHandler(0);
        }

        yield* Effect.promise(() => promise);

        // Verify spawn was called with correct cwd (the temp directory we created)
        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            cwd: testWorkspaceDir,  // Use the actual temp directory
          }),
        );
      }),
    );
  });
});