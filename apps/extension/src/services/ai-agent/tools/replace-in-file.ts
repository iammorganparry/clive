import * as vscode from "vscode";
import * as path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { normalizeEscapedChars } from "../../../utils/string-utils.js";

export interface ReplaceInFileInput {
  targetPath: string;
  searchContent: string;
  replaceContent: string;
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
 * Allows targeted search/replace operations in files (like Cline's replace_in_file)
 */
export const createReplaceInFileTool = (
  onStreamingOutput?: StreamingFileOutputCallback,
) =>
  tool({
    description:
      "Replace specific content in an existing file. Finds exact match of searchContent and replaces it with replaceContent. More efficient than rewriting entire files for small changes. Preserves formatting and reduces errors.",
    inputSchema: z.object({
      targetPath: z
        .string()
        .describe(
          "The target file path. Can be relative to workspace root or absolute.",
        ),
      searchContent: z
        .string()
        .describe(
          "The exact content to find and replace. Must match exactly (including whitespace).",
        ),
      replaceContent: z
        .string()
        .describe("The content to replace searchContent with."),
    }),
    execute: async ({
      targetPath,
      searchContent,
      replaceContent,
    }: ReplaceInFileInput): Promise<ReplaceInFileOutput> => {
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

      try {
        // Check if file exists
        let fileExists = false;
        try {
          await vscode.workspace.fs.stat(fileUri);
          fileExists = true;
        } catch {
          // File doesn't exist
          const relativePath = vscode.workspace.asRelativePath(fileUri, false);
          return {
            success: false,
            filePath: relativePath,
            message: `File does not exist: ${relativePath}. Use writeTestFile to create new files.`,
          };
        }

        if (!fileExists) {
          const relativePath = vscode.workspace.asRelativePath(fileUri, false);
          return {
            success: false,
            filePath: relativePath,
            message: `File does not exist: ${relativePath}`,
          };
        }

        // Read existing file content
        const document = await vscode.workspace.openTextDocument(fileUri);
        const existingContent = document.getText();

        // Normalize escaped characters
        const normalizedSearch = normalizeEscapedChars(searchContent);
        const normalizedReplace = normalizeEscapedChars(replaceContent);

        // Find the search content in the file
        const searchIndex = existingContent.indexOf(normalizedSearch);
        if (searchIndex === -1) {
          const relativePath = vscode.workspace.asRelativePath(fileUri, false);
          return {
            success: false,
            filePath: relativePath,
            message: `Search content not found in file. Make sure the searchContent matches exactly (including whitespace and newlines).`,
          };
        }

        // Perform replacement
        const newContent =
          existingContent.slice(0, searchIndex) +
          normalizedReplace +
          existingContent.slice(searchIndex + normalizedSearch.length);

        // Calculate positions for streaming
        const relativePath = vscode.workspace.asRelativePath(fileUri, false);
        const callbackPath = path.isAbsolute(targetPath)
          ? relativePath
          : targetPath;

        // Open file in editor for streaming
        let editor: vscode.TextEditor | undefined;
        try {
          editor = await vscode.window.showTextDocument(document, {
            preview: false,
            preserveFocus: false,
          });
        } catch {
          // If opening fails, continue with file write
        }

        // Stream the replacement if editor is available
        if (editor) {
          const startPosition = document.positionAt(searchIndex);
          const endPosition = document.positionAt(
            searchIndex + normalizedSearch.length,
          );

          const edit = new vscode.WorkspaceEdit();
          edit.replace(fileUri, new vscode.Range(startPosition, endPosition), normalizedReplace);
          await vscode.workspace.applyEdit(edit);

          // Reload document to get updated content
          const updatedDocument = await vscode.workspace.openTextDocument(fileUri);
          const updatedContent = updatedDocument.getText();

          // Emit streaming callback
          if (onStreamingOutput) {
            onStreamingOutput({
              filePath: callbackPath,
              content: updatedContent,
              isComplete: true,
            });
          }
        } else {
          // Fallback: write entire file
          const content = Buffer.from(newContent, "utf-8");
          await vscode.workspace.fs.writeFile(fileUri, content);

          if (onStreamingOutput) {
            onStreamingOutput({
              filePath: callbackPath,
              content: newContent,
              isComplete: true,
            });
          }
        }

        return {
          success: true,
          filePath: relativePath,
          message: `Content replaced in ${relativePath}`,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        const relativePath = vscode.workspace.asRelativePath(fileUri, false);
        return {
          success: false,
          filePath: relativePath,
          message: `Failed to replace content: ${errorMessage}`,
        };
      }
    },
  });

/**
 * Default replaceInFileTool without streaming callback
 */
export const replaceInFileTool = createReplaceInFileTool(undefined);

