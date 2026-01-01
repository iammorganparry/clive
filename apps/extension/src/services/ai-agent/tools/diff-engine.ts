/**
 * Myers diff algorithm implementation for computing line-level diffs
 * Used for accurate visual decorations in the Code Lens UI
 */

import { type Change, diffLines } from "diff";

/**
 * Represents a single line change in the diff
 */
export interface LineChange {
  type: "added" | "removed" | "unchanged";
  lineStart: number; // 0-based line number in the respective content
  lineCount: number;
  content: string;
}

/**
 * Result of computing a diff between two file contents
 */
export interface DiffResult {
  changes: LineChange[];
  addedLineNumbers: number[]; // Lines added in new content (for green highlight)
  removedLineNumbers: number[]; // Lines removed from original (for tracking)
}

/**
 * Compute line-level diff using Myers algorithm
 * Returns structured changes with line numbers for decoration
 *
 * @param original The original file content
 * @param modified The modified file content
 * @returns DiffResult with line-level changes
 */
export function computeLineDiff(
  original: string,
  modified: string,
): DiffResult {
  const changes: LineChange[] = [];
  const addedLineNumbers: number[] = [];
  const removedLineNumbers: number[] = [];

  // Use diff package's diffLines which implements Myers algorithm
  const diffResult: Change[] = diffLines(original, modified);

  let originalLineIndex = 0;
  let modifiedLineIndex = 0;

  for (const change of diffResult) {
    const lines = change.value.split("\n");
    // Remove trailing empty line if present (diffLines includes trailing newline)
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    if (change.added) {
      // Lines added in modified content
      const lineStart = modifiedLineIndex;
      const lineCount = lines.length;

      changes.push({
        type: "added",
        lineStart,
        lineCount,
        content: change.value,
      });

      // Track all added line numbers
      for (let i = 0; i < lineCount; i++) {
        addedLineNumbers.push(lineStart + i);
      }

      modifiedLineIndex += lineCount;
    } else if (change.removed) {
      // Lines removed from original content
      const lineStart = originalLineIndex;
      const lineCount = lines.length;

      changes.push({
        type: "removed",
        lineStart,
        lineCount,
        content: change.value,
      });

      // Track all removed line numbers
      for (let i = 0; i < lineCount; i++) {
        removedLineNumbers.push(lineStart + i);
      }

      originalLineIndex += lineCount;
    } else {
      // Unchanged lines
      const lineCount = lines.length;

      changes.push({
        type: "unchanged",
        lineStart: originalLineIndex,
        lineCount,
        content: change.value,
      });

      originalLineIndex += lineCount;
      modifiedLineIndex += lineCount;
    }
  }

  return {
    changes,
    addedLineNumbers,
    removedLineNumbers,
  };
}
