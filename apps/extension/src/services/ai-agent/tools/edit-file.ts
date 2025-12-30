import * as vscode from "vscode";
import * as path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { processModelContent } from "../../../utils/model-content-processor.js";
import { formatFileEditError } from "../response-formatter.js";
import { registerBlockSync } from "../../pending-edit-service.js";
import { applyDiffDecorationsSync } from "../../diff-decoration-service.js";

export interface EditFileInput {
  targetPath: string;
  edits: Array<{
    startLine: number;
    endLine: number;
    content: string;
  }>;
}

export interface EditFileOutput {
  success: boolean;
  filePath: string;
  message: string;
}

/**
 * Streaming file output callback type
 * Receives file path and content chunks as they're written
 */
export type StreamingFileOutputCallback = (chunk: {
  filePath: string;
  content: string;
  isComplete: boolean;
}) => void;

/**
 * Check if a line is at a potential function boundary
 * Returns true for lines that are opening/closing braces
 */
function isAtFunctionBoundary(lines: string[], lineNum: number): boolean {
  if (lineNum < 1 || lineNum > lines.length) {
    return false;
  }
  const line = lines[lineNum - 1]?.trim() || "";
  return (
    line === "}" || line === "{" || line.endsWith("{") || line.endsWith("}")
  );
}

/**
 * Detect if edits might benefit from additional context
 * Returns warnings if edits are at boundaries without buffer
 */
function detectBoundaryIssues(
  originalContent: string,
  edits: Array<{ startLine: number; endLine: number; content: string }>,
): string[] {
  const lines = originalContent.split("\n");
  const warnings: string[] = [];

  for (const edit of edits) {
    // Skip insertion edits (startLine > endLine)
    if (edit.startLine > edit.endLine) {
      continue;
    }

    const startsAtBoundary = isAtFunctionBoundary(lines, edit.startLine);
    const endsAtBoundary = isAtFunctionBoundary(lines, edit.endLine);
    const hasBufferBefore = edit.startLine > 1;
    const hasBufferAfter = edit.endLine < lines.length;

    // Check if edit starts at a boundary without including the line before
    if (startsAtBoundary && hasBufferBefore && edit.startLine > 1) {
      const prevLine = lines[edit.startLine - 2]?.trim() || "";
      if (prevLine && !prevLine.startsWith("//")) {
        warnings.push(
          `Edit starts at line ${edit.startLine} (boundary: '${lines[edit.startLine - 1]?.trim()}') - consider including line ${edit.startLine - 1} for context.`,
        );
      }
    }

    // Check if edit ends at a boundary without including the line after
    if (endsAtBoundary && hasBufferAfter && edit.endLine < lines.length) {
      const nextLine = lines[edit.endLine]?.trim() || "";
      if (nextLine && !nextLine.startsWith("//")) {
        warnings.push(
          `Edit ends at line ${edit.endLine} (boundary: '${lines[edit.endLine - 1]?.trim()}') - consider including line ${edit.endLine + 1} for context.`,
        );
      }
    }
  }

  return warnings;
}

/**
 * Apply line-based edits to file content
 * Edits are sorted by startLine descending (bottom to top) to preserve line numbers
 */
function applyLineEdits(
  originalContent: string,
  edits: Array<{ startLine: number; endLine: number; content: string }>,
): string {
  // Sort edits by startLine descending (apply from bottom to top)
  const sortedEdits = [...edits].sort((a, b) => b.startLine - a.startLine);

  const lines = originalContent.split("\n");

  for (const edit of sortedEdits) {
    // Validate line numbers
    if (edit.startLine < 1 || edit.endLine < 1) {
      throw new Error(
        `Line numbers must be 1-based (got startLine: ${edit.startLine}, endLine: ${edit.endLine})`,
      );
    }
    if (edit.startLine > lines.length + 1) {
      throw new Error(
        `startLine ${edit.startLine} exceeds file length (${lines.length} lines)`,
      );
    }
    if (edit.endLine > lines.length) {
      throw new Error(
        `endLine ${edit.endLine} exceeds file length (${lines.length} lines)`,
      );
    }

    // Handle insertion case (startLine > endLine means insert before startLine)
    if (edit.startLine > edit.endLine) {
      // Insert before startLine
      const newLines = edit.content ? edit.content.split("\n") : [];
      lines.splice(edit.endLine, 0, ...newLines);
    } else {
      // Normal replacement case
      const newLines = edit.content ? edit.content.split("\n") : [];
      const deleteCount = edit.endLine - edit.startLine + 1;
      lines.splice(edit.startLine - 1, deleteCount, ...newLines);
    }
  }

  return lines.join("\n");
}

/**
 * Factory function to create editFileTool
 * Edits specific lines in a file using line numbers
 * Changes are written directly and registered with PendingEditService
 * User can accept/reject via CodeLens in the editor
 *
 * @param onStreamingOutput Optional streaming callback
 */
