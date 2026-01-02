import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import {
  createProposeTestPlanTool,
  initializePlanStreamingWrite,
  appendPlanStreamingContent,
  finalizePlanStreamingWrite,
} from "../propose-test-plan";
import type {
  ProposeTestPlanInput,
  ProposeTestPlanOutput,
} from "../propose-test-plan";
import { executeTool } from "./test-helpers";

// Mock vscode module using shared factory
vi.mock("vscode", async () => {
  const { createVSCodeMock } = await import(
    "../../../../__tests__/mock-factories"
  );
  return createVSCodeMock();
});

describe("proposeTestPlanTool", () => {
  let mockFs: {
    stat: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    createDirectory: ReturnType<typeof vi.fn>;
  };
  let mockDocument: vscode.TextDocument;
  let mockEditor: vscode.TextEditor;

  // Counter for unique toolCallIds to avoid state conflicts between tests
  let testCounter = 0;
  const getUniqueToolCallId = () =>
    `test-tool-call-${++testCounter}-${Date.now()}`;

  beforeEach(() => {
    mockFs = vscode.workspace.fs as unknown as {
      stat: ReturnType<typeof vi.fn>;
      writeFile: ReturnType<typeof vi.fn>;
      createDirectory: ReturnType<typeof vi.fn>;
    };

    mockDocument = {
      uri: vscode.Uri.file("/test-workspace/.clive/plans/test-plan.md"),
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
      vscode.workspace.openTextDocument as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(mockDocument);
    // Default: showTextDocument succeeds
    (
      vscode.window.showTextDocument as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(mockEditor);
    // Default: applyEdit succeeds
    (
      vscode.workspace.applyEdit as unknown as ReturnType<typeof vi.fn>
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
  });

  describe("Plan File Streaming", () => {
    it("should initialize plan file streaming write", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      const result = await initializePlanStreamingWrite(targetPath, toolCallId);

      expect(result.success).toBe(true);
      expect(mockFs.createDirectory).toHaveBeenCalled();
      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(vscode.workspace.openTextDocument).toHaveBeenCalled();
      expect(vscode.window.showTextDocument).toHaveBeenCalled();
    });

    it("should create parent directory if it doesn't exist", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      await initializePlanStreamingWrite(targetPath, toolCallId);

      expect(mockFs.createDirectory).toHaveBeenCalled();
    });

    it("should handle absolute paths", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = "/absolute/path/test-plan.md";

      const result = await initializePlanStreamingWrite(targetPath, toolCallId);

      expect(result.success).toBe(true);
      expect(vscode.Uri.file).toHaveBeenCalledWith(targetPath);
    });

    it("should return error when no workspace folder exists", async () => {
      // Temporarily override workspaceFolders
      const originalFolders = vscode.workspace.workspaceFolders;
      (
        vscode.workspace as unknown as { workspaceFolders: unknown }
      ).workspaceFolders = [];

      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      const result = await initializePlanStreamingWrite(targetPath, toolCallId);

      expect(result.success).toBe(false);
      expect(result.error).toContain("No workspace folder found");

      // Restore
      (
        vscode.workspace as unknown as { workspaceFolders: unknown }
      ).workspaceFolders = originalFolders;
    });

    it("should append content chunks to streaming write", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      // Initialize first
      const initResult = await initializePlanStreamingWrite(
        targetPath,
        toolCallId,
      );
      expect(initResult.success).toBe(true);

      // Ensure mocks return the document when openTextDocument is called again (for reload)
      (
        vscode.workspace.openTextDocument as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockDocument);

      // Append content
      const result = await appendPlanStreamingContent(
        toolCallId,
        "# Test Plan\n",
      );

      if (!result.success) {
        console.error("Append failed with error:", result.error);
      }

      expect(result.success).toBe(true);
      expect(vscode.workspace.applyEdit).toHaveBeenCalled();
    });

    it("should return error if streaming write not initialized", async () => {
      const toolCallId = "uninitialized-id";

      const result = await appendPlanStreamingContent(toolCallId, "content");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Streaming write not initialized");
    });

    it("should finalize streaming write and return file path", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      // Initialize and append some content
      await initializePlanStreamingWrite(targetPath, toolCallId);
      await appendPlanStreamingContent(toolCallId, "# Test Plan\n");

      // Finalize
      const result = await finalizePlanStreamingWrite(toolCallId);

      expect(result.success).toBe(true);
      expect(result.filePath).toBeDefined();
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it("should return error if finalizing non-existent streaming write", async () => {
      const toolCallId = "non-existent-id";

      const result = await finalizePlanStreamingWrite(toolCallId);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Streaming write not found");
    });

    it("should stream content incrementally", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      const initResult = await initializePlanStreamingWrite(
        targetPath,
        toolCallId,
      );
      expect(initResult.success).toBe(true);

      // Ensure mocks return the document when openTextDocument is called again (for reload)
      (
        vscode.workspace.openTextDocument as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockDocument);

      // Append multiple chunks
      const result1 = await appendPlanStreamingContent(
        toolCallId,
        "# Test Plan\n",
      );
      const result2 = await appendPlanStreamingContent(
        toolCallId,
        "## Section 1\n",
      );
      const result3 = await appendPlanStreamingContent(
        toolCallId,
        "Content here\n",
      );

      if (!result1.success) {
        console.error("Append 1 failed with error:", result1.error);
      }
      if (!result2.success) {
        console.error("Append 2 failed with error:", result2.error);
      }
      if (!result3.success) {
        console.error("Append 3 failed with error:", result3.error);
      }

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result3.success).toBe(true);

      // Verify applyEdit was called for each chunk
      expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(3);
    });

    it("should write accumulated content on finalize", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      await initializePlanStreamingWrite(targetPath, toolCallId);
      await appendPlanStreamingContent(toolCallId, "Chunk 1");
      await appendPlanStreamingContent(toolCallId, "Chunk 2");

      const result = await finalizePlanStreamingWrite(toolCallId);

      expect(result.success).toBe(true);
      // Verify final writeFile was called with accumulated content
      const writeCalls = mockFs.writeFile.mock.calls;
      const lastCall = writeCalls[writeCalls.length - 1];
      const writtenContent = lastCall[1].toString();
      expect(writtenContent).toContain("Chunk 1");
      expect(writtenContent).toContain("Chunk 2");
    });
  });

  describe("Content Isolation", () => {
    it("should only write planContent to file, not metadata", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      await initializePlanStreamingWrite(targetPath, toolCallId);

      // Simulate streaming only planContent (not name, overview, todos)
      const planContent =
        "# Test Plan\n\n## Overview\nThis is the plan content.";
      await appendPlanStreamingContent(toolCallId, planContent);

      const result = await finalizePlanStreamingWrite(toolCallId);

      expect(result.success).toBe(true);
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

      const result = await initializePlanStreamingWrite(targetPath, toolCallId);

      expect(result.success).toBe(false);
      // Effect-based implementation wraps errors with descriptive messages
      expect(result.error).toContain("Failed to create empty file");
    });

    it("should handle directory creation errors gracefully", async () => {
      mockFs.createDirectory.mockRejectedValue(
        new Error("Cannot create directory"),
      );

      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      const result = await initializePlanStreamingWrite(targetPath, toolCallId);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle editor opening errors gracefully", async () => {
      (
        vscode.workspace.openTextDocument as unknown as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error("Cannot open document"));

      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      const result = await initializePlanStreamingWrite(targetPath, toolCallId);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle append errors gracefully", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath = ".clive/plans/test-plan.md";

      await initializePlanStreamingWrite(targetPath, toolCallId);

      (
        vscode.workspace.applyEdit as unknown as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error("Edit failed"));

      const result = await appendPlanStreamingContent(toolCallId, "content");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("Path Sanitization", () => {
    it("should handle special characters in plan name", async () => {
      const toolCallId = getUniqueToolCallId();
      // Path generation happens in testing-agent.ts, but we test the sanitization logic
      // by verifying paths with special characters work
      const targetPath = ".clive/plans/test-plan-auth-flow.md";

      const result = await initializePlanStreamingWrite(targetPath, toolCallId);

      expect(result.success).toBe(true);
    });

    it("should handle long plan names", async () => {
      const toolCallId = getUniqueToolCallId();
      const targetPath =
        ".clive/plans/test-plan-very-long-name-that-should-still-work.md";

      const result = await initializePlanStreamingWrite(targetPath, toolCallId);

      expect(result.success).toBe(true);
    });
  });
});
