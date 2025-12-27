import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import { createWriteTestFileTool } from "../write-test-file";
import type { WriteTestFileInput, WriteTestFileOutput } from "../../types";

/**
 * Helper function to execute tool and handle async results
 */
async function executeTool(
  tool: ReturnType<typeof createWriteTestFileTool>,
  input: WriteTestFileInput,
): Promise<WriteTestFileOutput> {
  if (!tool.execute) {
    throw new Error("Tool execute function is undefined");
  }

  const result = await tool.execute(input, {
    toolCallId: "test-call-id",
    messages: [],
  });

  // Handle AsyncIterable if needed
  if (result && typeof result === "object" && Symbol.asyncIterator in result) {
    const results: WriteTestFileOutput[] = [];
    for await (const value of result as AsyncIterable<WriteTestFileOutput>) {
      results.push(value);
    }
    return results[results.length - 1] ?? {
      success: false,
      filePath: input.targetPath,
      message: "No result returned",
    };
  }

  return result as WriteTestFileOutput;
}

// Mock vscode module
vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [
      {
        uri: {
          fsPath: "/test-workspace",
          scheme: "file",
        },
        name: "test-workspace",
        index: 0,
      },
    ],
    fs: {
      stat: vi.fn(),
      writeFile: vi.fn(),
      createDirectory: vi.fn(),
    },
    asRelativePath: vi.fn((uri: vscode.Uri | string) => {
      if (typeof uri === "string") return uri;
      return uri.fsPath?.replace("/test-workspace/", "") || uri.path;
    }),
    openTextDocument: vi.fn(),
  },
  Uri: {
    file: vi.fn((path: string) => ({
      fsPath: path,
      scheme: "file",
      path: path,
    })),
    joinPath: vi.fn((base: vscode.Uri | string, ...paths: string[]) => {
      const basePath =
        typeof base === "string"
          ? base
          : (base as { fsPath?: string; path?: string }).fsPath ||
            (base as { fsPath?: string; path?: string }).path ||
            "";
      const joined = paths.join("/").replace(/^\.\./, "");
      return {
        fsPath: `${basePath}/${joined}`.replace(/\/+/g, "/"),
        scheme: "file",
        path: `${basePath}/${joined}`.replace(/\/+/g, "/"),
      };
    }),
  },
  window: {
    showTextDocument: vi.fn(),
  },
}));

