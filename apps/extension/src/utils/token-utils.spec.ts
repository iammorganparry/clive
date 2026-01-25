import { describe, expect, it } from "vitest";
import {
  batchFiles,
  calculateTruncationLines,
  countTokensInText,
  estimateFileTokens,
  estimateTokensFast,
  exceedsMaxTokens,
  MAX_FILE_TOKENS,
  MAX_TOTAL_TOKENS,
} from "./token-utils";

describe("token-utils", () => {
  describe("countTokensInText", () => {
    it("should estimate tokens for simple text", () => {
      const text = "Hello world";
      const count = countTokensInText(text);
      expect(count).toBe(3); // 11 chars / 4 = 2.75, ceil = 3
    });

    it("should estimate tokens for empty string", () => {
      const count = countTokensInText("");
      expect(count).toBe(0);
    });

    it("should handle multi-line text", () => {
      const text = `Line 1
Line 2
Line 3`;
      const count = countTokensInText(text);
      expect(count).toBeGreaterThan(0);
      expect(count).toBe(Math.ceil(text.length / 4));
    });

    it("should handle special characters", () => {
      const text = "!@#$%^&*()_+-={}[]|:;,./";
      const count = countTokensInText(text);
      expect(count).toBeGreaterThan(0);
      expect(count).toBe(Math.ceil(text.length / 4));
    });

    it("should handle unicode characters", () => {
      const text = "你好世界 🌍";
      const count = countTokensInText(text);
      expect(count).toBeGreaterThan(0);
      expect(count).toBe(Math.ceil(text.length / 4));
    });

    it("should use 4 chars per token estimation", () => {
      const text = "1234"; // exactly 4 chars
      const count = countTokensInText(text);
      expect(count).toBe(1);
    });
  });

  describe("estimateTokensFast", () => {
    it("should provide fast estimation for text", () => {
      const text = "This is a sample text for token estimation";
      const estimate = estimateTokensFast(text);
      expect(estimate).toBe(Math.ceil(text.length / 4));
    });

    it("should return 0 for empty string", () => {
      const estimate = estimateTokensFast("");
      expect(estimate).toBe(0);
    });

    it("should scale with text length", () => {
      const shortText = "Hello";
      const longText = "Hello ".repeat(100);

      const shortEstimate = estimateTokensFast(shortText);
      const longEstimate = estimateTokensFast(longText);

      expect(longEstimate).toBeGreaterThan(shortEstimate * 50);
    });

    it("should match countTokensInText results", () => {
      const text = "Some test text for estimation";
      expect(estimateTokensFast(text)).toBe(countTokensInText(text));
    });
  });

  describe("estimateFileTokens", () => {
    it("should return conservative default estimate", () => {
      const estimate = estimateFileTokens("example.ts");
      expect(estimate).toBe(10000);
    });

    it("should return same estimate for any file path", () => {
      const jsEstimate = estimateFileTokens("example.js");
      const tsEstimate = estimateFileTokens("example.ts");
      const txtEstimate = estimateFileTokens("example.txt");

      expect(jsEstimate).toBe(10000);
      expect(tsEstimate).toBe(10000);
      expect(txtEstimate).toBe(10000);
    });

    it("should be used for planning before reading files", () => {
      // This function provides a rough estimate without reading file content
      const estimate = estimateFileTokens("unknown-size-file.ts");
      expect(estimate).toBe(10000);
    });
  });

  describe("exceedsMaxTokens", () => {
    it("should return false when tokens are below max", () => {
      const result = exceedsMaxTokens(1000);
      expect(result).toBe(false);
    });

    it("should return true when tokens exceed max", () => {
      const result = exceedsMaxTokens(MAX_TOTAL_TOKENS + 1);
      expect(result).toBe(true);
    });

    it("should return false when tokens equal max", () => {
      const result = exceedsMaxTokens(MAX_TOTAL_TOKENS);
      expect(result).toBe(false);
    });

    it("should handle edge case of 0 tokens", () => {
      const result = exceedsMaxTokens(0);
      expect(result).toBe(false);
    });

    it("should use MAX_TOTAL_TOKENS constant", () => {
      const justUnder = MAX_TOTAL_TOKENS - 1;
      const justOver = MAX_TOTAL_TOKENS + 1;

      expect(exceedsMaxTokens(justUnder)).toBe(false);
      expect(exceedsMaxTokens(justOver)).toBe(true);
    });
  });

  describe("calculateTruncationLines", () => {
    it("should calculate lines to keep from start and end", () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i}`);
      const result = calculateTruncationLines(lines, 5000);

      expect(result.keepFromStart).toBeGreaterThan(0);
      expect(result.keepFromEnd).toBeGreaterThan(0);
      expect(typeof result.keepFromStart).toBe("number");
      expect(typeof result.keepFromEnd).toBe("number");
    });

    it("should keep 60% from start and 40% from end", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}`);
      const result = calculateTruncationLines(lines, 1000);

      const totalLines = result.keepFromStart + result.keepFromEnd;
      const ratio = result.keepFromStart / totalLines;

      // Should be approximately 60/40 split
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(0.7);
    });

    it("should handle empty array with fallback estimation", () => {
      const result = calculateTruncationLines([], 1000);

      // With no sample lines, function uses fallback of 20 tokens per line
      // maxLines = 1000 / 20 = 50
      // keepFromStart = 50 * 0.6 = 30
      // keepFromEnd = 50 * 0.4 = 20
      expect(result.keepFromStart).toBe(30);
      expect(result.keepFromEnd).toBe(20);
    });

    it("should handle small line arrays", () => {
      const lines = ["Line 1", "Line 2", "Line 3"];
      const result = calculateTruncationLines(lines, 1000);

      expect(result.keepFromStart).toBeGreaterThanOrEqual(0);
      expect(result.keepFromEnd).toBeGreaterThanOrEqual(0);
    });

    it("should scale with token budget", () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i}`);
      const smallBudget = calculateTruncationLines(lines, 1000);
      const largeBudget = calculateTruncationLines(lines, 10000);

      expect(largeBudget.keepFromStart).toBeGreaterThan(
        smallBudget.keepFromStart,
      );
      expect(largeBudget.keepFromEnd).toBeGreaterThan(smallBudget.keepFromEnd);
    });

    it("should use default MAX_FILE_TOKENS when not specified", () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i}`);
      const resultDefault = calculateTruncationLines(lines);
      const resultExplicit = calculateTruncationLines(lines, MAX_FILE_TOKENS);

      expect(resultDefault.keepFromStart).toBe(resultExplicit.keepFromStart);
      expect(resultDefault.keepFromEnd).toBe(resultExplicit.keepFromEnd);
    });
  });

  describe("batchFiles", () => {
    it("should batch files within token limits", () => {
      const files = ["file1.ts", "file2.ts", "file3.ts"];
      const batches = batchFiles(files, 25000);

      expect(batches.length).toBeGreaterThan(0);
      expect(batches.flat()).toHaveLength(files.length);
    });

    it("should put single large file in its own batch", () => {
      const files = ["large-file.ts"];
      const batches = batchFiles(files, 5000); // Less than default estimate

      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(1);
      expect(batches[0]?.[0]).toBe("large-file.ts");
    });

    it("should split files into multiple batches when needed", () => {
      const files = Array.from({ length: 20 }, (_, i) => `file${i}.ts`);
      const batches = batchFiles(files, 25000);

      expect(batches.length).toBeGreaterThan(1);
    });

    it("should not exceed token limit per batch", () => {
      const files = ["file1.ts", "file2.ts", "file3.ts", "file4.ts"];
      const maxBatchTokens = 25000;
      const batches = batchFiles(files, maxBatchTokens);

      for (const batch of batches) {
        const batchTokens = batch.length * estimateFileTokens("dummy.ts");
        expect(batchTokens).toBeLessThanOrEqual(
          maxBatchTokens + estimateFileTokens("dummy.ts"),
        );
      }
    });

    it("should handle empty file list", () => {
      const batches = batchFiles([]);
      expect(batches).toHaveLength(0);
    });

    it("should use default MAX_TOTAL_TOKENS when not specified", () => {
      const files = ["file1.ts", "file2.ts"];
      const batchesDefault = batchFiles(files);
      const batchesExplicit = batchFiles(files, MAX_TOTAL_TOKENS);

      expect(batchesDefault).toEqual(batchesExplicit);
    });

    it("should preserve file order within batches", () => {
      const files = ["a.ts", "b.ts", "c.ts"];
      const batches = batchFiles(files, MAX_TOTAL_TOKENS);

      const flattenedFiles = batches.flat();
      expect(flattenedFiles).toEqual(files);
    });
  });
});
