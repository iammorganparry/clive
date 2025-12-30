import { expect, vi, beforeEach, describe } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import * as vscode from "vscode";
import { createEditFileTool } from "../edit-file.js";
import type { EditFileInput, EditFileOutput } from "../edit-file.js";
import { executeTool } from "./test-helpers.js";
import { applyDiffDecorationsSync } from "../../../diff-decoration-service.js";

// Mock vscode module using shared factory
vi.mock("vscode", async () => {
  const { createVSCodeMock } = await import(
    "../../../../__tests__/mock-factories/index.js"
  );
  return createVSCodeMock();
});

// Mock pending edit service
vi.mock("../../../pending-edit-service.js", () => ({
  registerBlockSync: vi.fn(),
}));

// Mock diff decoration service
vi.mock("../../../diff-decoration-service.js", () => ({
  applyDiffDecorationsSync: vi.fn(),
}));

describe("editFileTool", () => {
  let mockFs: {
    stat: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockFs = vscode.workspace.fs as unknown as {
      stat: ReturnType<typeof vi.fn>;
      writeFile: ReturnType<typeof vi.fn>;
    };

    // Reset all mocks
    vi.clearAllMocks();

    // Reset diff decoration mock to no-op (success case)
    (applyDiffDecorationsSync as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        // no-op by default
      },
    );

    // Default: file exists
    mockFs.stat.mockResolvedValue({});

    // Default: writeFile succeeds
    mockFs.writeFile.mockResolvedValue(undefined);

    // Default: openTextDocument returns mock with test content
    (
      vscode.workspace.openTextDocument as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      uri: { fsPath: "/workspace/test.ts" },
      getText: () => "line 1\nline 2\nline 3\nline 4\nline 5",
      lineCount: 5,
    } as unknown as vscode.TextDocument);

    // Default: showTextDocument succeeds
    (
      vscode.window.showTextDocument as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      document: {
        getText: () => "line 1\nline 2\nline 3\nline 4\nline 5",
      },
      setDecorations: vi.fn(),
    } as unknown as vscode.TextEditor);
  });

  describe("Line-Based Editing", () => {
    it.effect("should replace a single line", () =>
      Effect.gen(function* () {
        const tool = yield* Effect.sync(() => createEditFileTool());

        const input: EditFileInput = {
          targetPath: "test.ts",
          edits: [
            {
              startLine: 2,
              endLine: 2,
              content: "modified line 2",
            },
          ],
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as EditFileOutput),
        );

        expect(result.success).toBe(true);
        expect(mockFs.writeFile).toHaveBeenCalledWith(
          expect.objectContaining({ fsPath: "/test-workspace/test.ts" }),
          expect.any(Buffer),
        );

        // Verify the content written
        const writtenBuffer = mockFs.writeFile.mock.calls[0][1];
        const writtenContent = Buffer.from(writtenBuffer as Buffer).toString(
          "utf-8",
        );
        expect(writtenContent).toBe(
          "line 1\nmodified line 2\nline 3\nline 4\nline 5",
        );
      }),
    );

    it.effect("should replace multiple lines", () =>
      Effect.gen(function* () {
        const tool = yield* Effect.sync(() => createEditFileTool());

        const input: EditFileInput = {
          targetPath: "test.ts",
          edits: [
            {
              startLine: 2,
              endLine: 4,
              content: "replaced lines 2-4",
            },
          ],
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as EditFileOutput),
        );

        expect(result.success).toBe(true);

        const writtenBuffer = mockFs.writeFile.mock.calls[0][1];
        const writtenContent = Buffer.from(writtenBuffer as Buffer).toString(
          "utf-8",
        );
        expect(writtenContent).toBe("line 1\nreplaced lines 2-4\nline 5");
      }),
    );

    it.effect("should replace with multi-line content", () =>
      Effect.gen(function* () {
        const tool = yield* Effect.sync(() => createEditFileTool());

        const input: EditFileInput = {
          targetPath: "test.ts",
          edits: [
            {
              startLine: 2,
              endLine: 3,
              content: "new line 1\nnew line 2\nnew line 3",
            },
          ],
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as EditFileOutput),
        );

        expect(result.success).toBe(true);

        const writtenBuffer = mockFs.writeFile.mock.calls[0][1];
        const writtenContent = Buffer.from(writtenBuffer as Buffer).toString(
          "utf-8",
        );
        expect(writtenContent).toBe(
          "line 1\nnew line 1\nnew line 2\nnew line 3\nline 4\nline 5",
        );
      }),
    );

    it.effect("should delete lines with empty content", () =>
      Effect.gen(function* () {
        const tool = yield* Effect.sync(() => createEditFileTool());

        const input: EditFileInput = {
          targetPath: "test.ts",
          edits: [
            {
              startLine: 2,
              endLine: 4,
              content: "",
            },
          ],
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as EditFileOutput),
        );

        expect(result.success).toBe(true);

        const writtenBuffer = mockFs.writeFile.mock.calls[0][1];
        const writtenContent = Buffer.from(writtenBuffer as Buffer).toString(
          "utf-8",
        );
        expect(writtenContent).toBe("line 1\nline 5");
      }),
    );

    it.effect("should insert lines when startLine > endLine", () =>
      Effect.gen(function* () {
        const tool = yield* Effect.sync(() => createEditFileTool());

        const input: EditFileInput = {
          targetPath: "test.ts",
          edits: [
            {
              startLine: 3,
              endLine: 2,
              content: "inserted after line 2",
            },
          ],
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as EditFileOutput),
        );

        expect(result.success).toBe(true);

        const writtenBuffer = mockFs.writeFile.mock.calls[0][1];
        const writtenContent = Buffer.from(writtenBuffer as Buffer).toString(
          "utf-8",
        );
        expect(writtenContent).toBe(
          "line 1\nline 2\ninserted after line 2\nline 3\nline 4\nline 5",
        );
      }),
    );

    it.effect("should apply multiple edits from bottom to top", () =>
      Effect.gen(function* () {
        const tool = yield* Effect.sync(() => createEditFileTool());

        const input: EditFileInput = {
          targetPath: "test.ts",
          edits: [
            {
              startLine: 1,
              endLine: 1,
              content: "modified line 1",
            },
            {
              startLine: 5,
              endLine: 5,
              content: "modified line 5",
            },
            {
              startLine: 3,
              endLine: 3,
              content: "modified line 3",
            },
          ],
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as EditFileOutput),
        );

        expect(result.success).toBe(true);

        const writtenBuffer = mockFs.writeFile.mock.calls[0][1];
        const writtenContent = Buffer.from(writtenBuffer as Buffer).toString(
          "utf-8",
        );
        expect(writtenContent).toBe(
          "modified line 1\nline 2\nmodified line 3\nline 4\nmodified line 5",
        );
      }),
    );
  });

  describe("Error Handling", () => {
    it.effect("should return error if file does not exist", () =>
      Effect.gen(function* () {
        mockFs.stat.mockRejectedValue(new Error("File not found"));

        const tool = yield* Effect.sync(() => createEditFileTool());

        const input: EditFileInput = {
          targetPath: "nonexistent.ts",
          edits: [
            {
              startLine: 1,
              endLine: 1,
              content: "test",
            },
          ],
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as EditFileOutput),
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain("does not exist");
      }),
    );

    it.effect("should return error if startLine is less than 1", () =>
      Effect.gen(function* () {
        const tool = yield* Effect.sync(() => createEditFileTool());

        const input: EditFileInput = {
          targetPath: "test.ts",
          edits: [
            {
              startLine: 0,
              endLine: 1,
              content: "test",
            },
          ],
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as EditFileOutput),
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain("Line numbers must be 1-based");
      }),
    );

    it.effect("should return error if line numbers exceed file length", () =>
      Effect.gen(function* () {
        const tool = yield* Effect.sync(() => createEditFileTool());

        const input: EditFileInput = {
          targetPath: "test.ts",
          edits: [
            {
              startLine: 10,
              endLine: 15,
              content: "test",
            },
          ],
        };

        const result = yield* Effect.promise(() =>
          executeTool(tool, input, {} as EditFileOutput),
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain("exceeds file length");
      }),
    );
  });

  describe("Streaming Callback", () => {
    it.effect("should call streaming callback with final content", () =>
      Effect.gen(function* () {
        const streamingCallback = vi.fn();
        const tool = yield* Effect.sync(() =>
          createEditFileTool(streamingCallback),
        );

        const input: EditFileInput = {
          targetPath: "test.ts",
          edits: [
            {
              startLine: 1,
              endLine: 1,
              content: "modified",
            },
          ],
        };

        yield* Effect.promise(() =>
          executeTool(tool, input, {} as EditFileOutput),
        );

        expect(streamingCallback).toHaveBeenCalledWith({
          filePath: "test.ts",
          content: expect.any(String),
          isComplete: true,
        });
      }),
    );
  });

  describe("Diff Decorations", () => {
    it.effect("should apply diff decorations after edit", () =>
      Effect.gen(function* () {
        const tool = yield* Effect.sync(() => createEditFileTool());

        const input: EditFileInput = {
          targetPath: "test.ts",
          edits: [
            {
              startLine: 1,
              endLine: 1,
              content: "modified",
            },
          ],
        };

        yield* Effect.promise(() =>
          executeTool(tool, input, {} as EditFileOutput),
        );

        expect(applyDiffDecorationsSync).toHaveBeenCalledWith(
          expect.objectContaining({
            document: expect.any(Object),
          }),
          "line 1\nline 2\nline 3\nline 4\nline 5",
          expect.any(String),
          false,
        );
      }),
    );
  });

  describe("Pending Edit Registration", () => {
    it.effect("should register block before writing", () =>
      Effect.gen(function* () {
        const { registerBlockSync } = yield* Effect.promise(
          () => import("../../../pending-edit-service.js"),
        );

        const tool = yield* Effect.sync(() => createEditFileTool());

        const input: EditFileInput = {
          targetPath: "test.ts",
          edits: [
            {
              startLine: 2,
              endLine: 3,
              content: "modified",
            },
          ],
        };

        yield* Effect.promise(() =>
          executeTool(tool, input, {} as EditFileOutput),
        );

        expect(registerBlockSync).toHaveBeenCalledWith(
          "/test-workspace/test.ts",
          expect.stringMatching(/^edit-/), // blockId (generated)
          2, // startLine
          2, // endLine after edit (adjusted)
          ["line 2", "line 3"], // originalLines
          1, // newLineCount
          "line 1\nline 2\nline 3\nline 4\nline 5", // baseContent
          false, // not a new file
        );
      }),
    );
  });
});
