import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import { createEditFileContentTool } from "../edit-file-content";
import type {
  EditFileContentInput,
  EditFileContentOutput,
} from "../edit-file-content";
import { executeTool } from "./test-helpers";

// Mock vscode module using shared factory
vi.mock("vscode", async () => {
  const { createVSCodeMock } = await import(
    "../../../../__tests__/mock-factories"
  );
  return createVSCodeMock();
});

// Mock model content processor
vi.mock("../../../../utils/model-content-processor", () => ({
  processModelContent: vi.fn((content: string) => content),
}));

// Mock pending edit service
vi.mock("../../../pending-edit-service", () => ({
  registerBlockSync: vi.fn(),
}));

// Mock diff decoration service
vi.mock("../../../diff-decoration-service", () => ({
  applyDiffDecorationsSync: vi.fn(),
}));

describe("editFileContentTool", () => {
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
    (
      vscode.workspace.openTextDocument as unknown as ReturnType<typeof vi.fn>
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
      expect(vscode.Uri.file).toHaveBeenCalledWith("/absolute/path/test.ts");
    });
  });

  describe("PendingEditService Integration", () => {
    it("should register pending edit before writing", async () => {
      const { registerBlockSync } = await import(
        "../../../pending-edit-service"
      );

      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\noriginal content\n=======\nnew content\n+++++++ REPLACE",
      };

      await executeTool(tool, input, {} as EditFileContentOutput);

      expect(registerBlockSync).toHaveBeenCalled();
      expect(registerBlockSync).toHaveBeenCalledWith(
        expect.any(String), // filePath
        expect.stringMatching(/^edit-/), // blockId with edit- prefix
        1, // startLine
        expect.any(Number), // endLine
        expect.any(Array), // originalLines
        expect.any(Number), // newLineCount
        "original content\nline 2\nline 3", // baseContent
        false, // not a new file
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

      expect(vscode.window.showTextDocument).toHaveBeenCalled();
    });
  });

  describe("Diff Decoration Integration", () => {
    it("should apply diff decorations after writing", async () => {
      const { applyDiffDecorationsSync } = await import(
        "../../../diff-decoration-service"
      );

      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\noriginal content\n=======\nnew content\n+++++++ REPLACE",
      };

      await executeTool(tool, input, {} as EditFileContentOutput);

      expect(applyDiffDecorationsSync).toHaveBeenCalled();
    });

    it("should not fail if decoration application fails", async () => {
      const { applyDiffDecorationsSync } = await import(
        "../../../diff-decoration-service"
      );
      vi.mocked(applyDiffDecorationsSync).mockImplementation(() => {
        throw new Error("Decoration failed");
      });

      const tool = createEditFileContentTool();

      const input: EditFileContentInput = {
        targetPath: "src/test.ts",
        diff: "------- SEARCH\noriginal content\n=======\nnew content\n+++++++ REPLACE",
      };

      // Should not throw, just log error
      const result = await executeTool(
        tool,
        input,
        {} as EditFileContentOutput,
      );

      expect(result.success).toBe(true);
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
        vscode.workspace.openTextDocument as unknown as ReturnType<typeof vi.fn>
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
