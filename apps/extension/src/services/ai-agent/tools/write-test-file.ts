import * as vscode from "vscode";
import * as path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import type { WriteTestFileInput, WriteTestFileOutput } from "../types.js";
import { normalizeEscapedChars } from "../../../utils/string-utils.js";

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
 * Factory function to create writeTestFileTool with approval registry
 * The tool requires a valid proposalId from an approved proposeTest call
 * Supports streaming file content as it's written
 */
export const createWriteTestFileTool = (
  approvalRegistry: Set<string>,
  onStreamingOutput?: StreamingFileOutputCallback,
) =>
  tool({
    description:
      "Write or update a test file. Creates directories if needed. Can overwrite existing files. Use any unique string as proposalId - it will be auto-approved.",
    inputSchema: z.object({
      proposalId: z
        .string()
        .describe(
          "A unique identifier for this test write operation. Can be any unique string (e.g., 'test-1', 'featurebase-test', etc.).",
        ),
      testContent: z
        .string()
        .describe("The complete Cypress test file content to write"),
      targetPath: z
        .string()
        .describe(
          "The target file path. Can be relative to workspace root or absolute.",
        ),
      overwrite: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether to overwrite existing file (default: false)"),
    }),
    execute: async ({
      proposalId,
      testContent,
      targetPath,
      overwrite = false,
    }: WriteTestFileInput): Promise<WriteTestFileOutput> => {
      // Check if proposalId is approved
      if (!approvalRegistry.has(proposalId)) {
        return {
          success: false,
          filePath: targetPath,
          message:
            "Invalid or unapproved proposalId. Call proposeTest first and get approval.",
        };
      }
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
          // File doesn't exist, that's okay
        }

        if (fileExists && !overwrite) {
          const relativePath = vscode.workspace.asRelativePath(fileUri, false);
          return {
            success: false,
            filePath: relativePath,
            message: `File already exists. Set overwrite=true to replace it.`,
          };
        }

        // Ensure parent directory exists
        const parentDir = vscode.Uri.joinPath(fileUri, "..");
        try {
          await vscode.workspace.fs.stat(parentDir);
        } catch {
          // Directory doesn't exist, create it
          await vscode.workspace.fs.createDirectory(parentDir);
        }

        // Normalize escaped characters - convert literal escape sequences to actual characters
        const normalizedContent = normalizeEscapedChars(testContent);

        // Use targetPath for consistency with tool args (for streaming callback lookup)
        // Convert to relative path for return value
        const relativePath = vscode.workspace.asRelativePath(fileUri, false);
        const callbackPath = path.isAbsolute(targetPath)
          ? relativePath
          : targetPath; // Use original targetPath if relative, otherwise use computed relativePath

        // Create empty file and open it immediately for streaming
        let document: vscode.TextDocument;
        try {
          // Create empty file first
          await vscode.workspace.fs.writeFile(fileUri, Buffer.from("", "utf-8"));
          
          // Open the file in the editor immediately
          document = await vscode.workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(document, {
            preview: false, // Keep the tab open (not preview mode)
            preserveFocus: false, // Focus the new editor tab
          });

          // Emit file-created event
          if (onStreamingOutput) {
            onStreamingOutput({
              filePath: callbackPath,
              content: "",
              isComplete: false,
            });
          }
        } catch (_error) {
          // If opening fails, fall back to regular write
          const content = Buffer.from(normalizedContent, "utf-8");
          await vscode.workspace.fs.writeFile(fileUri, content);
          
          return {
            success: true,
            filePath: relativePath,
            message: fileExists
              ? `Test file updated: ${relativePath}`
              : `Test file created: ${relativePath}`,
          };
        }

        // Stream content incrementally using TextEditor API
        // Chunk size: approximately 200 characters per chunk for smooth streaming
        const chunkSize = 200;
        let accumulatedContent = "";
        
        // Get the active text editor for this document
        const editor = vscode.window.visibleTextEditors.find(
          (e) => e.document.uri.toString() === fileUri.toString(),
        );
        
        if (editor) {
          // Use TextEditor for incremental writes
          for (let i = 0; i < normalizedContent.length; i += chunkSize) {
            const chunk = normalizedContent.slice(i, i + chunkSize);
            accumulatedContent += chunk;
            
            // Append chunk to document
            const edit = new vscode.WorkspaceEdit();
            const currentLength = accumulatedContent.length - chunk.length;
            const endPosition = document.positionAt(currentLength);
            edit.insert(fileUri, endPosition, chunk);
            await vscode.workspace.applyEdit(edit);
            
            // Reload document to get updated content
            document = await vscode.workspace.openTextDocument(fileUri);
            
          // Emit streaming chunk
          if (onStreamingOutput) {
            onStreamingOutput({
              filePath: callbackPath,
              content: accumulatedContent,
              isComplete: i + chunkSize >= normalizedContent.length,
            });
          }
            
            // Small delay to make streaming visible
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        } else {
          // Fallback: write entire file at once if editor not available
          const content = Buffer.from(normalizedContent, "utf-8");
          await vscode.workspace.fs.writeFile(fileUri, content);
          
          if (onStreamingOutput) {
            onStreamingOutput({
              filePath: relativePath,
              content: normalizedContent,
              isComplete: true,
            });
          }
        }

        return {
          success: true,
          filePath: relativePath,
          message: fileExists
            ? `Test file updated: ${relativePath}`
            : `Test file created: ${relativePath}`,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        const relativePath = vscode.workspace.asRelativePath(fileUri, false);
        return {
          success: false,
          filePath: relativePath,
          message: `Failed to write test file: ${errorMessage}`,
        };
      }
    },
  });