export const createEditFileTool = (
  onStreamingOutput?: StreamingFileOutputCallback,
) =>
  tool({
    description:
      "Edit specific lines in an existing file using line numbers (1-based). Provide line ranges and replacement content. Multiple edits can be batched. Changes are written immediately and user can accept/reject via CodeLens in the editor.",
    inputSchema: z.object({
      targetPath: z
        .string()
        .describe(
          "The target file path. Can be relative to workspace root or absolute.",
        ),
      edits: z
        .array(
          z.object({
            startLine: z
              .number()
              .int()
              .positive()
              .describe(
                "Starting line number (1-based, inclusive). For insertion, use startLine > endLine (e.g., startLine: 11, endLine: 10 inserts after line 10).",
              ),
            endLine: z
              .number()
              .int()
              .positive()
              .describe(
                "Ending line number (1-based, inclusive). Must be >= startLine for replacement, or < startLine for insertion.",
              ),
            content: z
              .string()
              .describe(
                "New content to replace the lines with. Use empty string to delete lines. For multi-line content, include newlines in the string.",
              ),
          }),
        )
        .describe(
          "Array of edits to apply. Edits are automatically sorted and applied from bottom to top to preserve line numbers.",
        ),
    }),
    execute: async (
      { targetPath, edits }: EditFileInput,
      _options?: { toolCallId?: string },
    ): Promise<EditFileOutput> => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error("No workspace folder found");
      }

      const workspaceRoot = workspaceFolders[0].uri;

      // Resolve path relative to workspace root if not absolute
      let fileUri: vscode.Uri;
      if (path.isAbsolute(targetPath)) {
        fileUri = vscode.Uri.file(targetPath);
      } else {
        fileUri = vscode.Uri.joinPath(workspaceRoot, targetPath);
      }

      const relativePath = vscode.workspace.asRelativePath(fileUri, false);

      try {
        // Check if file exists
        try {
          await vscode.workspace.fs.stat(fileUri);
        } catch {
          return {
            success: false,
            filePath: relativePath,
            message: `File does not exist: ${relativePath}. Use writeTestFile to create new files.`,
          };
        }

        // Read existing file content
        const document = await vscode.workspace.openTextDocument(fileUri);
        const originalContent = document.getText();

        // Detect potential boundary issues before applying edits
        const _boundaryWarnings = detectBoundaryIssues(originalContent, edits);

        // Apply line-based edits
        let newContent: string;
        try {
          newContent = applyLineEdits(originalContent, edits);
        } catch (error) {
          return {
            success: false,
            filePath: relativePath,
            message: `Failed to apply edits: ${error instanceof Error ? error.message : "Unknown error"}\n\nCurrent file has ${originalContent.split("\n").length} lines.`,
          };
        }

        // Process model-specific content fixes
        newContent = processModelContent(newContent, fileUri.fsPath);

        // Generate unique block ID for this edit
        const blockId = `edit-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

        // Calculate the line range for the combined edits
        const sortedEdits = [...edits].sort(
          (a, b) => a.startLine - b.startLine,
        );
        const firstEdit = sortedEdits[0];
        const lastEdit = sortedEdits[sortedEdits.length - 1];
        const startLine = firstEdit.startLine;
        const endLine = lastEdit.endLine;

        // Get original lines that will be replaced
        const originalLines = originalContent.split("\n");
        const originalLinesForBlock = originalLines.slice(
          startLine - 1,
          endLine,
        );

        // Calculate new line count
        const newLines = newContent.split("\n");
        const newLineCount =
          newLines.length - originalLines.length + (endLine - startLine + 1);

        // Register block BEFORE writing (store original for revert)
        registerBlockSync(
          fileUri.fsPath,
          blockId,
          startLine,
          startLine + newLineCount - 1, // Adjusted end line after edit
          originalLinesForBlock,
          newLineCount,
          originalContent, // base content
          false, // not a new file
        );

        // Write the file directly
        const content = Buffer.from(newContent, "utf-8");
        await vscode.workspace.fs.writeFile(fileUri, content);

        // Open the file in the editor to show changes
        const updatedDocument =
          await vscode.workspace.openTextDocument(fileUri);
        const editor = await vscode.window.showTextDocument(updatedDocument, {
          preview: false,
          preserveFocus: false,
        });

        // Get the actual content after opening (may be auto-formatted)
        const actualContent = updatedDocument.getText();

        // Apply diff decorations to show changes
        try {
          applyDiffDecorationsSync(
            editor,
            originalContent,
            actualContent,
            false, // not a new file
          );
        } catch (error) {
          // Log error but don't fail the operation
          console.error("Failed to apply diff decorations:", error);
        }

        // Emit streaming callback
        if (onStreamingOutput) {
          const callbackPath = path.isAbsolute(targetPath)
            ? relativePath
            : targetPath;
          onStreamingOutput({
            filePath: callbackPath,
            content: actualContent,
            isComplete: true,
          });
        }

        const editSummary =
          edits.length === 1
            ? `lines ${edits[0].startLine}-${edits[0].endLine}`
            : `${edits.length} line ranges`;

        let message = `Edited ${editSummary} in ${relativePath}. Changes are pending user review. User can accept or reject via CodeLens in the editor.`;

        // Append boundary warnings if any
        if (_boundaryWarnings.length > 0) {
          message += `\n\n⚠️ Context Warnings:\n${_boundaryWarnings.map((w) => `- ${w}`).join("\n")}`;
        }

        return {
          success: true,
          filePath: relativePath,
          message,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        // Try to read original content for error message
        let originalContent: string | undefined;
        try {
          const doc = await vscode.workspace.openTextDocument(fileUri);
          originalContent = doc.getText();
        } catch {
          // Ignore errors reading file
        }

        const errorResponse = formatFileEditError(
          relativePath,
          errorMessage,
          originalContent,
        );

        return {
          success: false,
          filePath: relativePath,
          message: errorResponse,
        };
      }
    },
  });

/**
 * Default editFileTool instance
 */
export const editFileTool = createEditFileTool(undefined);
