import * as vscode from "vscode";
import * as path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { Effect, Runtime, } from "effect";
import { normalizeEscapedChars } from "../../../utils/string-utils.js";
import { constructNewFileContent } from "../diff.js";
import { processModelContent } from "../../../utils/model-content-processor.js";
import { DiffViewProvider } from "../../diff-view-provider.js";
import { formatFileEditResponse, formatFileEditError } from "../response-formatter.js";
import type { DiffContentProvider } from "../../diff-content-provider.js";

export interface ReplaceInFileInput {
  targetPath: string;
  searchContent?: string; // Legacy: single search/replace
  replaceContent?: string; // Legacy: single search/replace
  diff?: string; // New: multi-block SEARCH/REPLACE format
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
 * Supports both legacy single search/replace and new multi-block SEARCH/REPLACE format
 * @param diffProvider Optional DiffContentProvider for visual diff view. If not provided, falls back to direct file editing.
 * @param onStreamingOutput Optional streaming callback
 * @param autoApprove Whether to auto-approve changes (default: false)
 */
export const createReplaceInFileTool = (
  diffProvider?: DiffContentProvider,
  onStreamingOutput?: StreamingFileOutputCallback,
  autoApprove: boolean = false,
) =>
  tool({
    description:
      "Replace specific content in an existing file using SEARCH/REPLACE blocks. Supports multiple edits in a single operation. More efficient than rewriting entire files for small changes. Preserves formatting and reduces errors.",
    inputSchema: z.object({
      targetPath: z
        .string()
        .describe(
          "The target file path. Can be relative to workspace root or absolute.",
        ),
      searchContent: z
        .string()
        .optional()
        .describe(
          "Legacy: The exact content to find and replace. Must match exactly (including whitespace). Use 'diff' parameter for multi-block edits.",
        ),
      replaceContent: z
        .string()
        .optional()
        .describe(
          "Legacy: The content to replace searchContent with. Use 'diff' parameter for multi-block edits.",
        ),
      diff: z
        .string()
        .optional()
        .describe(
          "Multi-block SEARCH/REPLACE format. Use this for multiple edits:\n------- SEARCH\n[content to find]\n=======\n[replacement content]\n+++++++ REPLACE\n\nMultiple blocks can be included for multiple changes.",
        ),
    }),
    execute: async ({
      targetPath,
      searchContent,
      replaceContent,
      diff,
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

      const relativePath = vscode.workspace.asRelativePath(fileUri, false);

      try {
        // Check if file exists
        let fileExists = false;
        try {
          await vscode.workspace.fs.stat(fileUri);
          fileExists = true;
        } catch {
          // File doesn't exist
          return {
            success: false,
            filePath: relativePath,
            message: `File does not exist: ${relativePath}. Use writeTestFile to create new files.`,
          };
        }

        if (!fileExists) {
          return {
            success: false,
            filePath: relativePath,
            message: `File does not exist: ${relativePath}`,
          };
        }

        // Read existing file content
        const document = await vscode.workspace.openTextDocument(fileUri);
        const originalContent = document.getText();

        // Determine which mode to use
        let newContent: string;
        let _diffString: string;

        if (diff) {
          // Multi-block SEARCH/REPLACE mode
          _diffString = diff;
          const result = constructNewFileContent(originalContent, diff);
          if (result.error) {
            return {
              success: false,
              filePath: relativePath,
              message: `${result.error}\n\nCurrent file content:\n${originalContent}`,
            };
          }
          newContent = result.content;
        } else if (searchContent && replaceContent) {
          // Legacy single search/replace mode
          const normalizedSearch = normalizeEscapedChars(searchContent);
          const normalizedReplace = normalizeEscapedChars(replaceContent);

          const searchIndex = originalContent.indexOf(normalizedSearch);
          if (searchIndex === -1) {
            return {
              success: false,
              filePath: relativePath,
              message: `Search content not found in file. Make sure the searchContent matches exactly (including whitespace and newlines).`,
            };
          }

          newContent =
            originalContent.slice(0, searchIndex) +
            normalizedReplace +
            originalContent.slice(searchIndex + normalizedSearch.length);

          // Convert to diff format for consistency
          _diffString = `------- SEARCH\n${normalizedSearch}\n=======\n${normalizedReplace}\n+++++++ REPLACE`;
        } else {
          return {
            success: false,
            filePath: relativePath,
            message:
              "Either 'diff' parameter or both 'searchContent' and 'replaceContent' must be provided.",
          };
        }

        // Process model-specific content fixes
        newContent = processModelContent(newContent, fileUri.fsPath);

        // Use diff view if provider is available, otherwise use direct editing
        if (diffProvider) {
          // Create diff view provider instance using Effect service
          const diffViewInstance = await Runtime.runPromise(
            Runtime.defaultRuntime,
          )(
            DiffViewProvider.pipe(
              Effect.flatMap((service) => service.create(diffProvider)),
              Effect.provide(DiffViewProvider.Default),
            ),
          );

          // Open diff view
          const openResult = await Runtime.runPromise(Runtime.defaultRuntime)(
            diffViewInstance.open(fileUri.fsPath).pipe(
              Effect.provide(DiffViewProvider.Default),
            ),
          );

          if (!openResult.success) {
            return {
              success: false,
              filePath: relativePath,
              message: `Failed to open diff view: ${openResult.error}`,
            };
          }

          // Update diff view with new content
          await Runtime.runPromise(Runtime.defaultRuntime)(
            diffViewInstance.update(newContent, true).pipe(
              Effect.provide(DiffViewProvider.Default),
            ),
          );

          // Handle approval flow
          if (!autoApprove) {
            // Show notification for user approval
            const approval = await vscode.window.showInformationMessage(
              `Review the changes to ${relativePath} in the diff view.`,
              "Approve",
              "Reject",
            );

            if (approval !== "Approve") {
              await Runtime.runPromise(Runtime.defaultRuntime)(
                diffViewInstance.revertChanges().pipe(
                  Effect.flatMap(() => diffViewInstance.reset()),
                  Effect.provide(DiffViewProvider.Default),
                ),
              );
              return {
                success: false,
                filePath: relativePath,
                message: `Changes to ${relativePath} were rejected by user.`,
              };
            }
          }

          // Save changes
          const saveResult = await Runtime.runPromise(Runtime.defaultRuntime)(
            diffViewInstance.saveChanges().pipe(
              Effect.provide(DiffViewProvider.Default),
            ),
          );

          // Format response
          const message = formatFileEditResponse(relativePath, saveResult);

          // Emit streaming callback
          if (onStreamingOutput) {
            const callbackPath = path.isAbsolute(targetPath)
              ? relativePath
              : targetPath;
            onStreamingOutput({
              filePath: callbackPath,
              content: saveResult.finalContent,
              isComplete: true,
            });
          }

          // Clean up
          await Runtime.runPromise(Runtime.defaultRuntime)(
            diffViewInstance.reset().pipe(
              Effect.provide(DiffViewProvider.Default),
            ),
          );

          return {
            success: true,
            filePath: relativePath,
            message,
          };
        } else {
          // Fallback: Direct file editing (legacy behavior)
          const content = Buffer.from(newContent, "utf-8");
          await vscode.workspace.fs.writeFile(fileUri, content);

          // Emit streaming callback
          if (onStreamingOutput) {
            const callbackPath = path.isAbsolute(targetPath)
              ? relativePath
              : targetPath;
            onStreamingOutput({
              filePath: callbackPath,
              content: newContent,
              isComplete: true,
            });
          }

          return {
            success: true,
            filePath: relativePath,
            message: `Content replaced in ${relativePath}`,
          };
        }

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
 * Legacy replaceInFileTool for backward compatibility
 * Uses direct file editing without diff view
 */
export const replaceInFileTool = createReplaceInFileTool(undefined, undefined, false);
