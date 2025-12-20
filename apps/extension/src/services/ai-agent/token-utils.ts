/**
 * Token counting utilities for managing prompt sizes
 * Uses @anthropic-ai/tokenizer for accurate token counting
 */

import { countTokens } from "@anthropic-ai/tokenizer";

/**
 * Maximum tokens allowed per file before truncation
 * Set to ~50k to leave room for other context
 */
export const MAX_FILE_TOKENS = 50_000;

/**
 * Maximum total tokens for a single AI request
 * Set to ~150k to leave room for response generation
 */
export const MAX_TOTAL_TOKENS = 150_000;

/**
 * Count the number of tokens in a text string using Anthropic's tokenizer
 * This provides accurate token counts for Claude models
 */
export function countTokensInText(text: string): number {
  return countTokens(text);
}

/**
 * Estimate tokens for a file path (used for planning before reading)
 * This is a rough estimate based on typical file sizes
 *
 * Note: This is used for batching decisions before reading files.
 * Actual token counts are calculated after reading file contents.
 */
export function estimateFileTokens(_filePath: string): number {
  // Conservative estimate: assume average file is ~500 lines, ~80 chars per line
  // This is just for planning - actual size will be checked when reading
  // Using rough estimate: ~80 chars per line * 500 lines / 4 chars per token ≈ 10k tokens
  return 10_000; // Conservative default estimate
}

/**
 * Check if estimated tokens exceed the maximum
 */
export function exceedsMaxTokens(estimatedTokens: number): boolean {
  return estimatedTokens > MAX_TOTAL_TOKENS;
}

/**
 * Calculate how many lines to keep from a file to stay under token limit
 * Returns the number of lines to keep (from start and end)
 *
 * Uses actual token counting on sample lines to estimate tokens per line
 */
export function calculateTruncationLines(
  lines: string[],
  maxTokens: number = MAX_FILE_TOKENS,
): { keepFromStart: number; keepFromEnd: number } {
  // Sample first 10 lines to estimate tokens per line
  const sampleSize = Math.min(10, lines.length);
  let totalSampleTokens = 0;
  for (let i = 0; i < sampleSize; i++) {
    totalSampleTokens += countTokensInText(lines[i] || "");
  }

  const avgTokensPerLine = sampleSize > 0 ? totalSampleTokens / sampleSize : 20;
  const maxLines = Math.floor(maxTokens / Math.max(avgTokensPerLine, 1));

  // Keep 60% from start, 40% from end
  const keepFromStart = Math.floor(maxLines * 0.6);
  const keepFromEnd = Math.floor(maxLines * 0.4);

  return { keepFromStart, keepFromEnd };
}

/**
 * Split files into batches that fit within token limits
 */
export function batchFiles(
  files: string[],
  maxBatchTokens: number = MAX_TOTAL_TOKENS,
): string[][] {
  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentBatchTokens = 0;

  for (const file of files) {
    const estimatedTokens = estimateFileTokens(file);

    // If a single file exceeds the limit, put it in its own batch
    if (estimatedTokens > maxBatchTokens) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchTokens = 0;
      }
      batches.push([file]);
      continue;
    }

    // Check if adding this file would exceed the limit
    if (currentBatchTokens + estimatedTokens > maxBatchTokens) {
      batches.push(currentBatch);
      currentBatch = [file];
      currentBatchTokens = estimatedTokens;
    } else {
      currentBatch.push(file);
      currentBatchTokens += estimatedTokens;
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}