describe("writeTestFileTool", () => {
  let approvalRegistry: Set<string>;
  let mockFs: {
    stat: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    createDirectory: ReturnType<typeof vi.fn>;
  };
  let mockWorkspace: typeof vscode.workspace;

  beforeEach(() => {
    approvalRegistry = new Set<string>();
    mockFs = vscode.workspace.fs;
    mockWorkspace = vscode.workspace;
    
    // Reset all mocks
    vi.clearAllMocks();
    
    // Default: file doesn't exist
    mockFs.stat.mockRejectedValue(new Error("File not found"));
    // Default: writeFile succeeds
    mockFs.writeFile.mockResolvedValue(undefined);
    // Default: createDirectory succeeds
    mockFs.createDirectory.mockResolvedValue(undefined);
    // Default: openTextDocument succeeds
    mockWorkspace.openTextDocument.mockResolvedValue({ uri: "file://test" });
  });

  describe("Happy Path", () => {
    it("should write test file when proposalId is approved", async () => {
      approvalRegistry.add("test-1");
      const tool = createWriteTestFileTool(approvalRegistry);

      const input: WriteTestFileInput = {
        proposalId: "test-1",
        testContent: 'describe("test", () => { it("works", () => {}); });',
        targetPath: "src/test.spec.ts",
      };

      const result = await executeTool(tool, input);

      expect(result.success).toBe(true);
      expect(result.filePath).toBe("src/test.spec.ts");
      expect(result.message).toContain("created");
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it("should create parent directories if they don't exist", async () => {
      approvalRegistry.add("test-2");
      const tool = createWriteTestFileTool(approvalRegistry);

      // Parent directory doesn't exist
      mockFs.stat.mockRejectedValue(new Error("Directory not found"));

      const input: WriteTestFileInput = {
        proposalId: "test-2",
        testContent: "test content",
        targetPath: "src/deep/nested/test.spec.ts",
      };

      await executeTool(tool, input);

      expect(mockFs.createDirectory).toHaveBeenCalled();
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it("should overwrite existing file when overwrite=true", async () => {
      approvalRegistry.add("test-3");
      const tool = createWriteTestFileTool(approvalRegistry);

      // File already exists
      mockFs.stat.mockResolvedValue({
        type: 1,
        ctime: Date.now(),
        mtime: Date.now(),
        size: 100,
      });

      const input: WriteTestFileInput = {
        proposalId: "test-3",
        testContent: "updated content",
        targetPath: "src/existing.spec.ts",
        overwrite: true,
      };

      const result = await executeTool(tool, input);

      expect(result.success).toBe(true);
      expect(result.message).toContain("updated");
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it("should normalize escaped characters in test content", async () => {
      approvalRegistry.add("test-4");
      const tool = createWriteTestFileTool(approvalRegistry);

      const input: WriteTestFileInput = {
        proposalId: "test-4",
        testContent: "line1\nline2\ttab",
        targetPath: "src/test.spec.ts",
      };

      await executeTool(tool, input);

      const writeCall = mockFs.writeFile.mock.calls[0];
      const writtenContent = writeCall[1].toString();
      expect(writtenContent).toContain("line1");
      expect(writtenContent).toContain("line2");
      expect(writtenContent).toContain("tab");
    });

    it("should handle absolute paths", async () => {
      approvalRegistry.add("test-5");
      const tool = createWriteTestFileTool(approvalRegistry);

      const input: WriteTestFileInput = {
        proposalId: "test-5",
        testContent: "test",
        targetPath: "/absolute/path/test.spec.ts",
      };

      const result = await executeTool(tool, input);

      expect(result.success).toBe(true);
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it("should open created file in editor", async () => {
      approvalRegistry.add("test-6");
      const tool = createWriteTestFileTool(approvalRegistry);

      const input: WriteTestFileInput = {
        proposalId: "test-6",
        testContent: "test",
        targetPath: "src/test.spec.ts",
      };

      await executeTool(tool, input);

      expect(mockWorkspace.openTextDocument).toHaveBeenCalled();
      expect(vscode.window.showTextDocument).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("should reject unapproved proposalId", async () => {
      const tool = createWriteTestFileTool(approvalRegistry);

      const input: WriteTestFileInput = {
        proposalId: "unapproved",
        testContent: "test",
        targetPath: "src/test.spec.ts",
      };

      const result = await executeTool(tool, input);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Invalid or unapproved proposalId");
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it("should return error when file exists and overwrite=false", async () => {
      approvalRegistry.add("test-7");
      const tool = createWriteTestFileTool(approvalRegistry);

      // File exists
      mockFs.stat.mockResolvedValue({
        type: 1,
        ctime: Date.now(),
        mtime: Date.now(),
        size: 100,
      });

      const input: WriteTestFileInput = {
        proposalId: "test-7",
        testContent: "test",
        targetPath: "src/existing.spec.ts",
        overwrite: false,
      };

      const result = await executeTool(tool, input);

      expect(result.success).toBe(false);
      expect(result.message).toContain("already exists");
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it("should handle write errors gracefully", async () => {
      approvalRegistry.add("test-8");
      const tool = createWriteTestFileTool(approvalRegistry);

      mockFs.writeFile.mockRejectedValue(new Error("Permission denied"));

      const input: WriteTestFileInput = {
        proposalId: "test-8",
        testContent: "test",
        targetPath: "src/test.spec.ts",
      };

      const result = await executeTool(tool, input);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Failed to write test file");
      expect(result.message).toContain("Permission denied");
    });

    it("should continue if opening file in editor fails", async () => {
      approvalRegistry.add("test-9");
      const tool = createWriteTestFileTool(approvalRegistry);

      mockWorkspace.openTextDocument.mockRejectedValue(
        new Error("Editor error"),
      );

      const input: WriteTestFileInput = {
        proposalId: "test-9",
        testContent: "test",
        targetPath: "src/test.spec.ts",
      };

      const result = await executeTool(tool, input);

      // Should still succeed even if editor opening fails
      expect(result.success).toBe(true);
      expect(mockFs.writeFile).toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty test content", async () => {
      approvalRegistry.add("test-10");
      const tool = createWriteTestFileTool(approvalRegistry);

      const input: WriteTestFileInput = {
        proposalId: "test-10",
        testContent: "",
        targetPath: "src/empty.spec.ts",
      };

      const result = await executeTool(tool, input);

      expect(result.success).toBe(true);
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Buffer),
      );
    });

    it("should handle special characters in file path", async () => {
      approvalRegistry.add("test-11");
      const tool = createWriteTestFileTool(approvalRegistry);

      const input: WriteTestFileInput = {
        proposalId: "test-11",
        testContent: "test",
        targetPath: "src/test (copy).spec.ts",
      };

      const result = await executeTool(tool, input);

      expect(result.success).toBe(true);
    });

    it("should handle very large test content", async () => {
      approvalRegistry.add("test-12");
      const tool = createWriteTestFileTool(approvalRegistry);

      const largeContent = "x".repeat(100000);

      const input: WriteTestFileInput = {
        proposalId: "test-12",
        testContent: largeContent,
        targetPath: "src/large.spec.ts",
      };

      const result = await executeTool(tool, input);

      expect(result.success).toBe(true);
      const writeCall = mockFs.writeFile.mock.calls[0];
      const writtenContent = writeCall[1].toString();
      expect(writtenContent.length).toBe(largeContent.length);
    });

    it("should handle multiple proposalIds in registry", async () => {
      approvalRegistry.add("test-13");
      approvalRegistry.add("test-14");
      approvalRegistry.add("test-15");
      
      const tool = createWriteTestFileTool(approvalRegistry);

      const input: WriteTestFileInput = {
        proposalId: "test-14",
        testContent: "test",
        targetPath: "src/test.spec.ts",
      };

      const result = await executeTool(tool, input);

      expect(result.success).toBe(true);
    });

    it("should handle relative paths with ..", async () => {
      approvalRegistry.add("test-16");
      const tool = createWriteTestFileTool(approvalRegistry);

      const input: WriteTestFileInput = {
        proposalId: "test-16",
        testContent: "test",
        targetPath: "../outside/test.spec.ts",
      };

      const result = await executeTool(tool, input);

      expect(result.success).toBe(true);
    });
  });
});
