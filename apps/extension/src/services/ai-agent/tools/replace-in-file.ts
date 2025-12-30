import * as vscode from "vscode";
import * as path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { constructNewFileContent } from "../diff.js";
import { processModelContent } from "../../../utils/model-content-processor.js";
import { formatFileEditError } from "../response-formatter.js";
import { registerBlockSync } from "../../pending-edit-service.js";
import { applyDiffDecorationsSync } from "../../diff-decoration-service.js";

export interface ReplaceInFileInput {
  targetPath: string;
  diff: string;
}

export interface ReplaceInFileOutput {
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
 * Factory function to create replaceInFileTool
 * Writes changes directly to file (non-blocking) and registers with PendingEditService
 * User can accept/reject via CodeLens in the editor
 *
 * @param onStreamingOutput Optional streaming callback
 */
export const createReplaceInFileTool = (
  onStreamingOutput?: StreamingFileOutputCallback,
) =>
  tool({
    description:
      "Replace specific content in an existing file using SEARCH/REPLACE blocks. Supports multiple edits in a single operation. Changes are written immediately and user can accept/reject via CodeLens in the editor.",
    inputSchema: z.object({
      targetPath: z
        .string()
        .describe(
          "The target file path. Can be relative to workspace root or absolute.",
        ),
      diff: z
        .string()
        .describe(
          "Multi-block SEARCH/REPLACE format for file edits:\n------- SEARCH\n[content to find]\n=======\n[replacement content]\n+++++++ REPLACE\n\nMultiple blocks can be included for multiple changes.",
        ),
    }),
    execute: async (
      { targetPath, diff }: ReplaceInFileInput,
      _options?: { toolCallId?: string },
    ): Promise<ReplaceInFileOutput> => {
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

        // Apply multi-block SEARCH/REPLACE diff
        const result = constructNewFileContent(originalContent, diff);
        if (result.error) {
          return {
            success: false,
            filePath: relativePath,
            message: `${result.error}\n\nCurrent file content:\n${originalContent}`,
          };
        }

        // Process model-specific content fixes
        const newContent = processModelContent(result.content, fileUri.fsPath);

        // Generate unique block ID for this replace operation
        const blockId = `replace-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

        // For replace operations, the entire file is treated as one block
        const originalLines = originalContent.split("\n");
        const newLines = newContent.split("\n");

        // Register block BEFORE writing (store original for revert)
        registerBlockSync(
          fileUri.fsPath,
          blockId,
          1, // Start from first line
          newLines.length, // End at last line
          originalLines,
          newLines.length,
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

        return {
          success: true,
          filePath: relativePath,
          message: `Content replaced in ${relativePath}. Changes are pending user review. User can accept or reject via CodeLens in the editor.`,
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
 * Default replaceInFileTool instance
 */
export const replaceInFileTool = createReplaceInFileTool(undefined);
