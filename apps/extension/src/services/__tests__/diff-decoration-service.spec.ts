import { expect, vi, beforeEach, describe } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import type * as vscode from "vscode";
import { DiffDecorationService } from "../diff-decoration-service";

// Mock decoration type instance
const mockDecorationType = {
  dispose: vi.fn(),
};

// Mock vscode module with decoration support
const mockWindow = {
  createTextEditorDecorationType: vi.fn(() => mockDecorationType),
  visibleTextEditors: [] as vscode.TextEditor[],
};

vi.mock("vscode", () => ({
  window: mockWindow,
  workspace: {},
  Range: class MockRange {
    constructor(
      public start: { line: number; character: number },
      public end: { line: number; character: number },
    ) {}
  },
  Position: class MockPosition {
    constructor(
      public line: number,
      public character: number,
    ) {}
  },
}));

// Mock diff-engine
vi.mock("../ai-agent/tools/diff-engine", () => ({
  computeLineDiff: vi.fn(),
}));

describe("DiffDecorationService", () => {
  let mockEditor: {
    document: {
      uri: { fsPath: string };
      lineCount: number;
    };
    setDecorations: ReturnType<typeof vi.fn>;
  };
  let mockComputeLineDiff: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import mocked computeLineDiff
    const diffEngine = await import("../ai-agent/tools/diff-engine");
    mockComputeLineDiff = diffEngine.computeLineDiff as ReturnType<
      typeof vi.fn
    >;

    // Create mock editor
    mockEditor = {
      document: {
        uri: { fsPath: "/test/file.ts" },
        lineCount: 5,
      },
      setDecorations: vi.fn(),
    };
  });

  describe("applyDiffDecorations", () => {
    it.effect("should apply decorations for a new file (all lines green)", () =>
      Effect.gen(function* () {
        // Create service instance
        const service = yield* DiffDecorationService;

        const originalContent = "";
        const newContent = "line 1\nline 2\nline 3\nline 4\nline 5";

        // Apply decorations
        yield* service.applyDiffDecorations(
          mockEditor as unknown as vscode.TextEditor,
          originalContent,
          newContent,
          true, // isNewFile
        );

        // Verify setDecorations was called with green ranges for all lines
        yield* Effect.sync(() => {
          expect(mockEditor.setDecorations).toHaveBeenCalledTimes(1);
          const [_decorationType, ranges] =
            mockEditor.setDecorations.mock.calls[0];
          expect(ranges).toHaveLength(1);
          expect(ranges[0].start.line).toBe(0);
          expect(ranges[0].end.line).toBe(4); // lineCount - 1
        });
      }).pipe(Effect.provide(DiffDecorationService.Default)),
    );

    it.effect("should apply decorations for added lines using Myers diff", () =>
      Effect.gen(function* () {
        // Mock computeLineDiff to return added lines
        yield* Effect.sync(() => {
          mockComputeLineDiff.mockReturnValue({
            changes: [
              { type: "unchanged", lineStart: 0, lineCount: 2 },
              { type: "added", lineStart: 2, lineCount: 2 },
              { type: "unchanged", lineStart: 4, lineCount: 1 },
            ],
          });
        });

        const service = yield* DiffDecorationService;
        const originalContent = "line 1\nline 2\nline 5";
        const newContent = "line 1\nline 2\nline 3\nline 4\nline 5";

        // Apply decorations
        yield* service.applyDiffDecorations(
          mockEditor as unknown as vscode.TextEditor,
          originalContent,
          newContent,
          false, // not a new file
        );

        // Verify added lines (lines 2-3, 0-indexed) have green decoration
        yield* Effect.sync(() => {
          expect(mockComputeLineDiff).toHaveBeenCalledWith(
            originalContent,
            newContent,
          );
          expect(mockEditor.setDecorations).toHaveBeenCalledTimes(2); // once for added, once for removed

          // Check added decoration call (first call)
          const [_decorationType, addedRanges] =
            mockEditor.setDecorations.mock.calls[0];
          expect(addedRanges).toHaveLength(1);
          expect(addedRanges[0].start.line).toBe(2);
          expect(addedRanges[0].end.line).toBe(3); // endLine is 2 + 2 - 1 = 3
        });
      }).pipe(Effect.provide(DiffDecorationService.Default)),
    );

    it.effect(
      "should apply decorations for removed lines using Myers diff",
      () =>
        Effect.gen(function* () {
          // Mock computeLineDiff to return removed lines
          yield* Effect.sync(() => {
            mockComputeLineDiff.mockReturnValue({
              changes: [
                { type: "unchanged", lineStart: 0, lineCount: 2 },
                { type: "removed", lineStart: 2, lineCount: 2 },
                { type: "unchanged", lineStart: 4, lineCount: 1 },
              ],
            });
          });

          const service = yield* DiffDecorationService;
          const originalContent = "line 1\nline 2\nline 3\nline 4\nline 5";
          const newContent = "line 1\nline 2\nline 5";

          // Apply decorations
          yield* service.applyDiffDecorations(
            mockEditor as unknown as vscode.TextEditor,
            originalContent,
            newContent,
            false,
          );

          // Verify removed lines (lines 2-3) have red decoration
          yield* Effect.sync(() => {
            expect(mockComputeLineDiff).toHaveBeenCalledWith(
              originalContent,
              newContent,
            );
            expect(mockEditor.setDecorations).toHaveBeenCalledTimes(2);

            // Check removed decoration call (second call)
            const [_decorationType, removedRanges] =
              mockEditor.setDecorations.mock.calls[1];
            expect(removedRanges).toHaveLength(1);
            expect(removedRanges[0].start.line).toBe(2);
            expect(removedRanges[0].end.line).toBe(3);
          });
        }).pipe(Effect.provide(DiffDecorationService.Default)),
    );

    it.effect("should handle mixed added and removed lines", () =>
      Effect.gen(function* () {
        // Mock computeLineDiff to return both added and removed lines
        yield* Effect.sync(() => {
          mockComputeLineDiff.mockReturnValue({
            changes: [
              { type: "unchanged", lineStart: 0, lineCount: 1 },
              { type: "removed", lineStart: 1, lineCount: 1 },
              { type: "added", lineStart: 1, lineCount: 2 },
              { type: "unchanged", lineStart: 3, lineCount: 1 },
            ],
          });
        });

        const service = yield* DiffDecorationService;
        const originalContent = "line 1\nold line\nline 3";
        const newContent = "line 1\nnew line A\nnew line B\nline 3";

        yield* service.applyDiffDecorations(
          mockEditor as unknown as vscode.TextEditor,
          originalContent,
          newContent,
          false,
        );

        yield* Effect.sync(() => {
          expect(mockEditor.setDecorations).toHaveBeenCalledTimes(2);

          // Check added decorations
          const [_addedDecorationType, addedRanges] =
            mockEditor.setDecorations.mock.calls[0];
          expect(addedRanges).toHaveLength(1);
          expect(addedRanges[0].start.line).toBe(1);
          expect(addedRanges[0].end.line).toBe(2); // 1 + 2 - 1

          // Check removed decorations
          const [_removedDecorationType, removedRanges] =
            mockEditor.setDecorations.mock.calls[1];
          expect(removedRanges).toHaveLength(1);
          expect(removedRanges[0].start.line).toBe(1);
          expect(removedRanges[0].end.line).toBe(1);
        });
      }).pipe(Effect.provide(DiffDecorationService.Default)),
    );
  });

  describe("clearDecorations", () => {
    it.effect("should clear decorations for a specific file", () =>
      Effect.gen(function* () {
        const service = yield* DiffDecorationService;
        const filePath = "/test/file.ts";

        // First apply decorations
        yield* Effect.sync(() => {
          mockComputeLineDiff.mockReturnValue({
            changes: [{ type: "added", lineStart: 0, lineCount: 2 }],
          });
        });

        yield* service.applyDiffDecorations(
          mockEditor as unknown as vscode.TextEditor,
          "",
          "line 1\nline 2",
          false,
        );

        // Add the editor to visibleTextEditors so clearDecorations can find it
        yield* Effect.sync(() => {
          mockWindow.visibleTextEditors = [
            mockEditor as unknown as vscode.TextEditor,
          ];
        });

        // Clear decorations
        yield* service.clearDecorations(filePath);

        // Verify decorations were cleared
        yield* Effect.sync(() => {
          // setDecorations called 3 times: 2 for apply (added, removed), 2 for clear (added, removed)
          expect(mockEditor.setDecorations).toHaveBeenCalledTimes(4);

          // Check clear calls (last 2 calls) have empty arrays
          const [_clearAddedType, clearAddedRanges] =
            mockEditor.setDecorations.mock.calls[2];
          const [_clearRemovedType, clearRemovedRanges] =
            mockEditor.setDecorations.mock.calls[3];
          expect(clearAddedRanges).toEqual([]);
          expect(clearRemovedRanges).toEqual([]);
        });

        // Verify state was removed
        const state = yield* service.getDecorationState(filePath);
        yield* Effect.sync(() => {
          expect(state).toBeUndefined();
        });
      }).pipe(Effect.provide(DiffDecorationService.Default)),
    );
  });

  describe("getDecorationState", () => {
    it.effect("should return decoration state for a file", () =>
      Effect.gen(function* () {
        const service = yield* DiffDecorationService;
        const filePath = "/test/file.ts";

        // Apply decorations
        yield* Effect.sync(() => {
          mockComputeLineDiff.mockReturnValue({
            changes: [
              { type: "added", lineStart: 0, lineCount: 2 },
              { type: "removed", lineStart: 2, lineCount: 1 },
            ],
          });
        });

        const originalContent = "line 1\nline 2\nold line";
        const newContent = "new line 1\nnew line 2";

        yield* service.applyDiffDecorations(
          mockEditor as unknown as vscode.TextEditor,
          originalContent,
          newContent,
          false,
        );

        // Get decoration state
        const state = yield* service.getDecorationState(filePath);

        // Verify state
        yield* Effect.sync(() => {
          expect(state).toBeDefined();
          expect(state?.filePath).toBe(filePath);
          expect(state?.addedRanges).toHaveLength(1);
          expect(state?.removedRanges).toHaveLength(1);
          expect(state?.originalLineCount).toBe(3);
          expect(state?.newLineCount).toBe(2);
        });
      }).pipe(Effect.provide(DiffDecorationService.Default)),
    );

    it.effect("should return undefined for non-existent file", () =>
      Effect.gen(function* () {
        const service = yield* DiffDecorationService;
        const state = yield* service.getDecorationState(
          "/non/existent/file.ts",
        );

        yield* Effect.sync(() => {
          expect(state).toBeUndefined();
        });
      }).pipe(Effect.provide(DiffDecorationService.Default)),
    );
  });

  describe("clearAllDecorations", () => {
    it.effect("should clear decorations for all files", () =>
      Effect.gen(function* () {
        const service = yield* DiffDecorationService;

        // Create two mock editors
        const mockEditor1 = {
          document: {
            uri: { fsPath: "/test/file1.ts" },
            lineCount: 3,
          },
          setDecorations: vi.fn(),
        };

        const mockEditor2 = {
          document: {
            uri: { fsPath: "/test/file2.ts" },
            lineCount: 3,
          },
          setDecorations: vi.fn(),
        };

        // Apply decorations to both files
        yield* Effect.sync(() => {
          mockComputeLineDiff.mockReturnValue({
            changes: [{ type: "added", lineStart: 0, lineCount: 1 }],
          });
        });

        yield* service.applyDiffDecorations(
          mockEditor1 as unknown as vscode.TextEditor,
          "",
          "line 1",
          false,
        );

        yield* service.applyDiffDecorations(
          mockEditor2 as unknown as vscode.TextEditor,
          "",
          "line 1",
          false,
        );

        // Add editors to visibleTextEditors
        yield* Effect.sync(() => {
          mockWindow.visibleTextEditors = [
            mockEditor1 as unknown as vscode.TextEditor,
            mockEditor2 as unknown as vscode.TextEditor,
          ];
        });

        // Clear all decorations
        yield* service.clearAllDecorations();

        // Verify both editors had decorations cleared
        yield* Effect.sync(() => {
          // Each editor: 2 calls for apply (added, removed), 2 calls for clear (added, removed)
          expect(mockEditor1.setDecorations).toHaveBeenCalledTimes(4);
          expect(mockEditor2.setDecorations).toHaveBeenCalledTimes(4);
        });

        // Verify state was cleared for both files
        const state1 = yield* service.getDecorationState("/test/file1.ts");
        const state2 = yield* service.getDecorationState("/test/file2.ts");

        yield* Effect.sync(() => {
          expect(state1).toBeUndefined();
          expect(state2).toBeUndefined();
        });
      }).pipe(Effect.provide(DiffDecorationService.Default)),
    );
  });
});
