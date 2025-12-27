import * as vscode from "vscode";
import * as path from "node:path";
import { Data, Effect, Ref } from "effect";
import type { DiffContentProvider } from "./diff-content-provider.js";

export interface SaveChangesResult {
  finalContent: string;
  userEdits?: string; // Unified diff of user modifications
  autoFormattingEdits?: string; // Unified diff of auto-formatting changes
  newProblemsMessage?: string; // New diagnostic problems introduced
}

export interface DiffViewOptions {
  viewColumn?: vscode.ViewColumn;
  preserveFocus?: boolean;
}

export interface OpenResult {
  success: boolean;
  error?: string;
}

/**
 * Error types for DiffViewProvider
 */
export class DiffViewError extends Data.TaggedError("DiffViewError")<{
  message: string;
  cause?: unknown;
}> {}

export class DiffViewNotInitializedError extends Data.TaggedError(
  "DiffViewNotInitializedError",
)<{
  message: string;
}> {}

export class FileOperationError extends Data.TaggedError("FileOperationError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * Internal state for DiffViewProvider
 */
interface DiffViewState {
  originalContent: string;
  proposedContent: string;
  fileUri: vscode.Uri | null;
  originalUri: vscode.Uri | null;
  proposedUri: vscode.Uri | null;
  isNewFile: boolean;
  preEditDiagnostics: vscode.Diagnostic[];
  originalTrailingNewline: boolean;
  fileId: string;
}

/**
 * Manages visual diff editing interface for file operations
 * Handles streaming updates, diagnostics tracking, and file save operations
 */
export class DiffViewProvider extends Effect.Service<DiffViewProvider>()(
  "DiffViewProvider",
  {
    effect: Effect.gen(function* () {

      /**
       * Create a new DiffViewProvider instance with state
       */
      const create = (diffProvider: DiffContentProvider) =>
        Effect.gen(function* () {
          const initialState: DiffViewState = {
            originalContent: "",
            proposedContent: "",
            fileUri: null,
            originalUri: null,
            proposedUri: null,
            isNewFile: false,
            preEditDiagnostics: [],
            originalTrailingNewline: false,
            fileId: "",
          };

          const stateRef = yield* Ref.make(initialState);

          /**
           * Open diff view for editing
           */
          const open = (
            filePath: string,
            options?: DiffViewOptions,
          ): Effect.Effect<OpenResult, DiffViewError> =>
            Effect.gen(function* () {
              yield* Effect.logDebug(
                `[DiffViewProvider] Opening diff view for: ${filePath}`,
              );

              const workspaceFolders =
                vscode.workspace.workspaceFolders;
              if (!workspaceFolders || workspaceFolders.length === 0) {
                return yield* Effect.fail(
                  new DiffViewError({
                    message: "No workspace folder found",
                  }),
                );
              }

              const workspaceRoot = workspaceFolders[0].uri;

              // Resolve path
              const fileUri = path.isAbsolute(filePath)
                ? vscode.Uri.file(filePath)
                : vscode.Uri.joinPath(workspaceRoot, filePath);

              // Check if file exists
              const fileExistsResult = yield* Effect.tryPromise({
                try: () => vscode.workspace.fs.stat(fileUri),
                catch: () => undefined,
              });
              const fileExists = fileExistsResult !== undefined;

              const isNewFile = !fileExists;
              let originalContent = "";
              let originalTrailingNewline = false;

              // Read original content if file exists
              if (fileExists) {
                // Save any unsaved changes in open document
                const openDoc = vscode.workspace.textDocuments.find(
                  (doc) => doc.uri.toString() === fileUri.toString(),
                );
                if (openDoc?.isDirty) {
                  yield* Effect.tryPromise({
                    try: () => openDoc.save(),
                    catch: (error) =>
                      new FileOperationError({
                        message: "Failed to save open document",
                        cause: error,
                      }),
                  });
                }

                // Read file content
                const fileData = yield* Effect.tryPromise({
                  try: () => vscode.workspace.fs.readFile(fileUri),
                  catch: (error) =>
                    new FileOperationError({
                      message: "Failed to read file",
                      cause: error,
                    }),
                });

                originalContent = new TextDecoder("utf-8", {
                  fatal: false,
                }).decode(fileData);

                // Check for trailing newline
                originalTrailingNewline = originalContent.endsWith("\n");

                // Strip BOM if present
                if (originalContent.charCodeAt(0) === 0xfeff) {
                  originalContent = originalContent.slice(1);
                }
              } else {
                // New file - create parent directories
                const parentDir = vscode.Uri.joinPath(fileUri, "..");
                yield* Effect.tryPromise({
                  try: async () => {
                    try {
                      await vscode.workspace.fs.stat(parentDir);
                    } catch {
                      await vscode.workspace.fs.createDirectory(parentDir);
                    }
                  },
                  catch: (error) =>
                    new FileOperationError({
                      message: "Failed to create parent directory",
                      cause: error,
                    }),
                });
                originalContent = "";
                originalTrailingNewline = false;
              }

              // Capture pre-edit diagnostics
              const preEditDiagnostics = yield* getDiagnostics(fileUri);

              // Create virtual URIs for diff view using DiffContentProvider
              const fileId = fileUri.fsPath.replace(/[^a-zA-Z0-9]/g, "_");

              // Store original content in provider
              const originalUri = diffProvider.storeContent(
                `${fileId}_original`,
                originalContent,
                "existing",
              );

              // Initialize proposed content as copy of original
              const proposedContent = originalContent;

              // Store proposed content in provider
              const proposedUri = diffProvider.storeContent(
                `${fileId}_proposed`,
                proposedContent,
                "proposed",
              );

              // Open diff editor
              yield* Effect.tryPromise({
                try: () =>
                  vscode.commands.executeCommand(
                    "vscode.diff",
                    originalUri,
                    proposedUri,
                    `${path.basename(fileUri.fsPath)} (Edit Preview)`,
                    {
                      viewColumn:
                        options?.viewColumn ?? vscode.ViewColumn.Active,
                      preserveFocus: options?.preserveFocus ?? false,
                    },
                  ),
                catch: (error) =>
                  new DiffViewError({
                    message: "Failed to open diff editor",
                    cause: error,
                  }),
              });

              // Update state
              yield* Ref.update(stateRef, (state) => ({
                ...state,
                originalContent,
                proposedContent,
                fileUri,
                originalUri,
                proposedUri,
                isNewFile,
                preEditDiagnostics,
                originalTrailingNewline,
                fileId,
              }));

              return { success: true };
            }).pipe(
              Effect.catchAll((error) =>
                Effect.succeed({
                  success: false,
                  error:
                    error instanceof DiffViewError
                      ? error.message
                      : error instanceof Error
                        ? error.message
                        : "Unknown error",
                }),
              ),
            );

          /**
           * Update content in diff view (supports streaming)
           */
          const update = (
            content: string,
            isFinal: boolean,
            changeLocation?: { line: number; character: number },
          ): Effect.Effect<void, DiffViewError | DiffViewNotInitializedError> =>
            Effect.gen(function* () {
              const state = yield* Ref.get(stateRef);

              if (!state.proposedUri) {
                return yield* Effect.fail(
                  new DiffViewNotInitializedError({
                    message: "Diff view not initialized. Call open() first.",
                  }),
                );
              }

              // Strip BOM from incoming content
              let processedContent = content;
              if (processedContent.charCodeAt(0) === 0xfeff) {
                processedContent = processedContent.slice(1);
              }

              // Process content for streaming
              const lines = processedContent.split("\n");
              if (!isFinal && lines.length > 0) {
                // Remove last partial line during streaming
                lines.pop();
                processedContent = lines.join("\n");
              }

              // If final, ensure trailing newline matches original
              if (
                isFinal &&
                state.originalTrailingNewline &&
                !processedContent.endsWith("\n")
              ) {
                processedContent = `${processedContent}\n`;
              }

              // Update virtual document via content provider
              const newProposedUri = diffProvider.storeContent(
                `${state.fileId}_proposed`,
                processedContent,
                "proposed",
              );

              // Update state
              yield* Ref.update(stateRef, (state) => ({
                ...state,
                proposedContent: processedContent,
                proposedUri: newProposedUri,
              }));

              // Scroll to change location or current line
              if (changeLocation) {
                const editor = vscode.window.visibleTextEditors.find(
                  (e) =>
                    e.document.uri.toString() === newProposedUri.toString(),
                );
                if (editor) {
                  const position = new vscode.Position(
                    changeLocation.line,
                    changeLocation.character,
                  );
                  editor.revealRange(
                    new vscode.Range(position, position),
                    vscode.TextEditorRevealType.InCenter,
                  );
                }
              } else if (isFinal) {
                // Scroll to end for final update
                const editor = vscode.window.visibleTextEditors.find(
                  (e) =>
                    e.document.uri.toString() === newProposedUri.toString(),
                );
                if (editor) {
                  const lineCount = processedContent.split("\n").length;
                  const lastLine = Math.max(0, lineCount - 1);
                  editor.revealRange(
                    new vscode.Range(
                      new vscode.Position(lastLine, 0),
                      new vscode.Position(lastLine, 0),
                    ),
                    vscode.TextEditorRevealType.InCenter,
                  );
                }
              }
            });

          /**
           * Save changes and return results
           */
          const saveChanges = (): Effect.Effect<
            SaveChangesResult,
            DiffViewError | DiffViewNotInitializedError | FileOperationError
          > =>
            Effect.gen(function* () {
              const state = yield* Ref.get(stateRef);

              if (!state.fileUri) {
                return yield* Effect.fail(
                  new DiffViewNotInitializedError({
                    message: "Diff view not initialized",
                  }),
                );
              }

              // Get document text before save (to detect user edits)
              let preSaveContent = state.proposedContent;
              try {
                const proposedDoc = vscode.workspace.textDocuments.find(
                  (doc) =>
                    doc.uri.toString() === state.proposedUri?.toString(),
                );
                if (proposedDoc) {
                  preSaveContent = proposedDoc.getText();
                }
              } catch {
                // Use proposedContent as fallback
                preSaveContent = state.proposedContent;
              }

              // Save document
              yield* saveDocument(state.fileUri, preSaveContent);

              // Get document text after save (to detect auto-formatting)
              const savedDoc = yield* Effect.tryPromise({
                try: () =>
                  vscode.workspace.openTextDocument(state.fileUri as vscode.Uri),
                catch: (error) =>
                  new FileOperationError({
                    message: "Failed to open saved document",
                    cause: error,
                  }),
              });
              const postSaveContent = savedDoc.getText();

              // Show the saved file
              yield* Effect.tryPromise({
                try: () =>
                  vscode.window.showTextDocument(
                    state.fileUri as vscode.Uri,
                    {
                      viewColumn: vscode.ViewColumn.Active,
                    },
                  ),
                catch: (error) =>
                  new DiffViewError({
                    message: "Failed to show saved file",
                    cause: error,
                  }),
              });

              // Close diff views
              yield* closeDiffViews(state);

              // Get new diagnostics
              const postEditDiagnostics = yield* getDiagnostics(state.fileUri);

              const newProblems = getNewProblems(
                state.preEditDiagnostics,
                postEditDiagnostics,
              );

              // Normalize EOL for comparison
              const normalizedPreSave = normalizeEOL(preSaveContent);
              const normalizedPostSave = normalizeEOL(postSaveContent);
              const normalizedOriginal = normalizeEOL(state.proposedContent);

              // Generate diffs
              const userEdits =
                normalizedPreSave !== normalizedOriginal
                  ? generateUnifiedDiff(
                      normalizedOriginal,
                      normalizedPreSave,
                      state.fileUri.fsPath,
                    )
                  : undefined;

              const autoFormattingEdits =
                normalizedPreSave !== normalizedPostSave
                  ? generateUnifiedDiff(
                      normalizedPreSave,
                      normalizedPostSave,
                      state.fileUri.fsPath,
                    )
                  : undefined;

              const newProblemsMessage =
                newProblems.length > 0
                  ? formatDiagnosticsMessage(newProblems)
                  : undefined;

              return {
                finalContent: postSaveContent,
                userEdits,
                autoFormattingEdits,
                newProblemsMessage,
              };
            });

          /**
           * Revert changes - restore original content or delete new file
           */
          const revertChanges = (): Effect.Effect<
            void,
            DiffViewError | FileOperationError
          > =>
            Effect.gen(function* () {
              const state = yield* Ref.get(stateRef);

              if (!state.fileUri) {
                return;
              }

              if (state.isNewFile) {
                // Delete new file and created directories
                yield* Effect.tryPromise({
                  try: async () => {
                    await vscode.workspace.fs.delete(
                      state.fileUri as vscode.Uri,
                      {
                        recursive: false,
                      },
                    );
                    // Try to remove parent directory if empty
                    const parentDir = vscode.Uri.joinPath(
                      state.fileUri as vscode.Uri,
                      "..",
                    );
                    try {
                      const entries =
                        await vscode.workspace.fs.readDirectory(parentDir);
                      if (entries.length === 0) {
                        await vscode.workspace.fs.delete(parentDir, {
                          recursive: false,
                        });
                      }
                    } catch {
                      // Ignore errors removing parent directory
                    }
                  },
                  catch: (error) =>
                    new FileOperationError({
                      message: "Failed to delete file",
                      cause: error,
                    }),
                }).pipe(Effect.catchAll(() => Effect.void));
              } else {
                // Restore original content
                yield* saveDocument(
                  state.fileUri as vscode.Uri,
                  state.originalContent,
                );
              }

              yield* closeDiffViews(state);
            });

          /**
           * Reset internal state
           */
          const reset = (): Effect.Effect<void, never> =>
            Ref.set(stateRef, {
              originalContent: "",
              proposedContent: "",
              fileUri: null,
              originalUri: null,
              proposedUri: null,
              isNewFile: false,
              preEditDiagnostics: [],
              originalTrailingNewline: false,
              fileId: "",
            });

          /**
           * Get current proposed content
           */
          const getProposedContent = (): Effect.Effect<string, never> =>
            Effect.gen(function* () {
              const state = yield* Ref.get(stateRef);
              return state.proposedContent;
            });

          /**
           * Get original content
           */
          const getOriginalContent = (): Effect.Effect<string, never> =>
            Effect.gen(function* () {
              const state = yield* Ref.get(stateRef);
              return state.originalContent;
            });

          /**
           * Check if file is new
           */
          const getIsNewFile = (): Effect.Effect<boolean, never> =>
            Effect.gen(function* () {
              const state = yield* Ref.get(stateRef);
              return state.isNewFile;
            });

          return {
            open,
            update,
            saveChanges,
            revertChanges,
            reset,
            getProposedContent,
            getOriginalContent,
            getIsNewFile,
          };
        });

      /**
       * Helper: Save document
       */
      const saveDocument = (
        uri: vscode.Uri,
        content: string,
      ): Effect.Effect<void, FileOperationError> =>
        Effect.tryPromise({
          try: () => {
            const buffer = Buffer.from(content, "utf-8");
            return vscode.workspace.fs.writeFile(uri, buffer);
          },
          catch: (error) =>
            new FileOperationError({
              message: "Failed to save document",
              cause: error,
            }),
        });

      /**
       * Helper: Close diff views
       */
      const closeDiffViews = (
        state: DiffViewState,
      ): Effect.Effect<void, never> =>
        Effect.gen(function* () {
          const editors = vscode.window.visibleTextEditors.filter(
            (editor: vscode.TextEditor) => {
              const uri = editor.document.uri.toString();
              return (
                uri === state.originalUri?.toString() ||
                uri === state.proposedUri?.toString()
              );
            },
          );

          // Close editors in reverse order
          for (let i = editors.length - 1; i >= 0; i--) {
            const editor = editors[i];
            yield* Effect.tryPromise({
              try: async () => {
                await vscode.window.showTextDocument(editor.document, {
                  viewColumn: editor.viewColumn,
                  preserveFocus: true,
                });
                await vscode.commands.executeCommand(
                  "workbench.action.closeActiveEditor",
                );
              },
              catch: (error) =>
                new DiffViewError({
                  message: "Failed to close editor",
                  cause: error,
                }),
            }).pipe(Effect.catchAll(() => Effect.void));
          }
        });

      /**
       * Helper: Get diagnostics
       */
      const getDiagnostics = (
        uri: vscode.Uri,
      ): Effect.Effect<vscode.Diagnostic[], never> =>
        Effect.gen(function* () {
          // Wait a bit for diagnostics to update
          yield* Effect.sleep("3500 millis");
          const diagnostics = vscode.languages.getDiagnostics(uri);
          return diagnostics;
        });

      /**
       * Helper: Get new problems
       */
      const getNewProblems = (
        preEdit: vscode.Diagnostic[],
        postEdit: vscode.Diagnostic[],
      ): vscode.Diagnostic[] => {
        // Only report errors, not warnings (to avoid distraction)
        const preEditErrors = preEdit.filter(
          (d) => d.severity === vscode.DiagnosticSeverity.Error,
        );
        const postEditErrors = postEdit.filter(
          (d) => d.severity === vscode.DiagnosticSeverity.Error,
        );

        // Find new errors by comparing ranges and messages
        const newErrors: vscode.Diagnostic[] = [];

        for (const postError of postEditErrors) {
          const isNew = !preEditErrors.some((preError) => {
            return (
              preError.range.isEqual(postError.range) &&
              preError.message === postError.message
            );
          });

          if (isNew) {
            newErrors.push(postError);
          }
        }

        return newErrors;
      };

      /**
       * Helper: Normalize EOL
       */
      const normalizeEOL = (content: string): string => {
        // Normalize to LF
        return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      };

      /**
       * Helper: Generate unified diff
       */
      const generateUnifiedDiff = (
        oldContent: string,
        newContent: string,
        filePath: string,
      ): string => {
        const oldLines = oldContent.split("\n");
        const newLines = newContent.split("\n");

        let diff = `--- ${filePath}\n+++ ${filePath}\n`;

        // Simple unified diff generation
        // For production, consider using a proper diff library
        let oldIndex = 0;
        let newIndex = 0;

        while (oldIndex < oldLines.length || newIndex < newLines.length) {
          if (oldIndex >= oldLines.length) {
            // Only new lines remain
            diff += `+${newLines[newIndex]}\n`;
            newIndex++;
          } else if (newIndex >= newLines.length) {
            // Only old lines remain
            diff += `-${oldLines[oldIndex]}\n`;
            oldIndex++;
          } else if (oldLines[oldIndex] === newLines[newIndex]) {
            // Lines match
            diff += ` ${oldLines[oldIndex]}\n`;
            oldIndex++;
            newIndex++;
          } else {
            // Lines differ - try to find next match
            let foundMatch = false;
            for (
              let searchNew = newIndex + 1;
              searchNew < Math.min(newIndex + 10, newLines.length);
              searchNew++
            ) {
              if (oldLines[oldIndex] === newLines[searchNew]) {
                // Found match - output new lines
                for (let i = newIndex; i < searchNew; i++) {
                  diff += `+${newLines[i]}\n`;
                }
                newIndex = searchNew;
                foundMatch = true;
                break;
              }
            }

            if (!foundMatch) {
              // Output both old and new
              diff += `-${oldLines[oldIndex]}\n`;
              diff += `+${newLines[newIndex]}\n`;
              oldIndex++;
              newIndex++;
            }
          }
        }

        return diff;
      };

      /**
       * Helper: Format diagnostics message
       */
      const formatDiagnosticsMessage = (
        diagnostics: vscode.Diagnostic[],
      ): string => {
        if (diagnostics.length === 0) {
          return "";
        }

        const messages = diagnostics.map((d) => {
          const line = d.range.start.line + 1;
          const col = d.range.start.character + 1;
          return `Line ${line}, Column ${col}: ${d.message}`;
        });

        return `New diagnostic problems introduced:\n${messages.join("\n")}`;
      };

      return {
        create,
      };
    }),
  },
) {}

// Export Default layer for convenience
export const DiffViewProviderDefault = DiffViewProvider.Default;
