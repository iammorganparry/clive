import { describe, expect, it } from "vitest";
import { computeLineDiff } from "../diff-engine";

describe("diff-engine", () => {
  describe("computeLineDiff", () => {
    it("should detect added lines", () => {
      const original = "line1\nline2\nline3";
      const modified = "line1\nline2\nnewline\nline3";

      const result = computeLineDiff(original, modified);

      // diffLines groups consecutive unchanged lines, so we get 3 changes:
      // unchanged (line1\nline2\n), added (newline\n), unchanged (line3)
      expect(result.changes).toHaveLength(3);
      expect(result.addedLineNumbers).toEqual([2]);
      expect(result.removedLineNumbers).toEqual([]);
    });

    it("should detect removed lines", () => {
      const original = "line1\nline2\nline3";
      const modified = "line1\nline3";

      const result = computeLineDiff(original, modified);

      expect(result.changes).toHaveLength(3); // unchanged, removed, unchanged
      expect(result.addedLineNumbers).toEqual([]);
      expect(result.removedLineNumbers).toEqual([1]);
    });

    it("should detect modified lines as removed + added", () => {
      const original = "line1\noldline\nline3";
      const modified = "line1\nnewline\nline3";

      const result = computeLineDiff(original, modified);

      expect(result.addedLineNumbers).toEqual([1]);
      expect(result.removedLineNumbers).toEqual([1]);
    });

    it("should handle multiple changes", () => {
      const original = "line1\nline2\nline3\nline4\nline5";
      const modified = "line1\nnewline2\nline3\nnewline4\nline5";

      const result = computeLineDiff(original, modified);

      expect(result.addedLineNumbers.length).toBeGreaterThan(0);
      expect(result.removedLineNumbers.length).toBeGreaterThan(0);
    });

    it("should handle empty original file", () => {
      const original = "";
      const modified = "line1\nline2";

      const result = computeLineDiff(original, modified);

      expect(result.addedLineNumbers).toEqual([0, 1]);
      expect(result.removedLineNumbers).toEqual([]);
    });

    it("should handle empty modified file", () => {
      const original = "line1\nline2";
      const modified = "";

      const result = computeLineDiff(original, modified);

      expect(result.addedLineNumbers).toEqual([]);
      expect(result.removedLineNumbers).toEqual([0, 1]);
    });

    it("should handle identical files", () => {
      const content = "line1\nline2\nline3";
      const result = computeLineDiff(content, content);

      expect(result.addedLineNumbers).toEqual([]);
      expect(result.removedLineNumbers).toEqual([]);
      expect(result.changes.every((c) => c.type === "unchanged")).toBe(true);
    });

    it("should handle single line files", () => {
      const original = "single";
      const modified = "different";

      const result = computeLineDiff(original, modified);

      expect(result.addedLineNumbers).toEqual([0]);
      expect(result.removedLineNumbers).toEqual([0]);
    });

    it("should correctly map line numbers for decorations", () => {
      const original = "line1\nline2\nline3\nline4";
      const modified = "line1\nnewline2\nnewline3\nline4";

      const result = computeLineDiff(original, modified);

      // Verify line numbers are 0-based
      expect(result.addedLineNumbers.every((n) => n >= 0)).toBe(true);
      expect(result.removedLineNumbers.every((n) => n >= 0)).toBe(true);
    });

    it("should handle files with no trailing newline", () => {
      const original = "line1\nline2";
      const modified = "line1\nline2\nline3";

      const result = computeLineDiff(original, modified);

      // diffLines treats "line2" (no trailing newline) as removed and "line2\nline3" as added
      // This is because diffLines normalizes newlines. The added lines are at indices 1 and 2.
      expect(result.addedLineNumbers).toEqual([1, 2]);
      expect(result.removedLineNumbers).toEqual([1]);
    });
  });
});