/**
 * Streaming helper for writing partial content to files as it arrives
 * Used by the agent to stream content as AI generates it
 */
export interface StreamingWriteState {
  fileUri: vscode.Uri;
  document?: vscode.TextDocument;
  editor?: vscode.TextEditor;
  accumulatedContent: string;
  isInitialized: boolean;
}

const streamingStates = new Map<string, StreamingWriteState>();

/**
 * Initialize streaming write for a file
 */
export async function initializeStreamingWrite(
  targetPath: string,
  toolCallId: string,
): Promise<{ success: boolean; error?: string }> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return { success: false, error: "No workspace folder found" };
  }

  const workspaceRoot = workspaceFolders[0].uri;

  // Resolve path
  let fileUri: vscode.Uri;
  if (path.isAbsolute(targetPath)) {
    fileUri = vscode.Uri.file(targetPath);
  } else {
    fileUri = vscode.Uri.joinPath(workspaceRoot, targetPath);
  }

  try {
    // Ensure parent directory exists
    const parentDir = vscode.Uri.joinPath(fileUri, "..");
    try {
      await vscode.workspace.fs.stat(parentDir);
    } catch {
      await vscode.workspace.fs.createDirectory(parentDir);
    }

    // Create empty file
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from("", "utf-8"));

    // Open file in editor
    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });

    streamingStates.set(toolCallId, {
      fileUri,
      document,
      editor,
      accumulatedContent: "",
      isInitialized: true,
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Append content chunk to streaming write
 */
export async function appendStreamingContent(
  toolCallId: string,
  contentChunk: string,
): Promise<{ success: boolean; error?: string }> {
  const state = streamingStates.get(toolCallId);
  if (!state || !state.isInitialized) {
    return { success: false, error: "Streaming write not initialized" };
  }

  try {
    state.accumulatedContent += contentChunk;

    if (state.editor && state.document) {
      const edit = new vscode.WorkspaceEdit();
      const endPosition = state.document.positionAt(
        state.accumulatedContent.length - contentChunk.length,
      );
      edit.insert(state.fileUri, endPosition, contentChunk);
      await vscode.workspace.applyEdit(edit);

      // Reload document
      state.document = await vscode.workspace.openTextDocument(state.fileUri);
    } else {
      // Fallback: write accumulated content
      const buffer = Buffer.from(state.accumulatedContent, "utf-8");
      await vscode.workspace.fs.writeFile(state.fileUri, buffer);
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Finalize streaming write and clean up state
 */
export async function finalizeStreamingWrite(
  toolCallId: string,
): Promise<{ success: boolean; filePath: string; error?: string }> {
  const state = streamingStates.get(toolCallId);
  if (!state) {
    return { success: false, filePath: "", error: "Streaming write not found" };
  }

  try {
    // Ensure final content is written
    const buffer = Buffer.from(state.accumulatedContent, "utf-8");
    await vscode.workspace.fs.writeFile(state.fileUri, buffer);

    const relativePath = vscode.workspace.asRelativePath(state.fileUri, false);

    // Clean up
    streamingStates.delete(toolCallId);

    return { success: true, filePath: relativePath };
  } catch (error) {
    streamingStates.delete(toolCallId);
    return {
      success: false,
      filePath: vscode.workspace.asRelativePath(state.fileUri, false),
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Default writeTestFileTool without approval registry (for backward compatibility)
 * Use createWriteTestFileTool with approvalRegistry for HITL
 */
export const writeTestFileTool = createWriteTestFileTool(
  new Set<string>(),
  undefined,
);
