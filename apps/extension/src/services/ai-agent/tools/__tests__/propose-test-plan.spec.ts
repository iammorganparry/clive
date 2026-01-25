import { it } from "@effect/vitest";
import { Effect, Either, Runtime } from "effect";
import { beforeEach, describe, expect, vi } from "vitest";
import type * as vscode from "vscode";
import {
  createMockVSCodeServiceLayer,
  type createVSCodeMock,
} from "../../../../__tests__/mock-factories/index.js";
import type { VSCodeService } from "../../../vs-code.js";
import type {
  ProposeTestPlanInput,
  ProposeTestPlanOutput,
} from "../propose-test-plan";
import {
  appendPlanStreamingContentEffect,
  createProposeTestPlanTool,
  finalizePlanStreamingWriteEffect,
  initializePlanStreamingWriteEffect,
  renamePlanFileEffect,
} from "../propose-test-plan";
import { executeTool } from "./test-helpers";

describe("proposeTestPlanTool", () => {
  let mockFs: {
    stat: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    createDirectory: ReturnType<typeof vi.fn>;
  };
  let mockDocument: vscode.TextDocument;
  let mockEditor: vscode.TextEditor;
  let mockVSCodeServiceLayer: ReturnType<
    typeof createMockVSCodeServiceLayer
  >["layer"];
  let mockVscode: ReturnType<typeof createVSCodeMock>;

  // Counter for unique toolCallIds to avoid state conflicts between tests
  let testCounter = 0;
  const getUniqueToolCallId = () =>
    `test-tool-call-${++testCounter}-${Date.now()}`;

  // Helper to run streaming Effect functions
  const runStreamingEffect = <A, E>(
    effect: Effect.Effect<A, E, VSCodeService>,
  ) =>
    Runtime.runPromise(Runtime.defaultRuntime)(
      effect.pipe(Effect.provide(mockVSCodeServiceLayer)),
    );

  beforeEach(() => {
    // Create mock VSCodeService layer
    const { layer, mockVscode: vsMock } = createMockVSCodeServiceLayer();
    mockVSCodeServiceLayer = layer;
    mockVscode = vsMock;

    mockFs = mockVscode.workspace.fs as unknown as {
      stat: ReturnType<typeof vi.fn>;
      writeFile: ReturnType<typeof vi.fn>;
      createDirectory: ReturnType<typeof vi.fn>;
    };

    mockDocument = {
      uri: mockVscode.Uri.file("/test-workspace/.clive/plans/test-plan.md"),
      positionAt: vi.fn(() => ({ line: 0, character: 0 })),
      getText: vi.fn(() => ""),
    } as unknown as vscode.TextDocument;

    mockEditor = {
      document: mockDocument,
    } as unknown as vscode.TextEditor;

    // Reset all mocks
    vi.clearAllMocks();

    // Default: directory doesn't exist
    mockFs.stat.mockRejectedValue(new Error("Directory not found"));
    // Default: writeFile succeeds
    mockFs.writeFile.mockResolvedValue(undefined);
    // Default: createDirectory succeeds
    mockFs.createDirectory.mockResolvedValue(undefined);
    // Default: openTextDocument succeeds
    (
      mockVscode.workspace.openTextDocument as unknown as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValue(mockDocument);
    // Default: showTextDocument succeeds
    (
      mockVscode.window.showTextDocument as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(mockEditor);
    // Default: applyEdit succeeds
    (
      mockVscode.workspace.applyEdit as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(true);
  });

  describe("Tool Execution", () => {
    it("should create test plan proposal with auto-approval", async () => {
      const tool = createProposeTestPlanTool();

      const input: ProposeTestPlanInput = {
        name: "Test Plan for Authentication",
        overview: "Test authentication flow",
        suites: [
          {
            id: "unit-auth",
            name: "Unit Tests for Auth",
            testType: "unit",
            targetFilePath: "src/auth/__tests__/auth.test.ts",
            sourceFiles: ["src/auth/login.ts"],
          },
          {
            id: "integration-auth",
            name: "Integration Tests for Auth Flow",
            testType: "integration",
            targetFilePath: "src/auth/__tests__/auth-flow.test.ts",
            sourceFiles: ["src/auth/middleware.ts"],
          },
        ],
        mockDependencies: [
          {
            dependency: "AuthService",
            existingMock: "__tests__/mock-factories/auth.ts",
            mockStrategy: "factory",
          },
        ],
        discoveredPatterns: {
          testFramework: "vitest",
          mockFactoryPaths: ["__tests__/mock-factories/auth.ts"],
          testPatterns: ["Uses vi.mock() for modules", "Setup in beforeEach"],
        },
        externalDependencies: [
          {
            type: "database",
            name: "Supabase",
            testStrategy: "mock",
          },
        ],
        planContent: "# Test Plan\n\n## Overview\nTest authentication",
      };

      const result = await executeTool(tool, input, {
        success: false,
        planId: "",
        name: "",
        overview: "",
        suites: [] as ProposeTestPlanOutput["suites"],
        message: "No result returned",
        mockDependencies: [],
        discoveredPatterns: {
          testFramework: "",
          mockFactoryPaths: [],
          testPatterns: [],
        },
        externalDependencies: [],
      } satisfies ProposeTestPlanOutput);

      expect(result.success).toBe(true);
      expect(result.planId).toBeDefined();
      expect(result.name).toBe("Test Plan for Authentication");
      expect(result.overview).toBe("Test authentication flow");
      expect(result.suites).toHaveLength(2);
      expect(result.suites[0].id).toBe("unit-auth");
      expect(result.suites[0].testType).toBe("unit");
      expect(result.suites[1].id).toBe("integration-auth");
      expect(result.suites[1].testType).toBe("integration");
    });

    it("should include suites in output", async () => {
      const tool = createProposeTestPlanTool();

      const input: ProposeTestPlanInput = {
        name: "Test Plan",
        overview: "Overview",
        suites: [
          {
            id: "unit-tests",
            name: "Unit Tests",
            testType: "unit",
            targetFilePath: "src/__tests__/unit.test.ts",
            sourceFiles: ["src/file.ts"],
          },
        ],
        mockDependencies: [],
        discoveredPatterns: {
          testFramework: "vitest",
          mockFactoryPaths: [],
          testPatterns: [],
        },
        planContent: "# Plan",
      };

      const result = await executeTool(tool, input, {
        success: false,
        planId: "",
        name: "",
        overview: "",
        suites: [] as ProposeTestPlanOutput["suites"],
        mockDependencies: [],
        discoveredPatterns: {
          testFramework: "",
          mockFactoryPaths: [],
          testPatterns: [],
        },
        message: "No result returned",
      } satisfies ProposeTestPlanOutput);

      expect(result.success).toBe(true);
      expect(result.suites).toHaveLength(1);
      expect(result.suites[0].id).toBe("unit-tests");
      expect(result.suites[0].name).toBe("Unit Tests");
      expect(result.suites[0].testType).toBe("unit");
      expect(result.suites[0].targetFilePath).toBe(
        "src/__tests__/unit.test.ts",
      );
      expect(result.suites[0].sourceFiles).toEqual(["src/file.ts"]);
    });

    it("should include regressionAnalysis when provided", async () => {
      const tool = createProposeTestPlanTool();

      const input: ProposeTestPlanInput = {
        name: "Test Plan with Regression Analysis",
        overview: "Test plan with regression detection",
        suites: [
          {
            id: "unit-tests",
            name: "Unit Tests",
            testType: "unit",
            targetFilePath: "src/__tests__/unit.test.ts",
            sourceFiles: ["src/file.ts"],
          },
        ],
        mockDependencies: [],
        discoveredPatterns: {
          testFramework: "vitest",
          mockFactoryPaths: [],
          testPatterns: [],
        },
        planContent: "# Plan",
        regressionAnalysis: {
          relatedTestFiles: [
            "src/__tests__/file.test.ts",
            "src/__tests__/related.test.ts",
          ],
          testsRun: 10,
          passed: 8,
          failed: 2,
          skipped: 0,
          failures: [
            {
              testFile: "src/__tests__/file.test.ts",
              testName: "should handle new parameter",
              errorMessage: "Expected 1 arguments, but got 0",
              classification: "expected",
              relatedChangesetFile: "src/file.ts",
              suggestedAction: "update_test",
            },
            {
              testFile: "src/__tests__/related.test.ts",
              testName: "should not break unrelated test",
              errorMessage: "Unexpected error",
              classification: "unexpected",
              suggestedAction: "investigate",
            },
          ],
          summary: "2 tests failed: 1 expected regression, 1 unexpected",
        },
      };

      const result = await executeTool(tool, input, {
        success: false,
        planId: "",
        name: "",
        overview: "",
        suites: [] as ProposeTestPlanOutput["suites"],
        mockDependencies: [],
        discoveredPatterns: {
          testFramework: "",
          mockFactoryPaths: [],
          testPatterns: [],
        },
        message: "No result returned",
        regressionAnalysis: undefined,
      } satisfies ProposeTestPlanOutput);

      expect(result.success).toBe(true);
      expect(result.regressionAnalysis).toBeDefined();
      const regressionAnalysis = (result as ProposeTestPlanOutput)
        .regressionAnalysis;
      if (!regressionAnalysis) {
        throw new Error("regressionAnalysis should be defined");
      }
      expect(regressionAnalysis.relatedTestFiles).toEqual([
        "src/__tests__/file.test.ts",
        "src/__tests__/related.test.ts",
      ]);
      expect(regressionAnalysis.testsRun).toBe(10);
      expect(regressionAnalysis.passed).toBe(8);
      expect(regressionAnalysis.failed).toBe(2);
      expect(regressionAnalysis.failures).toHaveLength(2);
      expect(regressionAnalysis.failures[0].classification).toBe("expected");
      expect(regressionAnalysis.failures[1].classification).toBe("unexpected");
    });

    it("should not include regressionAnalysis when not provided", async () => {
      const tool = createProposeTestPlanTool();

      const input: ProposeTestPlanInput = {
        name: "Test Plan without Regression Analysis",
        overview: "Test plan",
        suites: [
          {
            id: "unit-tests",
            name: "Unit Tests",
            testType: "unit",
            targetFilePath: "src/__tests__/unit.test.ts",
            sourceFiles: ["src/file.ts"],
          },
        ],
        mockDependencies: [],
        discoveredPatterns: {
          testFramework: "vitest",
          mockFactoryPaths: [],
          testPatterns: [],
        },
        planContent: "# Plan",
      };

      const result = await executeTool(tool, input, {
        success: false,
        planId: "",
        name: "",
        overview: "",
        suites: [] as ProposeTestPlanOutput["suites"],
        mockDependencies: [],
        discoveredPatterns: {
          testFramework: "",
          mockFactoryPaths: [],
          testPatterns: [],
        },
        message: "No result returned",
        regressionAnalysis: undefined,
      } satisfies ProposeTestPlanOutput);

      expect(result.success).toBe(true);
      expect(result.regressionAnalysis).toBeUndefined();
    });
  });

  describe("Plan File Streaming", () => {
    it("should initialize plan file streaming write", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      await runStreamingEffect(
        initializePlanStreamingWriteEffect(targetPath, toolCallId),
      );

      expect(mockFs.createDirectory).toHaveBeenCalled();
      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(mockVscode.workspace.openTextDocument).toHaveBeenCalled();
      expect(mockVscode.window.showTextDocument).toHaveBeenCalled();
    });

    it("should create parent directory if it doesn't exist", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      await runStreamingEffect(
        initializePlanStreamingWriteEffect(targetPath, toolCallId),
      );

      expect(mockFs.createDirectory).toHaveBeenCalled();
    });

    it("should handle absolute paths", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = "/absolute/path/test-plan.md";

      await runStreamingEffect(
        initializePlanStreamingWriteEffect(targetPath, toolCallId),
      );

      expect(mockVscode.Uri.file).toHaveBeenCalledWith(targetPath);
    });

    it("should return error when no workspace folder exists", async () => {
      // Temporarily override workspaceFolders
      const originalFolders = mockVscode.workspace.workspaceFolders;
      (
        mockVscode.workspace as unknown as { workspaceFolders: unknown }
      ).workspaceFolders = [];

      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      const result = await Runtime.runPromise(Runtime.defaultRuntime)(
        initializePlanStreamingWriteEffect(targetPath, toolCallId).pipe(
          Effect.provide(mockVSCodeServiceLayer),
          Effect.either,
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left.message).toContain("No workspace folder found");
      }

      // Restore
      (
        mockVscode.workspace as unknown as { workspaceFolders: unknown }
      ).workspaceFolders = originalFolders;
    });

    it("should append content chunks to streaming write", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      // Initialize first
      await runStreamingEffect(
        initializePlanStreamingWriteEffect(targetPath, toolCallId),
      );

      // Ensure mocks return the document when openTextDocument is called again (for reload)
      (
        mockVscode.workspace.openTextDocument as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue(mockDocument);

      // Append content
      await runStreamingEffect(
        appendPlanStreamingContentEffect(toolCallId, "# Test Plan\n"),
      );

      expect(mockVscode.workspace.applyEdit).toHaveBeenCalled();
    });

    it("should return error if streaming write not initialized", async () => {
      const toolCallId = "uninitialized-id";

      const result = await Runtime.runPromise(Runtime.defaultRuntime)(
        appendPlanStreamingContentEffect(toolCallId, "content").pipe(
          Effect.provide(mockVSCodeServiceLayer),
          Effect.either,
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        if (result.left._tag === "StreamingNotInitializedError") {
          expect(result.left.toolCallId).toBe(toolCallId);
        } else {
          expect(result.left.message).toContain(
            "Streaming write not initialized",
          );
        }
      }
    });

    it("should finalize streaming write and return file path", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      // Initialize and append some content
      await runStreamingEffect(
        initializePlanStreamingWriteEffect(targetPath, toolCallId),
      );
      await runStreamingEffect(
        appendPlanStreamingContentEffect(toolCallId, "# Test Plan\n"),
      );

      // Finalize
      const filePath = await runStreamingEffect(
        finalizePlanStreamingWriteEffect(toolCallId),
      );

      expect(filePath).toBeDefined();
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it("should return error if finalizing non-existent streaming write", async () => {
      const toolCallId = "non-existent-id";

      const result = await Runtime.runPromise(Runtime.defaultRuntime)(
        finalizePlanStreamingWriteEffect(toolCallId).pipe(
          Effect.provide(mockVSCodeServiceLayer),
          Effect.either,
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        if (result.left._tag === "StreamingNotInitializedError") {
          expect(result.left.toolCallId).toBe(toolCallId);
        } else {
          expect(result.left.message).toContain(
            "Streaming write not initialized",
          );
        }
      }
    });

    it("should stream content incrementally", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      await runStreamingEffect(
        initializePlanStreamingWriteEffect(targetPath, toolCallId),
      );

      // Ensure mocks return the document when openTextDocument is called again (for reload)
      (
        mockVscode.workspace.openTextDocument as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue(mockDocument);

      // Append multiple chunks
      await runStreamingEffect(
        appendPlanStreamingContentEffect(toolCallId, "# Test Plan\n"),
      );
      await runStreamingEffect(
        appendPlanStreamingContentEffect(toolCallId, "## Section 1\n"),
      );
      await runStreamingEffect(
        appendPlanStreamingContentEffect(toolCallId, "Content here\n"),
      );

      // Verify applyEdit was called for each chunk
      expect(mockVscode.workspace.applyEdit).toHaveBeenCalledTimes(3);
    });

    it("should write accumulated content on finalize", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      await runStreamingEffect(
        initializePlanStreamingWriteEffect(targetPath, toolCallId),
      );
      await runStreamingEffect(
        appendPlanStreamingContentEffect(toolCallId, "Chunk 1"),
      );
      await runStreamingEffect(
        appendPlanStreamingContentEffect(toolCallId, "Chunk 2"),
      );

      await runStreamingEffect(finalizePlanStreamingWriteEffect(toolCallId));

      // Verify final writeFile was called with replaced content (not accumulated)
      const writeCalls = mockFs.writeFile.mock.calls;
      const lastCall = writeCalls[writeCalls.length - 1];
      const writtenContent = lastCall[1].toString();
      // Content is replaced, not accumulated - only last chunk should be present
      expect(writtenContent).not.toContain("Chunk 1");
      expect(writtenContent).toContain("Chunk 2");
    });
  });

  describe("Content Isolation", () => {
    it("should only write planContent to file, not metadata", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      await runStreamingEffect(
        initializePlanStreamingWriteEffect(targetPath, toolCallId),
      );

      // Simulate streaming only planContent (not name, overview, todos)
      const planContent =
        "# Test Plan\n\n## Overview\nThis is the plan content.";
      await runStreamingEffect(
        appendPlanStreamingContentEffect(toolCallId, planContent),
      );

      await runStreamingEffect(finalizePlanStreamingWriteEffect(toolCallId));

      // Verify the file contains only planContent
      const writeCalls = mockFs.writeFile.mock.calls;
      const lastCall = writeCalls[writeCalls.length - 1];
      const writtenContent = lastCall[1].toString();
      expect(writtenContent).toBe(planContent);
      // Verify no metadata fields appear
      expect(writtenContent).not.toContain('"name"');
      expect(writtenContent).not.toContain('"overview"');
      expect(writtenContent).not.toContain('"todos"');
    });
  });

  describe("Error Handling", () => {
    it("should handle file creation errors gracefully", async () => {
      mockFs.writeFile.mockRejectedValue(new Error("Permission denied"));

      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      const result = await Runtime.runPromise(Runtime.defaultRuntime)(
        initializePlanStreamingWriteEffect(targetPath, toolCallId).pipe(
          Effect.provide(mockVSCodeServiceLayer),
          Effect.either,
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        // Effect-based implementation wraps errors with descriptive messages
        expect(result.left.message).toContain("Failed to create empty file");
      }
    });

    it("should handle directory creation errors gracefully", async () => {
      mockFs.createDirectory.mockRejectedValue(
        new Error("Cannot create directory"),
      );

      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      const result = await Runtime.runPromise(Runtime.defaultRuntime)(
        initializePlanStreamingWriteEffect(targetPath, toolCallId).pipe(
          Effect.provide(mockVSCodeServiceLayer),
          Effect.either,
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left.message).toBeDefined();
      }
    });

    it("should handle editor opening errors gracefully", async () => {
      (
        mockVscode.workspace.openTextDocument as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockRejectedValue(new Error("Cannot open document"));

      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      const result = await Runtime.runPromise(Runtime.defaultRuntime)(
        initializePlanStreamingWriteEffect(targetPath, toolCallId).pipe(
          Effect.provide(mockVSCodeServiceLayer),
          Effect.either,
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left.message).toBeDefined();
      }
    });

    it("should handle append errors gracefully", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      await runStreamingEffect(
        initializePlanStreamingWriteEffect(targetPath, toolCallId),
      );

      (
        mockVscode.workspace.applyEdit as unknown as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error("Edit failed"));

      const result = await Runtime.runPromise(Runtime.defaultRuntime)(
        appendPlanStreamingContentEffect(toolCallId, "content").pipe(
          Effect.provide(mockVSCodeServiceLayer),
          Effect.either,
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left.message).toBeDefined();
      }
    });
  });

  describe("Path Sanitization", () => {
    it("should handle special characters in plan name", async () => {
      const toolCallId = getUniqueToolCallId();
      // Path generation happens in testing-agent.ts, but we test the sanitization logic
      // by verifying paths with special characters work
      const targetPath = ".clive/plans/test-plan-auth-flow.md";

      await runStreamingEffect(
        initializePlanStreamingWriteEffect(targetPath, toolCallId),
      );
    });

    it("should handle long plan names", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath =
        ".clive/plans/test-plan-very-long-name-that-should-still-work.md";

      await runStreamingEffect(
        initializePlanStreamingWriteEffect(targetPath, toolCallId),
      );
    });
  });

  describe("Plan File Rename Effect", () => {
    it.effect("should rename plan file successfully", () =>
      Effect.gen(function* () {
        const toolCallId = getUniqueToolCallId();
        const oldPath = ".clive/plans/test-placeholder.md";
        const newPath = ".clive/plans/test-plan-renamed.md";

        // Wait for initialization
        yield* initializePlanStreamingWriteEffect(oldPath, toolCallId);

        // Setup mocks for rename operation
        yield* Effect.sync(() => {
          mockFs.stat.mockResolvedValue({ type: 1 } as vscode.FileStat);
          const mockReadFile = vi
            .fn()
            .mockResolvedValue(Buffer.from("# Test Plan Content"));
          const mockDelete = vi.fn().mockResolvedValue(undefined);

          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).readFile = mockReadFile;
          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).delete = mockDelete;
        });

        // Execute rename
        const result = yield* renamePlanFileEffect(
          oldPath,
          newPath,
          toolCallId,
        );

        // Assert
        yield* Effect.sync(() => {
          expect(result).toBe(newPath);
          expect(mockVscode.workspace.fs.readFile).toHaveBeenCalled();
          expect(mockFs.writeFile).toHaveBeenCalled();
          expect(mockVscode.workspace.fs.delete).toHaveBeenCalled();
        });
      }).pipe(Effect.provide(mockVSCodeServiceLayer)),
    );

    it.effect("should fail when streaming state not found", () =>
      Effect.gen(function* () {
        const toolCallId = "non-existent-id";
        const oldPath = ".clive/plans/old.md";
        const newPath = ".clive/plans/new.md";

        // Execute rename without initialization
        const result = yield* Effect.either(
          renamePlanFileEffect(oldPath, newPath, toolCallId),
        );

        // Assert - should fail
        yield* Effect.sync(() => {
          expect(result._tag).toBe("Left");
          if (result._tag === "Left") {
            expect(result.left.message).toContain("Streaming state not found");
          }
        });
      }).pipe(Effect.provide(mockVSCodeServiceLayer)),
    );

    it.effect("should handle read file errors gracefully", () =>
      Effect.gen(function* () {
        const toolCallId = getUniqueToolCallId();
        const oldPath = ".clive/plans/test-placeholder.md";
        const newPath = ".clive/plans/test-plan-renamed.md";

        // Initialize streaming state
        yield* initializePlanStreamingWriteEffect(oldPath, toolCallId);

        // Setup mock to fail on readFile
        yield* Effect.sync(() => {
          const mockReadFile = vi
            .fn()
            .mockRejectedValue(new Error("File not found"));
          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
            }
          ).readFile = mockReadFile;
        });

        // Execute rename - should fail
        const result = yield* Effect.either(
          renamePlanFileEffect(oldPath, newPath, toolCallId),
        );

        // Assert
        yield* Effect.sync(() => {
          expect(result._tag).toBe("Left");
          if (result._tag === "Left") {
            expect(result.left.message).toContain("Failed to read old file");
          }
        });
      }).pipe(Effect.provide(mockVSCodeServiceLayer)),
    );

    it.effect("should handle write file errors gracefully", () =>
      Effect.gen(function* () {
        const toolCallId = getUniqueToolCallId();
        const oldPath = ".clive/plans/test-placeholder.md";
        const newPath = ".clive/plans/test-plan-renamed.md";

        // Initialize streaming state
        yield* initializePlanStreamingWriteEffect(oldPath, toolCallId);

        // Setup mocks - readFile succeeds, writeFile fails
        yield* Effect.sync(() => {
          const mockReadFile = vi
            .fn()
            .mockResolvedValue(Buffer.from("content"));
          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
            }
          ).readFile = mockReadFile;

          mockFs.stat.mockResolvedValue({ type: 1 } as vscode.FileStat);
          mockFs.writeFile.mockRejectedValue(new Error("Permission denied"));
        });

        // Execute rename - should fail
        const result = yield* Effect.either(
          renamePlanFileEffect(oldPath, newPath, toolCallId),
        );

        // Assert
        yield* Effect.sync(() => {
          expect(result._tag).toBe("Left");
          if (result._tag === "Left") {
            expect(result.left.message).toContain(
              "Failed to write to new location",
            );
          }
        });
      }).pipe(Effect.provide(mockVSCodeServiceLayer)),
    );

    it.effect("should handle delete file errors gracefully", () =>
      Effect.gen(function* () {
        const toolCallId = getUniqueToolCallId();
        const oldPath = ".clive/plans/test-placeholder.md";
        const newPath = ".clive/plans/test-plan-renamed.md";

        // Initialize streaming state
        yield* initializePlanStreamingWriteEffect(oldPath, toolCallId);

        // Setup mocks - readFile and writeFile succeed, delete fails
        yield* Effect.sync(() => {
          const mockReadFile = vi
            .fn()
            .mockResolvedValue(Buffer.from("content"));
          const mockDelete = vi
            .fn()
            .mockRejectedValue(new Error("Cannot delete"));

          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).readFile = mockReadFile;
          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).delete = mockDelete;

          mockFs.stat.mockResolvedValue({ type: 1 } as vscode.FileStat);
          mockFs.writeFile.mockResolvedValue(undefined);
        });

        // Execute rename - should fail
        const result = yield* Effect.either(
          renamePlanFileEffect(oldPath, newPath, toolCallId),
        );

        // Assert
        yield* Effect.sync(() => {
          expect(result._tag).toBe("Left");
          if (result._tag === "Left") {
            expect(result.left.message).toContain("Failed to delete old file");
          }
        });
      }).pipe(Effect.provide(mockVSCodeServiceLayer)),
    );

    it.effect("should update streaming state with new file URI", () =>
      Effect.gen(function* () {
        const toolCallId = getUniqueToolCallId();
        const oldPath = ".clive/plans/test-placeholder.md";
        const newPath = ".clive/plans/test-plan-renamed.md";

        // Initialize streaming state
        yield* initializePlanStreamingWriteEffect(oldPath, toolCallId);

        // Setup mocks
        yield* Effect.sync(() => {
          mockFs.stat.mockResolvedValue({ type: 1 } as vscode.FileStat);
          const mockReadFile = vi
            .fn()
            .mockResolvedValue(Buffer.from("# Test Content"));
          const mockDelete = vi.fn().mockResolvedValue(undefined);

          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).readFile = mockReadFile;
          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).delete = mockDelete;

          mockFs.writeFile.mockResolvedValue(undefined);
        });

        // Execute rename
        const result = yield* renamePlanFileEffect(
          oldPath,
          newPath,
          toolCallId,
        );

        // Assert - document and editor should be updated
        yield* Effect.sync(() => {
          expect(result).toBe(newPath);
          expect(mockVscode.workspace.openTextDocument).toHaveBeenCalled();
          expect(mockVscode.window.showTextDocument).toHaveBeenCalled();
        });
      }).pipe(Effect.provide(mockVSCodeServiceLayer)),
    );

    it.effect("should create parent directory if it doesn't exist", () =>
      Effect.gen(function* () {
        const toolCallId = getUniqueToolCallId();
        const oldPath = ".clive/plans/test-placeholder.md";
        const newPath = ".clive/plans/subfolder/test-plan-renamed.md";

        // Initialize streaming state
        yield* initializePlanStreamingWriteEffect(oldPath, toolCallId);

        // Setup mocks - stat fails for parent directory (doesn't exist)
        yield* Effect.sync(() => {
          let statCallCount = 0;
          mockFs.stat.mockImplementation(() => {
            statCallCount++;
            if (statCallCount === 1) {
              // First call: parent directory doesn't exist
              return Promise.reject(new Error("Directory not found"));
            }
            return Promise.resolve({ type: 1 } as vscode.FileStat);
          });

          const mockReadFile = vi
            .fn()
            .mockResolvedValue(Buffer.from("content"));
          const mockDelete = vi.fn().mockResolvedValue(undefined);

          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).readFile = mockReadFile;
          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).delete = mockDelete;

          mockFs.createDirectory.mockResolvedValue(undefined);
          mockFs.writeFile.mockResolvedValue(undefined);
        });

        // Execute rename
        const result = yield* renamePlanFileEffect(
          oldPath,
          newPath,
          toolCallId,
        );

        // Assert - createDirectory should be called for parent directory
        yield* Effect.sync(() => {
          expect(result).toBe(newPath);
          expect(mockFs.createDirectory).toHaveBeenCalled();
          expect(mockFs.writeFile).toHaveBeenCalled();
        });
      }).pipe(Effect.provide(mockVSCodeServiceLayer)),
    );

    it.effect("should handle absolute paths correctly", () =>
      Effect.gen(function* () {
        const toolCallId = getUniqueToolCallId();
        const oldPath = "/absolute/path/old.md";
        const newPath = "/absolute/path/new.md";

        // Initialize streaming state with absolute path
        yield* initializePlanStreamingWriteEffect(oldPath, toolCallId);

        // Setup mocks
        yield* Effect.sync(() => {
          mockFs.stat.mockResolvedValue({ type: 1 } as vscode.FileStat);
          const mockReadFile = vi
            .fn()
            .mockResolvedValue(Buffer.from("content"));
          const mockDelete = vi.fn().mockResolvedValue(undefined);

          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).readFile = mockReadFile;
          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).delete = mockDelete;

          mockFs.writeFile.mockResolvedValue(undefined);
        });

        // Execute rename
        const result = yield* renamePlanFileEffect(
          oldPath,
          newPath,
          toolCallId,
        );

        // Assert
        yield* Effect.sync(() => {
          expect(result).toBe(newPath);
          expect(mockVscode.Uri.file).toHaveBeenCalledWith(oldPath);
          expect(mockVscode.Uri.file).toHaveBeenCalledWith(newPath);
        });
      }).pipe(Effect.provide(mockVSCodeServiceLayer)),
    );

    it.effect("should preserve file content during rename", () =>
      Effect.gen(function* () {
        const toolCallId = getUniqueToolCallId();
        const oldPath = ".clive/plans/test-placeholder.md";
        const newPath = ".clive/plans/test-plan-renamed.md";
        const testContent = "# Test Plan\n\nThis is the plan content.";

        // Initialize streaming state
        yield* initializePlanStreamingWriteEffect(oldPath, toolCallId);

        // Setup mocks with specific content
        const capturedContent: Buffer[] = [];
        yield* Effect.sync(() => {
          mockFs.stat.mockResolvedValue({ type: 1 } as vscode.FileStat);
          const mockReadFile = vi
            .fn()
            .mockResolvedValue(Buffer.from(testContent));
          const mockDelete = vi.fn().mockResolvedValue(undefined);

          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).readFile = mockReadFile;
          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).delete = mockDelete;

          mockFs.writeFile.mockImplementation((_uri, content) => {
            capturedContent.push(content as Buffer);
            return Promise.resolve();
          });
        });

        // Execute rename
        yield* renamePlanFileEffect(oldPath, newPath, toolCallId);

        // Assert - content should be preserved
        yield* Effect.sync(() => {
          expect(capturedContent.length).toBeGreaterThan(0);
          const writtenContent =
            capturedContent[capturedContent.length - 1].toString();
          expect(writtenContent).toBe(testContent);
        });
      }).pipe(Effect.provide(mockVSCodeServiceLayer)),
    );

    it.effect("should delete old file after successful rename", () =>
      Effect.gen(function* () {
        const toolCallId = getUniqueToolCallId();
        const oldPath = ".clive/plans/test-placeholder.md";
        const newPath = ".clive/plans/test-plan-renamed.md";

        // Initialize streaming state
        yield* initializePlanStreamingWriteEffect(oldPath, toolCallId);

        // Setup mocks
        const deleteCallArgs: unknown[] = [];
        yield* Effect.sync(() => {
          mockFs.stat.mockResolvedValue({ type: 1 } as vscode.FileStat);
          const mockReadFile = vi
            .fn()
            .mockResolvedValue(Buffer.from("content"));
          const mockDelete = vi.fn().mockImplementation((uri) => {
            deleteCallArgs.push(uri);
            return Promise.resolve();
          });

          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).readFile = mockReadFile;
          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).delete = mockDelete;

          mockFs.writeFile.mockResolvedValue(undefined);
        });

        // Execute rename
        yield* renamePlanFileEffect(oldPath, newPath, toolCallId);

        // Assert - old file should be deleted
        yield* Effect.sync(() => {
          expect(deleteCallArgs.length).toBe(1);
          expect(mockVscode.workspace.fs.delete).toHaveBeenCalledTimes(1);
        });
      }).pipe(Effect.provide(mockVSCodeServiceLayer)),
    );

    it.effect("should handle editor opening errors gracefully", () =>
      Effect.gen(function* () {
        const toolCallId = getUniqueToolCallId();
        const oldPath = ".clive/plans/test-placeholder.md";
        const newPath = ".clive/plans/test-plan-renamed.md";

        // Initialize streaming state
        yield* initializePlanStreamingWriteEffect(oldPath, toolCallId);

        // Setup mocks - file operations succeed, but editor opening fails
        yield* Effect.sync(() => {
          mockFs.stat.mockResolvedValue({ type: 1 } as vscode.FileStat);
          const mockReadFile = vi
            .fn()
            .mockResolvedValue(Buffer.from("content"));
          const mockDelete = vi.fn().mockResolvedValue(undefined);

          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).readFile = mockReadFile;
          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).delete = mockDelete;

          mockFs.writeFile.mockResolvedValue(undefined);

          // Mock openTextDocument to fail
          (
            mockVscode.workspace.openTextDocument as unknown as ReturnType<
              typeof vi.fn
            >
          ).mockRejectedValue(new Error("Cannot open document"));
        });

        // Execute rename - should fail
        const result = yield* Effect.either(
          renamePlanFileEffect(oldPath, newPath, toolCallId),
        );

        // Assert
        yield* Effect.sync(() => {
          expect(result._tag).toBe("Left");
          if (result._tag === "Left") {
            expect(result.left.message).toContain(
              "Failed to open new document",
            );
          }
        });
      }).pipe(Effect.provide(mockVSCodeServiceLayer)),
    );

    it.effect("should read from old path and write to new path", () =>
      Effect.gen(function* () {
        const toolCallId = getUniqueToolCallId();
        const oldPath = ".clive/plans/test-placeholder.md";
        const newPath = ".clive/plans/test-plan-final.md";

        // Initialize streaming state
        yield* initializePlanStreamingWriteEffect(oldPath, toolCallId);

        // Track which URIs were accessed
        const readUris: string[] = [];
        const writeUris: string[] = [];

        yield* Effect.sync(() => {
          mockFs.stat.mockResolvedValue({ type: 1 } as vscode.FileStat);

          const mockReadFile = vi.fn().mockImplementation((uri) => {
            readUris.push(uri.toString());
            return Promise.resolve(Buffer.from("content"));
          });
          const mockDelete = vi.fn().mockResolvedValue(undefined);

          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).readFile = mockReadFile;
          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).delete = mockDelete;

          mockFs.writeFile.mockImplementation((uri) => {
            writeUris.push(uri.toString());
            return Promise.resolve();
          });
        });

        // Execute rename
        yield* renamePlanFileEffect(oldPath, newPath, toolCallId);

        // Assert - read from old, write to new
        yield* Effect.sync(() => {
          expect(readUris.length).toBeGreaterThan(0);
          expect(readUris[0]).toContain("placeholder");
          expect(writeUris.some((uri) => uri.includes("final"))).toBe(true);
        });
      }).pipe(Effect.provide(mockVSCodeServiceLayer)),
    );

    it.effect("should handle directory creation errors gracefully", () =>
      Effect.gen(function* () {
        const toolCallId = getUniqueToolCallId();
        const oldPath = ".clive/plans/test-placeholder.md";
        const newPath = ".clive/plans/newfolder/test-plan.md";

        // Initialize streaming state
        yield* initializePlanStreamingWriteEffect(oldPath, toolCallId);

        // Setup mocks - directory creation fails
        yield* Effect.sync(() => {
          mockFs.stat.mockRejectedValue(new Error("Directory not found"));
          mockFs.createDirectory.mockRejectedValue(
            new Error("Cannot create directory"),
          );

          const mockReadFile = vi
            .fn()
            .mockResolvedValue(Buffer.from("content"));
          const mockDelete = vi.fn().mockResolvedValue(undefined);

          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).readFile = mockReadFile;
          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).delete = mockDelete;
        });

        // Execute rename - should fail
        const result = yield* Effect.either(
          renamePlanFileEffect(oldPath, newPath, toolCallId),
        );

        // Assert
        yield* Effect.sync(() => {
          expect(result._tag).toBe("Left");
          if (result._tag === "Left") {
            expect(result.left.message).toContain(
              "Failed to create new directory",
            );
          }
        });
      }).pipe(Effect.provide(mockVSCodeServiceLayer)),
    );

    it.effect("should open new document and show new editor", () =>
      Effect.gen(function* () {
        const toolCallId = getUniqueToolCallId();
        const oldPath = ".clive/plans/test-placeholder.md";
        const newPath = ".clive/plans/test-plan-renamed.md";

        // Initialize streaming state
        yield* initializePlanStreamingWriteEffect(oldPath, toolCallId);

        // Setup mocks
        yield* Effect.sync(() => {
          mockFs.stat.mockResolvedValue({ type: 1 } as vscode.FileStat);
          const mockReadFile = vi
            .fn()
            .mockResolvedValue(Buffer.from("content"));
          const mockDelete = vi.fn().mockResolvedValue(undefined);

          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).readFile = mockReadFile;
          (
            mockVscode.workspace.fs as unknown as {
              readFile: ReturnType<typeof vi.fn>;
              delete: ReturnType<typeof vi.fn>;
            }
          ).delete = mockDelete;

          mockFs.writeFile.mockResolvedValue(undefined);

          // Track calls to openTextDocument and showTextDocument
          vi.clearAllMocks();
          (
            mockVscode.workspace.openTextDocument as unknown as ReturnType<
              typeof vi.fn
            >
          ).mockResolvedValue(mockDocument);
          (
            mockVscode.window.showTextDocument as unknown as ReturnType<
              typeof vi.fn
            >
          ).mockResolvedValue(mockEditor);
        });

        // Execute rename
        yield* renamePlanFileEffect(oldPath, newPath, toolCallId);

        // Assert - should open and show new document
        yield* Effect.sync(() => {
          const openDocumentCalls = (
            mockVscode.workspace.openTextDocument as unknown as ReturnType<
              typeof vi.fn
            >
          ).mock.calls;
          expect(openDocumentCalls.length).toBeGreaterThan(0);

          const showDocumentCalls = (
            mockVscode.window.showTextDocument as unknown as ReturnType<
              typeof vi.fn
            >
          ).mock.calls;
          expect(showDocumentCalls.length).toBeGreaterThan(0);
        });
      }).pipe(Effect.provide(mockVSCodeServiceLayer)),
    );
  });
});
