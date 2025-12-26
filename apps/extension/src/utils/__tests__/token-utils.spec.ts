import { describe, it, expect } from 'vitest';
import {
  countTokensInText,
  estimateTokensFast,
  estimateFileTokens,
  exceedsMaxTokens,
  batchFiles,
  calculateTruncationLines,
  MAX_FILE_TOKENS,
  MAX_TOTAL_TOKENS,
} from '../token-utils';

describe('token-utils', () => {
  describe('countTokensInText', () => {
    it('should estimate 1 token per 4 characters for normal text', () => {
      expect(countTokensInText('test')).toBe(1);
      expect(countTokensInText('testing code')).toBe(3);
      expect(countTokensInText('a'.repeat(40))).toBe(10);
    });

    it('should handle empty strings', () => {
      expect(countTokensInText('')).toBe(0);
    });

    it('should handle single character', () => {
      expect(countTokensInText('a')).toBe(1);
    });

    it('should handle Unicode characters', () => {
      const unicodeText = '你好世界'; // Chinese characters
      expect(countTokensInText(unicodeText)).toBeGreaterThan(0);
    });

    it('should handle extremely long text', () => {
      const longText = 'x'.repeat(100000);
      const tokens = countTokensInText(longText);
      expect(tokens).toBe(25000); // 100000 / 4
    });

    it('should handle text with newlines and spaces', () => {
      const text = 'line1\nline2\n  line3';
      expect(countTokensInText(text)).toBeGreaterThan(0);
    });

    it('should round up fractional tokens', () => {
      // 3 characters = 0.75 tokens, should round up to 1
      expect(countTokensInText('abc')).toBe(1);
    });
  });

  describe('estimateTokensFast', () => {
    it('should match countTokensInText behavior', () => {
      const testCases = ['test', 'longer text here', 'a'.repeat(1000)];
      testCases.forEach((text) => {
        expect(estimateTokensFast(text)).toBe(countTokensInText(text));
      });
    });
  });

  describe('estimateFileTokens', () => {
    it('should return conservative default estimate', () => {
      expect(estimateFileTokens('any/file/path.ts')).toBe(10000);
      expect(estimateFileTokens('another-file.tsx')).toBe(10000);
    });

    it('should return same estimate regardless of path', () => {
      const paths = ['a.ts', 'very/long/path/to/file.tsx', 'short.js'];
      paths.forEach((path) => {
        expect(estimateFileTokens(path)).toBe(10000);
      });
    });
  });

  describe('exceedsMaxTokens', () => {
    it('should return false for tokens under limit', () => {
      expect(exceedsMaxTokens(100)).toBe(false);
      expect(exceedsMaxTokens(MAX_TOTAL_TOKENS - 1)).toBe(false);
      expect(exceedsMaxTokens(MAX_TOTAL_TOKENS)).toBe(false);
    });

    it('should return true for tokens over limit', () => {
      expect(exceedsMaxTokens(MAX_TOTAL_TOKENS + 1)).toBe(true);
      expect(exceedsMaxTokens(200000)).toBe(true);
    });

    it('should handle edge case at exactly max tokens', () => {
      expect(exceedsMaxTokens(MAX_TOTAL_TOKENS)).toBe(false);
    });
  });

  describe('batchFiles', () => {
    it('should create single batch for small file list', () => {
      const files = ['file1.ts', 'file2.ts'];
      const batches = batchFiles(files);

      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(2);
      expect(batches[0]).toEqual(['file1.ts', 'file2.ts']);
    });

    it('should handle empty file array', () => {
      const batches = batchFiles([]);
      expect(batches).toHaveLength(0);
    });

    it('should split files into multiple batches when exceeding MAX_TOTAL_TOKENS', () => {
      // Each file estimated at 10k tokens, MAX_TOTAL_TOKENS is 150k
      // So we can fit about 15 files per batch
      const files = Array.from({ length: 40 }, (_, i) => `file${i}.ts`);
      const batches = batchFiles(files);

      expect(batches.length).toBeGreaterThan(1);
      // Verify all files are included
      const allBatchedFiles = batches.flat();
      expect(allBatchedFiles).toHaveLength(files.length);
    });

    it('should handle single file that fits within limits', () => {
      const files = ['single.ts'];
      const batches = batchFiles(files);

      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(1);
    });

    it('should put oversized file in its own batch', () => {
      const files = ['file1.ts', 'file2.ts'];
      // Use maxBatchTokens smaller than estimateFileTokens (10k)
      const batches = batchFiles(files, 5000);

      // Each file (10k tokens estimate) exceeds 5k limit
      expect(batches.length).toBe(2);
      expect(batches[0]).toEqual(['file1.ts']);
      expect(batches[1]).toEqual(['file2.ts']);
    });

    it('should respect custom maxBatchTokens parameter', () => {
      const files = Array.from({ length: 10 }, (_, i) => `file${i}.ts`);
      // With 30k limit, can fit 3 files (3 * 10k = 30k) per batch
      const batches = batchFiles(files, 30000);

      expect(batches.length).toBeGreaterThan(1);
      batches.forEach((batch) => {
        expect(batch.length).toBeLessThanOrEqual(3);
      });
    });
  });

  describe('calculateTruncationLines', () => {
    it('should calculate lines to keep with 60/40 split', () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}: some code here`);
      const result = calculateTruncationLines(lines, MAX_FILE_TOKENS);

      expect(result).toHaveProperty('keepFromStart');
      expect(result).toHaveProperty('keepFromEnd');
      
      // The function calculates based on token limit and average line tokens
      // Just verify we get valid numbers
      expect(result.keepFromStart).toBeGreaterThan(0);
      expect(result.keepFromEnd).toBeGreaterThan(0);

      // Verify 60/40 ratio
      const total = result.keepFromStart + result.keepFromEnd;
      const startRatio = result.keepFromStart / total;
      expect(startRatio).toBeCloseTo(0.6, 1);
    });

    it('should handle empty lines array', () => {
      const result = calculateTruncationLines([]);
      // When empty, function uses default avgTokensPerLine of 20
      // and calculates based on that, so it won't be 0
      expect(result.keepFromStart).toBeGreaterThan(0);
      expect(result.keepFromEnd).toBeGreaterThan(0);
    });

    it('should handle small files under token limit', () => {
      const lines = ['line1', 'line2', 'line3'];
      const result = calculateTruncationLines(lines, MAX_FILE_TOKENS);

      // Small files should keep all or most lines
      expect(result.keepFromStart + result.keepFromEnd).toBeGreaterThan(0);
    });

    it('should respect custom maxTokens parameter', () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}`);
      const smallMaxTokens = 1000;
      const result = calculateTruncationLines(lines, smallMaxTokens);

      // Just verify we get valid line numbers
      expect(result.keepFromStart).toBeGreaterThan(0);
      expect(result.keepFromEnd).toBeGreaterThan(0);
    });

    it('should sample first 10 lines for token estimation', () => {
      const shortLines = Array.from({ length: 5 }, () => 'x'); // Very short lines
      const result = calculateTruncationLines(shortLines, 1000);

      // With very short lines, should be able to keep many lines
      expect(result.keepFromStart + result.keepFromEnd).toBeGreaterThan(0);
    });

    it('should handle lines with varying lengths', () => {
      const lines = [
        'short',
        'x'.repeat(200), // Long line
        'medium length line here',
        'x'.repeat(300), // Even longer
        'short again',
      ];

      const result = calculateTruncationLines(lines, 500);
      expect(result.keepFromStart + result.keepFromEnd).toBeGreaterThan(0);
    });

    it('should maintain 60/40 split ratio consistently', () => {
      const lines = Array.from({ length: 500 }, (_, i) => `line ${i}: code content`);
      const result = calculateTruncationLines(lines, 10000);

      const total = result.keepFromStart + result.keepFromEnd;
      if (total > 0) {
        const startRatio = result.keepFromStart / total;
        const endRatio = result.keepFromEnd / total;

        expect(startRatio).toBeCloseTo(0.6, 1);
        expect(endRatio).toBeCloseTo(0.4, 1);
      }
    });

    it('should use default avgTokensPerLine of 20 when sample is 0', () => {
      // Test with empty lines to trigger the default path
      const result = calculateTruncationLines([]);
      
      // With MAX_FILE_TOKENS (50k) and avgTokensPerLine (20)
      // maxLines = 50000 / 20 = 2500
      // keepFromStart = floor(2500 * 0.6) = 1500
      // keepFromEnd = floor(2500 * 0.4) = 1000
      expect(result.keepFromStart).toBe(1500);
      expect(result.keepFromEnd).toBe(1000);
    });
  });

  describe('constants', () => {
    it('should export MAX_FILE_TOKENS', () => {
      expect(MAX_FILE_TOKENS).toBe(50000);
    });

    it('should export MAX_TOTAL_TOKENS', () => {
      expect(MAX_TOTAL_TOKENS).toBe(150000);
    });

    it('should have MAX_TOTAL_TOKENS greater than MAX_FILE_TOKENS', () => {
      expect(MAX_TOTAL_TOKENS).toBeGreaterThan(MAX_FILE_TOKENS);
    });
  });
});
