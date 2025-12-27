import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import { Effect } from "effect";
import { createReplaceInFileTool } from "../replace-in-file";
import type { ReplaceInFileInput, ReplaceInFileOutput } from "../replace-in-file";
import { executeTool } from "./test-helpers";
import type { DiffContentProvider } from "../../../diff-content-provider";

// Mock vscode module using shared factory
vi.mock("vscode", async () => {
  const { createVSCodeMock } = await import("../../../../__tests__/mock-factories");
  return createVSCodeMock();
});

// Mock diff utilities
vi.mock("../../diff", () => ({
  constructNewFileContent: vi.fn(),
}));

// Mock model content processor
vi.mock("../../../../utils/model-content-processor", () => ({
  processModelContent: vi.fn((content: string) => content),
}));

// Mock DiffViewProvider
// Store the mock instance that will be returned
let currentMockInstance: unknown = null;

vi.mock("../../../diff-view-provider", async () => {
  const { Effect, Layer } = await import("effect");
  
  // DiffViewProvider mock that defers to currentMockInstance at runtime
  // The pipe() returns an Effect that will resolve to currentMockInstance when run
  const DiffViewProvider = {
    pipe: () => {
      // Return an Effect that captures currentMockInstance at execution time
      return Effect.sync(() => currentMockInstance);
    },
    Default: Layer.empty,
  };
  
  return {
    DiffViewProvider,
    DiffViewProviderDefault: Layer.empty,
  };
});

