/**
 * DiffDetector
 * Detects file modifications and generates structured diffs for display.
 * Uses the `diff` npm package (LCS-based) for proper diff computation.
 * Monitors Edit/Write tool operations and compares file states.
 */

import { structuredPatch } from "diff";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DiffHunk, DiffLine, FileDiffData } from "../types";

/** Max combined size (old + new) before we skip detailed diffing */
const MAX_DIFF_BYTES = 50_000;
/** Max lines to preview for newly created files */
const CREATE_PREVIEW_LINES = 30;

export class DiffDetector {
  // Store file snapshots before modifications
  private fileSnapshots = new Map<string, string>();

  /**
   * Called when a tool_use event occurs for Edit or Write.
   * Captures file state before modification.
   */
  handleToolUse(toolName: string, input: any): void {
    if (toolName !== "Edit" && toolName !== "Write") {
      return;
    }

    const filePath = input.file_path;
    if (!filePath) {
      return;
    }

    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        this.fileSnapshots.set(filePath, content);
      } catch (_error) {
        this.fileSnapshots.set(filePath, "");
      }
    } else {
      // New file will be created
      this.fileSnapshots.set(filePath, "");
    }
  }

  /**
   * Generate structured diff data for a file after modification.
   * Returns FileDiffData or null if not a file operation.
   */
  generateDiff(toolName: string, input: any): FileDiffData | null {
    if (toolName !== "Edit" && toolName !== "Write") {
      return null;
    }

    const filePath = input.file_path;
    if (!filePath) {
      return null;
    }

    const oldContent = this.fileSnapshots.get(filePath) || "";

    let newContent = "";
    if (fs.existsSync(filePath)) {
      try {
        newContent = fs.readFileSync(filePath, "utf-8");
      } catch (_error) {
        return null;
      }
    }

    this.fileSnapshots.delete(filePath);

    // No change
    if (oldContent === newContent) {
      return null;
    }

    const fileName = path.basename(filePath);
    const isCreate = !oldContent && newContent.length > 0;

    // --- Create: preview first N lines ---
    if (isCreate) {
      const allLines = newContent.split("\n");
      // Remove trailing empty line from split if file ends with newline
      if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
        allLines.pop();
      }
      const preview = allLines.slice(0, CREATE_PREVIEW_LINES);
      const truncated = allLines.length > CREATE_PREVIEW_LINES;

      return {
        filePath,
        fileName,
        operation: "create",
        hunks: [],
        stats: { additions: allLines.length, deletions: 0, totalLines: allLines.length },
        newFilePreview: preview,
        previewTruncated: truncated,
      };
    }

    // --- Large file safety ---
    if (oldContent.length + newContent.length > MAX_DIFF_BYTES) {
      const oldLineCount = oldContent.split("\n").length;
      const newLineCount = newContent.split("\n").length;
      const added = Math.max(0, newLineCount - oldLineCount);
      const removed = Math.max(0, oldLineCount - newLineCount);
      return {
        filePath,
        fileName,
        operation: "edit",
        hunks: [],
        stats: { additions: added, deletions: removed },
      };
    }

    // --- Edit: LCS-based structured diff ---
    const patch = structuredPatch(
      fileName,
      fileName,
      oldContent,
      newContent,
      "",
      "",
      { context: 3 },
    );

    let totalAdditions = 0;
    let totalDeletions = 0;

    const hunks: DiffHunk[] = patch.hunks.map((hunk) => {
      const lines: DiffLine[] = [];
      let oldLine = hunk.oldStart;
      let newLine = hunk.newStart;

      for (const raw of hunk.lines) {
        const prefix = raw[0];
        const content = raw.slice(1);

        if (prefix === "+") {
          lines.push({
            type: "add",
            content,
            newLineNumber: newLine,
          });
          newLine++;
          totalAdditions++;
        } else if (prefix === "-") {
          lines.push({
            type: "remove",
            content,
            oldLineNumber: oldLine,
          });
          oldLine++;
          totalDeletions++;
        } else {
          // context line (space prefix) or no-newline marker
          if (prefix === "\\") {
            // "\ No newline at end of file" — skip
            continue;
          }
          lines.push({
            type: "context",
            content,
            oldLineNumber: oldLine,
            newLineNumber: newLine,
          });
          oldLine++;
          newLine++;
        }
      }

      return {
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines,
      };
    });

    return {
      filePath,
      fileName,
      operation: "edit",
      hunks,
      stats: { additions: totalAdditions, deletions: totalDeletions },
    };
  }

  /**
   * Clear all snapshots (useful when starting new session)
   */
  clear(): void {
    this.fileSnapshots.clear();
  }
}
