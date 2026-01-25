import * as path from "node:path";
import { tool } from "ai";
import { Effect, pipe, Runtime } from "effect";
import type * as vscode from "vscode";
import { z } from "zod";
import { normalizeEscapedChars } from "../../../utils/string-utils.js";
import {
  formatDiagnosticsMessage,
  getDiagnostics,
  getNewProblems,
} from "../../diagnostics-service.js";
import { getDiffTrackerService } from "../../diff-tracker-service.js";
import { VSCodeService } from "../../vs-code.js";
import {
  formatFileEditError,
  formatFileEditWithoutUserChanges,
} from "../response-formatter.js";
import type { WriteTestFileInput, WriteTestFileOutput } from "../types.js";

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
 * Writes files directly (non-blocking) and registers with DiffTrackerService
 * User can accept/reject via inline editor insets
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
      "Write or update a test file. Creates directories if needed. Can overwrite existing files. Use any unique string as proposalId - it will be auto-approved. Changes are written immediately and user can accept/reject via inline buttons in the editor.",
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

      return Runtime.runPromise(Runtime.defaultRuntime)(
        pipe(
          Effect.gen(function* () {
            const vsCodeService = yield* VSCodeService;
            const workspaceRoot = yield* vsCodeService.getWorkspaceRoot();

            // Resolve path relative to workspace root if not absolute
            const fileUri = path.isAbsolute(targetPath)
              ? vsCodeService.fileUri(targetPath)
              : vsCodeService.joinPath(workspaceRoot, targetPath);

            const relativePath = vsCodeService.asRelativePath(fileUri, false);

            // Check if file exists and get original content
            let fileExists = false;
            let originalContent = "";
            const fileExistsResult = yield* vsCodeService.stat(fileUri).pipe(
              Effect.map(() => true),
              Effect.catchAll(() => Effect.succeed(false)),
            );

            if (fileExistsResult) {
              const existingDoc =
                yield* vsCodeService.openTextDocument(fileUri);
              originalContent = existingDoc.getText();
              fileExists = true;
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

            // Capture pre-edit diagnostics
            const preEditDiagnostics = yield* getDiagnostics(fileUri);

            // Ensure parent directory exists
            const parentDir = vsCodeService.joinPath(fileUri, "..");
            const parentExists = yield* vsCodeService.stat(parentDir).pipe(
              Effect.map(() => true),
              Effect.catchAll(() => Effect.succeed(false)),
            );

            if (!parentExists) {
              yield* vsCodeService.createDirectory(parentDir);
            }

            // Write the file directly
            const content = Buffer.from(normalizedContent, "utf-8");
            yield* vsCodeService.writeFile(fileUri, content);

            // Open the file in the editor
            const document = yield* vsCodeService.openTextDocument(fileUri);
            yield* vsCodeService.showTextDocument(document, {
              preview: false,
              preserveFocus: false,
            });

            // Get the actual content after opening (may be auto-formatted)
            const actualContent = document.getText();

            // Register block with DiffTrackerService
            const diffTrackerService = getDiffTrackerService();
            const blockId = `write-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
            const originalLines = fileExists ? originalContent.split("\n") : [];
            const newLines = actualContent.split("\n");
            const isNewFile = !fileExists;

            diffTrackerService.registerBlock(
              fileUri.fsPath,
              blockId,
              {
                startLine: 1,
                endLine: newLines.length,
              },
              originalLines,
              newLines.length,
              originalContent,
              isNewFile,
              actualContent,
            );

            // Emit streaming callback with final content
            if (onStreamingOutput) {
              onStreamingOutput({
                filePath: callbackPath,
                content: actualContent,
                isComplete: true,
              });
            }

            // Get post-edit diagnostics
            const postEditDiagnostics = yield* getDiagnostics(fileUri);

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
              message: `${message}\n\nNote: Changes are pending user review. User can accept or reject via inline buttons in the editor.`,
            };
          }),
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const vsCodeService = yield* VSCodeService;
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";

              // Try to read current file content for error context
              const fileUri = path.isAbsolute(targetPath)
                ? vsCodeService.fileUri(targetPath)
                : vsCodeService.joinPath(
                    yield* vsCodeService.getWorkspaceRoot(),
                    targetPath,
                  );
              const relativePath = vsCodeService.asRelativePath(fileUri, false);

              const currentContent = yield* vsCodeService
                .openTextDocument(fileUri)
                .pipe(
                  Effect.map((doc) => doc.getText()),
                  Effect.catchAll(() => Effect.succeed(undefined)),
                );

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
            }),
          ),
          Effect.provide(VSCodeService.Default),
        ),
      );
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
  return Runtime.runPromise(Runtime.defaultRuntime)(
    pipe(
      Effect.gen(function* () {
        const vsCodeService = yield* VSCodeService;
        const workspaceRoot = yield* vsCodeService.getWorkspaceRoot();

        // Resolve path
        const fileUri = path.isAbsolute(targetPath)
          ? vsCodeService.fileUri(targetPath)
          : vsCodeService.joinPath(workspaceRoot, targetPath);

        // Ensure parent directory exists
        const parentDir = vsCodeService.joinPath(fileUri, "..");
        const parentExists = yield* vsCodeService.stat(parentDir).pipe(
          Effect.map(() => true),
          Effect.catchAll(() => Effect.succeed(false)),
        );

        if (!parentExists) {
          yield* vsCodeService.createDirectory(parentDir);
        }

        // Create empty file
        yield* vsCodeService.writeFile(fileUri, Buffer.from("", "utf-8"));

        // Open file in editor
        const document = yield* vsCodeService.openTextDocument(fileUri);
        const editor = yield* vsCodeService.showTextDocument(document, {
          preview: false,
          preserveFocus: false,
        });

        yield* Effect.sync(() => {
          streamingStates.set(toolCallId, {
            fileUri,
            document,
            editor,
            accumulatedContent: "",
            isInitialized: true,
          });
        });

        return { success: true };
      }),
      Effect.mapError((error) => ({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      })),
      Effect.match({
        onSuccess: (result) => result,
        onFailure: (error) => error,
      }),
      Effect.provide(VSCodeService.Default),
    ),
  );
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

  return Runtime.runPromise(Runtime.defaultRuntime)(
    pipe(
      Effect.gen(function* () {
        const vsCodeService = yield* VSCodeService;
        // Replace accumulated content (we receive full content, not a delta)
        state.accumulatedContent = contentChunk;

        if (state.editor && state.document) {
          const edit = vsCodeService.createWorkspaceEdit();
          // Replace entire document with full content
          const fullRange = vsCodeService.createRange(
            state.document.positionAt(0),
            state.document.positionAt(state.document.getText().length),
          );
          edit.replace(state.fileUri, fullRange, contentChunk);
          yield* vsCodeService.applyEdit(edit);

          // Reload document
          state.document = yield* vsCodeService.openTextDocument(state.fileUri);
        } else {
          // Fallback: write accumulated content
          const buffer = Buffer.from(state.accumulatedContent, "utf-8");
          yield* vsCodeService.writeFile(state.fileUri, buffer);
        }

        return { success: true };
      }),
      Effect.mapError((error) => ({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      })),
      Effect.match({
        onSuccess: (result) => result,
        onFailure: (error) => error,
      }),
      Effect.provide(VSCodeService.Default),
    ),
  );
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

  return Runtime.runPromise(Runtime.defaultRuntime)(
    pipe(
      Effect.gen(function* () {
        const vsCodeService = yield* VSCodeService;
        // Ensure final content is written
        const buffer = Buffer.from(state.accumulatedContent, "utf-8");
        yield* vsCodeService.writeFile(state.fileUri, buffer);

        const relativePath = vsCodeService.asRelativePath(state.fileUri, false);

        // Clean up
        yield* Effect.sync(() => {
          streamingStates.delete(toolCallId);
        });

        return { success: true, filePath: relativePath };
      }),
      Effect.mapError((error) => {
        streamingStates.delete(toolCallId);
        return {
          success: false,
          filePath: state.fileUri.fsPath,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }),
      Effect.match({
        onSuccess: (result) => result,
        onFailure: (error) => error,
      }),
      Effect.provide(VSCodeService.Default),
    ),
  );
}

/**
 * Default writeTestFileTool without approval registry (for backward compatibility)
 */
export const writeTestFileTool = createWriteTestFileTool(
  new Set<string>(),
  undefined,
);
