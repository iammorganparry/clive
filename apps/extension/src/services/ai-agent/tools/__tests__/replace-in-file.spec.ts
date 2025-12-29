import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import { createReplaceInFileTool } from "../replace-in-file";
import type { ReplaceInFileInput, ReplaceInFileOutput } from "../replace-in-file";
import { executeTool } from "./test-helpers";

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

// Mock pending edit service
vi.mock("../../../pending-edit-service", () => ({
  registerPendingEditSync: vi.fn(),
}));

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

  describe("SEARCH/REPLACE Diff Mode", () => {
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

    it("should handle multiple SEARCH/REPLACE blocks", async () => {
      const { constructNewFileContent } = await import("../../diff");
      vi.mocked(constructNewFileContent).mockReturnValue({
        content: "replaced1\nreplaced2\nline 3",
      });

      const tool = createReplaceInFileTool();

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
        diff: `------- SEARCH
original content
=======
replaced1
+++++++ REPLACE

------- SEARCH
line 2
=======
replaced2
+++++++ REPLACE`,
      };

      const result = await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(result.success).toBe(true);
      expect(constructNewFileContent).toHaveBeenCalled();
    });
  });

  describe("File Validation", () => {
    it("should return error when file does not exist", async () => {
      mockFs.stat.mockRejectedValue(new Error("File not found"));

      const tool = createReplaceInFileTool();

      const input: ReplaceInFileInput = {
        targetPath: "src/nonexistent.ts",
        diff: "------- SEARCH\nold\n=======\nnew\n+++++++ REPLACE",
      };

      const result = await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(result.success).toBe(false);
      expect(result.message).toContain("does not exist");
    });

    it("should handle absolute paths", async () => {
      const { constructNewFileContent } = await import("../../diff");
      vi.mocked(constructNewFileContent).mockReturnValue({
        content: "new content\nline 2\nline 3",
      });

      const tool = createReplaceInFileTool();

      const input: ReplaceInFileInput = {
        targetPath: "/absolute/path/test.ts",
        diff: "------- SEARCH\noriginal content\n=======\nnew content\n+++++++ REPLACE",
      };

      const result = await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(result.success).toBe(true);
      expect(vscode.Uri.file).toHaveBeenCalledWith("/absolute/path/test.ts");
    });
  });

  describe("PendingEditService Integration", () => {
    it("should register pending edit before writing", async () => {
      const { constructNewFileContent } = await import("../../diff");
      const { registerPendingEditSync } = await import("../../../pending-edit-service");

      vi.mocked(constructNewFileContent).mockReturnValue({
        content: "new content\nline 2\nline 3",
      });

      const tool = createReplaceInFileTool();

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\noriginal content\n=======\nnew content\n+++++++ REPLACE",
      };

      await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(registerPendingEditSync).toHaveBeenCalled();
      // Verify it was called with the original content for revert capability
      expect(registerPendingEditSync).toHaveBeenCalledWith(
        expect.any(String),
        "original content\nline 2\nline 3",
        false, // not a new file
      );
    });

    it("should write changes directly to file", async () => {
      const { constructNewFileContent } = await import("../../diff");
      vi.mocked(constructNewFileContent).mockReturnValue({
        content: "new content\nline 2\nline 3",
      });

      const tool = createReplaceInFileTool();

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\noriginal content\n=======\nnew content\n+++++++ REPLACE",
      };

      await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(mockFs.writeFile).toHaveBeenCalled();
      const writeCall = mockFs.writeFile.mock.calls[0];
      const writtenContent = writeCall[1].toString();
      expect(writtenContent).toBe("new content\nline 2\nline 3");
    });

    it("should open file in editor after writing", async () => {
      const { constructNewFileContent } = await import("../../diff");
      vi.mocked(constructNewFileContent).mockReturnValue({
        content: "new content\nline 2\nline 3",
      });

      const tool = createReplaceInFileTool();

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\noriginal content\n=======\nnew content\n+++++++ REPLACE",
      };

      await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(vscode.window.showTextDocument).toHaveBeenCalled();
    });
  });

  describe("Streaming Output", () => {
    it("should call streaming callback on success", async () => {
      const { constructNewFileContent } = await import("../../diff");
      vi.mocked(constructNewFileContent).mockReturnValue({
        content: "new content\nline 2\nline 3",
      });

      const streamingChunks: Array<{
        filePath: string;
        content: string;
        isComplete: boolean;
      }> = [];
      streamingCallback = (chunk) => {
        streamingChunks.push(chunk);
      };

      const tool = createReplaceInFileTool(streamingCallback);

      const input: ReplaceInFileInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\noriginal content\n=======\nnew content\n+++++++ REPLACE",
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
        diff: "------- SEARCH\nold\n=======\nnew\n+++++++ REPLACE",
      };

      const result = await executeTool(tool, input, {} as ReplaceInFileOutput);

      expect(result.success).toBe(false);
      expect(result.message).toContain("error");
    });

    it("should return success message indicating pending review", async () => {
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
      expect(result.message).toContain("pending user review");
      expect(result.message).toContain("CodeLens");
    });
  });
});