describe("replaceInFileTool", () => {
  let mockFs: {
    stat: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    readFile: ReturnType<typeof vi.fn>;
  };
  let mockDocument: {
    getText: ReturnType<typeof vi.fn>;
  };
  let streamingCallback: ((chunk: {
    filePath: string;
    content: string;
    isComplete: boolean;
  }) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    streamingCallback = undefined;
    currentMockInstance = null;

    mockFs = vscode.workspace.fs as unknown as {
      stat: ReturnType<typeof vi.fn>;
      writeFile: ReturnType<typeof vi.fn>;
      readFile: ReturnType<typeof vi.fn>;
    };

    mockDocument = {
      getText: vi.fn(() => "original content\nline 2\nline 3"),
    };

    // Default: file exists
    mockFs.stat.mockResolvedValue({
      type: 1,
      ctime: Date.now(),
      mtime: Date.now(),
      size: 100,
    });

    // Default: openTextDocument succeeds
    (vscode.workspace.openTextDocument as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockDocument as unknown as vscode.TextDocument,
    );

    // Default: writeFile succeeds
    mockFs.writeFile.mockResolvedValue(undefined);
  });

  describe("Legacy Single Search/Replace Mode", () => {
    it("should replace content successfully", async () => {
      const tool = createReplaceInFileTool();

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
        searchContent: "original content",
        replaceContent: "new content",
      };

      const result = await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(result.success).toBe(true);
      expect(result.filePath).toBe("src/test.ts");
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it("should return error when search content not found", async () => {
      const tool = createReplaceInFileTool();

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
        searchContent: "nonexistent content",
        replaceContent: "new content",
      };

      const result = await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Search content not found");
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it("should normalize escaped characters", async () => {
      // Override mock document for this test to include searchable content
      mockDocument.getText.mockReturnValue("line1\nline2\nline 3");

      const tool = createReplaceInFileTool();

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
        searchContent: "line1\nline2",
        replaceContent: "new1\nnew2",
      };

      await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(mockFs.writeFile).toHaveBeenCalled();
      const writeCall = mockFs.writeFile.mock.calls[0];
      const writtenContent = writeCall[1].toString();
      expect(writtenContent).toContain("new1");
      expect(writtenContent).toContain("new2");
    });
  });

  describe("Multi-Block SEARCH/REPLACE Mode", () => {
    it("should apply multi-block diff successfully", async () => {
      const { constructNewFileContent } = await import("../../diff");
      vi.mocked(constructNewFileContent).mockReturnValue({
        content: "new content\nline 2\nline 3",
      });

      const tool = createReplaceInFileTool();

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\noriginal content\n=======\nnew content\n+++++++ REPLACE",
      };

      const result = await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(result.success).toBe(true);
      expect(constructNewFileContent).toHaveBeenCalled();
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it("should return error when diff parsing fails", async () => {
      const { constructNewFileContent } = await import("../../diff");
      vi.mocked(constructNewFileContent).mockReturnValue({
        content: "original content\nline 2\nline 3",
        error: "SEARCH block not found",
      });

      const tool = createReplaceInFileTool();

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\nnonexistent\n=======\nnew\n+++++++ REPLACE",
      };

      const result = await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(result.success).toBe(false);
      expect(result.message).toContain("SEARCH block not found");
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe("File Validation", () => {
    it("should return error when file does not exist", async () => {
      mockFs.stat.mockRejectedValue(new Error("File not found"));

      const tool = createReplaceInFileTool();

      const input: ReplaceInFileInput = {
        targetPath: "src/nonexistent.ts",
        searchContent: "old",
        replaceContent: "new",
      };

      const result = await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(result.success).toBe(false);
      expect(result.message).toContain("does not exist");
    });

    it("should handle absolute paths", async () => {
      const tool = createReplaceInFileTool();

      const input: ReplaceInFileInput = {
        targetPath: "/absolute/path/test.ts",
        searchContent: "original content",
        replaceContent: "new content",
      };

      const result = await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(result.success).toBe(true);
      expect(vscode.Uri.file).toHaveBeenCalledWith("/absolute/path/test.ts");
    });
  });

  describe("Input Validation", () => {
    it("should return error when neither diff nor search/replace provided", async () => {
      const tool = createReplaceInFileTool();

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
      };

      const result = await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Either 'diff' parameter or both 'searchContent' and 'replaceContent'");
    });

    it("should return error when only searchContent provided", async () => {
      const tool = createReplaceInFileTool();

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
        searchContent: "old",
      };

      const result = await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Either 'diff' parameter or both 'searchContent' and 'replaceContent'");
    });
  });

  describe("Diff View Integration", () => {
    it("should use diff view when provider is available", async () => {
      const mockDiffProvider = {
        getOriginalContent: vi.fn(),
        getModifiedContent: vi.fn(),
      } as unknown as DiffContentProvider;

      const mockDiffViewInstance = {
        open: vi.fn(() => Effect.succeed({ success: true })),
        update: vi.fn(() => Effect.void),
        saveChanges: vi.fn(() =>
          Effect.succeed({
            success: true,
            finalContent: "new content\nline 2\nline 3",
          }),
        ),
        revertChanges: vi.fn(() => Effect.void),
        reset: vi.fn(() => Effect.void),
      };

      // Set the mock instance that will be returned by the service.create method
      currentMockInstance = mockDiffViewInstance;

      // Mock user approval
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
        "Approve" as unknown as vscode.MessageItem,
      );

      const tool = createReplaceInFileTool(mockDiffProvider);

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
        searchContent: "original content",
        replaceContent: "new content",
      };

      const result = await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(result.success).toBe(true);
      expect(mockDiffViewInstance.open).toHaveBeenCalled();
      expect(mockDiffViewInstance.update).toHaveBeenCalled();
      expect(mockDiffViewInstance.saveChanges).toHaveBeenCalled();
    });

    it("should handle user rejection in diff view", async () => {
      const mockDiffProvider = {
        getOriginalContent: vi.fn(),
        getModifiedContent: vi.fn(),
      } as unknown as DiffContentProvider;

      const mockDiffViewInstance = {
        open: vi.fn(() => Effect.succeed({ success: true })),
        update: vi.fn(() => Effect.void),
        revertChanges: vi.fn(() => Effect.void),
        reset: vi.fn(() => Effect.void),
      };

      // Set the mock instance that will be returned by the service.create method
      currentMockInstance = mockDiffViewInstance;

      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
        "Reject" as unknown as vscode.MessageItem,
      );

      const tool = createReplaceInFileTool(mockDiffProvider, undefined, false);

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
        searchContent: "original content",
        replaceContent: "new content",
      };

      const result = await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(result.success).toBe(false);
      expect(result.message).toContain("rejected");
      expect(mockDiffViewInstance.revertChanges).toHaveBeenCalled();
    });

    it("should auto-approve when autoApprove is true", async () => {
      const mockDiffProvider = {
        getOriginalContent: vi.fn(),
        getModifiedContent: vi.fn(),
      } as unknown as DiffContentProvider;

      const mockDiffViewInstance = {
        open: vi.fn(() => Effect.succeed({ success: true })),
        update: vi.fn(() => Effect.void),
        saveChanges: vi.fn(() =>
          Effect.succeed({
            success: true,
            finalContent: "new content\nline 2\nline 3",
          }),
        ),
        reset: vi.fn(() => Effect.void),
      };

      // Set the mock instance that will be returned by the service.create method
      currentMockInstance = mockDiffViewInstance;

      const tool = createReplaceInFileTool(mockDiffProvider, undefined, true);

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
        searchContent: "original content",
        replaceContent: "new content",
      };

      const result = await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(result.success).toBe(true);
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });
  });

  describe("Streaming Output", () => {
    it("should call streaming callback on success", async () => {
      const streamingChunks: Array<{
        filePath: string;
        content: string;
        isComplete: boolean;
      }> = [];
      streamingCallback = (chunk) => {
        streamingChunks.push(chunk);
      };

      const tool = createReplaceInFileTool(undefined, streamingCallback);

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
        searchContent: "original content",
        replaceContent: "new content",
      };

      await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(streamingChunks.length).toBeGreaterThan(0);
      expect(streamingChunks[0].isComplete).toBe(true);
      expect(streamingChunks[0].filePath).toBe("src/test.ts");
    });
  });

  describe("Error Handling", () => {
    it("should handle file read errors gracefully", async () => {
      (vscode.workspace.openTextDocument as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Cannot read file"),
      );

      const tool = createReplaceInFileTool();

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
        searchContent: "old",
        replaceContent: "new",
      };

      const result = await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(result.success).toBe(false);
      expect(result.message).toContain("error");
    });

    it("should handle diff view errors gracefully", async () => {
      const mockDiffProvider = {
        getOriginalContent: vi.fn(),
        getModifiedContent: vi.fn(),
      } as unknown as DiffContentProvider;

      const mockDiffViewInstance = {
        open: vi.fn(() => Effect.succeed({ success: false, error: "Failed to open" })),
      };

      // Set the mock instance that will be returned by the service.create method
      currentMockInstance = mockDiffViewInstance;

      const tool = createReplaceInFileTool(mockDiffProvider);

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
        searchContent: "original content",
        replaceContent: "new content",
      };

      const result = await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Failed to open diff view");
    });
  });
});

