import * as vscode from "vscode";
import * as path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { Runtime } from "effect";
import type { WriteTestFileInput, WriteTestFileOutput } from "../types.js";
import { normalizeEscapedChars } from "../../../utils/string-utils.js";
import {
  getDiagnostics,
  getNewProblems,
  formatDiagnosticsMessage,
} from "../../diagnostics-service.js";
import {
  formatFileEditWithoutUserChanges,
  formatFileEditError,
} from "../response-formatter.js";
import { registerBlockSync } from "../../../services/pending-edit-service.js";
import { applyDiffDecorationsSync } from "../../../services/diff-decoration-service.js";

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
 * Factory function to create writeTestFileTool
 * Writes files directly (non-blocking) and registers with PendingEditService
 * User can accept/reject via CodeLens in the editor
 *
 * @param approvalRegistry Set of approved proposal IDs (auto-approved)
 * @param onStreamingOutput Optional callback for streaming file output
 */
export const createWriteTestFileTool = (
  approvalRegistry: Set<string>,
  onStreamingOutput?: StreamingFileOutputCallback,
) =>
  tool({
    description:
      "Write or update a test file. Creates directories if needed. Can overwrite existing files. Use any unique string as proposalId - it will be auto-approved. Changes are written immediately and user can accept/reject via CodeLens in the editor.",
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
    execute: async (
      {
        proposalId,
        testContent,
        targetPath,
        overwrite = false,
      }: WriteTestFileInput,
      _options?: { toolCallId?: string },
    ): Promise<WriteTestFileOutput> => {
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

      const relativePath = vscode.workspace.asRelativePath(fileUri, false);

      try {
        // Check if file exists and get original content
        let fileExists = false;
        let originalContent = "";
        try {
          const existingDoc = await vscode.workspace.openTextDocument(fileUri);
          originalContent = existingDoc.getText();
          fileExists = true;
        } catch {
          // File doesn't exist, that's okay
        }

        if (fileExists && !overwrite) {
          return {
            success: false,
            filePath: relativePath,
            message: `File already exists at ${relativePath}. To modify existing tests, read the file first and then use writeTestFile with overwrite=true to include your changes. Existing file content:\n\n<existing_file_content>\n${originalContent}\n</existing_file_content>\n\nSet overwrite=true to update this file with your changes.`,
          };
        }

        // Normalize escaped characters
        const normalizedContent = normalizeEscapedChars(testContent);

        // Use targetPath for consistency with tool args (for streaming callback lookup)
        const callbackPath = path.isAbsolute(targetPath)
          ? relativePath
          : targetPath;

        // Generate unique block ID for this write operation
        const blockId = `write-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

        // For write operations, the entire file is one block
        const originalLines = fileExists ? originalContent.split("\n") : [];
        const newLines = normalizedContent.split("\n");

        // Register block BEFORE writing (store original for revert)
        registerBlockSync(
          fileUri.fsPath,
          blockId,
          1, // Start from first line
          newLines.length, // End at last line
          originalLines,
          newLines.length,
          originalContent, // base content
          !fileExists, // isNewFile
        );

        // Capture pre-edit diagnostics
        const preEditDiagnostics = await Runtime.runPromise(
          Runtime.defaultRuntime,
        )(getDiagnostics(fileUri));

        // Ensure parent directory exists
        const parentDir = vscode.Uri.joinPath(fileUri, "..");
        try {
          await vscode.workspace.fs.stat(parentDir);
        } catch {
          // Directory doesn't exist, create it
          await vscode.workspace.fs.createDirectory(parentDir);
        }

        // Write the file directly
        const content = Buffer.from(normalizedContent, "utf-8");
        await vscode.workspace.fs.writeFile(fileUri, content);

        // Open the file in the editor
        const document = await vscode.workspace.openTextDocument(fileUri);
        const editor = await vscode.window.showTextDocument(document, {
          preview: false,
          preserveFocus: false,
        });

        // Get the actual content after opening (may be auto-formatted)
        const actualContent = document.getText();

        // Apply diff decorations to show what's new
        // For new files, all content is highlighted green
        // For existing files (overwrite), show changes
        try {
          applyDiffDecorationsSync(
            editor,
            originalContent,
            actualContent,
            !fileExists, // isNewFile
          );
        } catch (error) {
          // Log error but don't fail the operation
          console.error("Failed to apply diff decorations:", error);
        }

        // Emit streaming callback with final content
        if (onStreamingOutput) {
          onStreamingOutput({
            filePath: callbackPath,
            content: actualContent,
            isComplete: true,
          });
        }

        // Get post-edit diagnostics
        const postEditDiagnostics = await Runtime.runPromise(
          Runtime.defaultRuntime,
        )(getDiagnostics(fileUri));

        const newProblems = getNewProblems(
          preEditDiagnostics,
          postEditDiagnostics,
        );

        const newProblemsMessage =
          newProblems.length > 0
            ? formatDiagnosticsMessage(newProblems)
            : undefined;

        // Detect auto-formatting changes
        const autoFormattingEdits =
          actualContent !== normalizedContent
            ? `Auto-formatting was applied to ${relativePath}`
            : undefined;

        // Format response for AI
        const message = formatFileEditWithoutUserChanges(
          relativePath,
          actualContent, // Use actual content, not normalized content
          autoFormattingEdits,
          newProblemsMessage,
        );

        return {
          success: true,
          filePath: relativePath,
          message: `${message}\n\nNote: Changes are pending user review. User can accept or reject via CodeLens in the editor.`,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        // Try to read current file content for error context
        let currentContent: string | undefined;
        try {
          const doc = await vscode.workspace.openTextDocument(fileUri);
          currentContent = doc.getText();
        } catch {
          // Ignore errors reading file
        }

        const errorResponse = formatFileEditError(
          relativePath,
          errorMessage,
          currentContent,
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
    // Replace accumulated content (we receive full content, not a delta)
    state.accumulatedContent = contentChunk;

    if (state.editor && state.document) {
      const edit = new vscode.WorkspaceEdit();
      // Replace entire document with full content
      const fullRange = new vscode.Range(
        state.document.positionAt(0),
        state.document.positionAt(state.document.getText().length),
      );
      edit.replace(state.fileUri, fullRange, contentChunk);
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
 */
export const writeTestFileTool = createWriteTestFileTool(
  new Set<string>(),
  undefined,
);
