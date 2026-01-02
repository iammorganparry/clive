import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import { createEditFileContentTool } from "../edit-file-content";
import type {
  EditFileContentInput,
  EditFileContentOutput,
} from "../edit-file-content";
import { executeTool } from "./test-helpers";
import { getVSCodeMock } from "../../../../__tests__/mock-factories/vscode-mock.js";

// Mock vscode globally for tools that use VSCodeService.Default internally
// Use setupVSCodeMock to ensure singleton pattern - same instance used everywhere
vi.mock("vscode", async () => {
  const { setupVSCodeMock } = await import(
    "../../../../__tests__/mock-factories/vscode-mock.js"
  );
  return setupVSCodeMock();
});

// Mock model content processor
vi.mock("../../../../utils/model-content-processor", () => ({
  processModelContent: vi.fn((content: string) => content),
}));

// Mock diff tracker service
vi.mock("../../../diff-tracker-service", () => ({
  getDiffTrackerService: vi.fn(() => ({
    registerBlock: vi.fn(),
    // Other methods can be added as needed
  })),
}));

describe("editFileContentTool", () => {
  let mockVscode: typeof vscode;
  let mockFs: {
    stat: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    readFile: ReturnType<typeof vi.fn>;
  };
  let mockDocument: {
    getText: ReturnType<typeof vi.fn>;
  };
  let streamingCallback:
    | ((chunk: {
        filePath: string;
        content: string;
        isComplete: boolean;
      }) => void)
    | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    streamingCallback = undefined;

    // Get the singleton mock instance that vi.mock("vscode") created
    // This is the same instance used by VSCodeService.Default
    mockVscode = getVSCodeMock() ?? vscode;

    mockFs = mockVscode.workspace.fs as unknown as {
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
    (
      mockVscode.workspace.openTextDocument as unknown as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValue(mockDocument as unknown as vscode.TextDocument);

    // Default: writeFile succeeds
    mockFs.writeFile.mockResolvedValue(undefined);
  });

  describe("SEARCH/REPLACE Diff Mode", () => {
    it("should apply single-block diff successfully", async () => {
      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\noriginal content\n=======\nnew content\n+++++++ REPLACE",
      };

      const result = await executeTool(
        tool,
        input,
        {} as EditFileContentOutput,
      );

      expect(result.success).toBe(true);
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it("should return error when SEARCH block not found", async () => {
      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\nnonexistent content\n=======\nnew content\n+++++++ REPLACE",
      };

      const result = await executeTool(
        tool,
        input,
        {} as EditFileContentOutput,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("does not match");
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it("should handle multiple SEARCH/REPLACE blocks", async () => {
      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
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

      const result = await executeTool(
        tool,
        input,
        {} as EditFileContentOutput,
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("2 edit blocks");
    });

    it("should handle legacy format SEARCH/REPLACE blocks", async () => {
      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
        targetPath: "src/test.ts",
        diff: "<<<<<<< SEARCH\noriginal content\n=======\nnew content\n>>>>>>> REPLACE",
      };

      const result = await executeTool(
        tool,
        input,
        {} as EditFileContentOutput,
      );

      // Should work with legacy format (though modern format is preferred)
      // The test verifies it doesn't crash
      expect(result).toBeDefined();
    });

    it("should handle empty SEARCH block (replace entire file)", async () => {
      mockDocument.getText.mockReturnValue("old content");
      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\n\n=======\nnew entire file\n+++++++ REPLACE",
      };

      const result = await executeTool(
        tool,
        input,
        {} as EditFileContentOutput,
      );

      expect(result.success).toBe(true);
    });
  });

  describe("File Validation", () => {
    it("should return error when file does not exist", async () => {
      mockFs.stat.mockRejectedValue(new Error("File not found"));

      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
        targetPath: "src/nonexistent.ts",
        diff: "------- SEARCH\nold\n=======\nnew\n+++++++ REPLACE",
      };

      const result = await executeTool(
        tool,
        input,
        {} as EditFileContentOutput,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("does not exist");
    });

    it("should handle absolute paths", async () => {
      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
        targetPath: "/absolute/path/test.ts",
        diff: "------- SEARCH\noriginal content\n=======\nnew content\n+++++++ REPLACE",
      };

      const result = await executeTool(
        tool,
        input,
        {} as EditFileContentOutput,
      );

      expect(result.success).toBe(true);
      expect(mockVscode.Uri.file).toHaveBeenCalledWith(
        "/absolute/path/test.ts",
      );
    });
  });

  describe("DiffTrackerService Integration", () => {
    it("should register block with DiffTrackerService before writing", async () => {
      const diffTrackerModule = await import("../../../diff-tracker-service");
      const mockDiffTrackerService = {
        registerBlock: vi.fn(),
      };
      vi.mocked(diffTrackerModule.getDiffTrackerService).mockReturnValue(
        mockDiffTrackerService as unknown as ReturnType<
          typeof diffTrackerModule.getDiffTrackerService
        >,
      );

      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\noriginal content\n=======\nnew content\n+++++++ REPLACE",
      };

      await executeTool(tool, input, {} as EditFileContentOutput);

      expect(mockDiffTrackerService.registerBlock).toHaveBeenCalled();
      expect(mockDiffTrackerService.registerBlock).toHaveBeenCalledWith(
        expect.any(String), // filePath
        expect.stringMatching(/^edit-/), // blockId with edit- prefix
        expect.objectContaining({
          startLine: expect.any(Number),
          endLine: expect.any(Number),
        }), // range
        expect.any(Array), // originalLines
        expect.any(Number), // newLineCount
        expect.any(String), // baseContent
        false, // not a new file
        expect.any(String), // newContent
      );
    });

    it("should write changes directly to file", async () => {
      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\noriginal content\n=======\nnew content\n+++++++ REPLACE",
      };

      await executeTool(tool, input, {} as EditFileContentOutput);

      expect(mockFs.writeFile).toHaveBeenCalled();
      const writeCall = mockFs.writeFile.mock.calls[0];
      const writtenContent = writeCall[1].toString();
      expect(writtenContent).toContain("new content");
    });

    it("should open file in editor after writing", async () => {
      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\noriginal content\n=======\nnew content\n+++++++ REPLACE",
      };

      await executeTool(tool, input, {} as EditFileContentOutput);

      expect(mockVscode.window.showTextDocument).toHaveBeenCalled();
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

      const tool = createEditFileContentTool(streamingCallback);

      const input: EditFileContentInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\noriginal content\n=======\nnew content\n+++++++ REPLACE",
      };

      await executeTool(tool, input, {} as EditFileContentOutput);

      expect(streamingChunks.length).toBeGreaterThan(0);
      expect(streamingChunks[0].isComplete).toBe(true);
      expect(streamingChunks[0].filePath).toBe("src/test.ts");
    });
  });

  describe("Error Handling", () => {
    it("should handle file read errors gracefully", async () => {
      (
        mockVscode.workspace.openTextDocument as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockRejectedValue(new Error("Cannot read file"));

      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\nold\n=======\nnew\n+++++++ REPLACE",
      };

      const result = await executeTool(
        tool,
        input,
        {} as EditFileContentOutput,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("error");
    });

    it("should return success message indicating pending review", async () => {
      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\noriginal content\n=======\nnew content\n+++++++ REPLACE",
      };

      const result = await executeTool(
        tool,
        input,
        {} as EditFileContentOutput,
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("pending user review");
      expect(result.message).toContain("CodeLens");
    });
  });

  describe("Three-tier Matching", () => {
    it("should match exact content", async () => {
      mockDocument.getText.mockReturnValue("exact match content");
      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\nexact match content\n=======\nnew content\n+++++++ REPLACE",
      };

      const result = await executeTool(
        tool,
        input,
        {} as EditFileContentOutput,
      );

      expect(result.success).toBe(true);
    });

    it("should match with line-trimmed fallback", async () => {
      mockDocument.getText.mockReturnValue("line1  \nline2\t\nline3");
      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\nline1\nline2\nline3\n=======\nnew content\n+++++++ REPLACE",
      };

      const result = await executeTool(
        tool,
        input,
        {} as EditFileContentOutput,
      );

      expect(result.success).toBe(true);
    });

    it("should match with block anchor for 3+ line blocks", async () => {
      mockDocument.getText.mockReturnValue("start\nmiddle1\nmiddle2\nend");
      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\nstart\nmiddle1\nmiddle2\nend\n=======\nnew content\n+++++++ REPLACE",
      };

      const result = await executeTool(
        tool,
        input,
        {} as EditFileContentOutput,
      );

      expect(result.success).toBe(true);
    });
  });
});
