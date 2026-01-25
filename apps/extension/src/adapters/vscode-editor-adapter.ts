/**
 * VS Code implementation of EditorAdapter
 */

import { createHash } from "node:crypto";
import type { Disposable, EditorAdapter } from "@clive/core";
import { EditorError, FileSystemError } from "@clive/core";
import { Effect, Ref } from "effect";
import * as vscode from "vscode";

/**
 * VS Code implementation of EditorAdapter as Effect Service
 *
 * NOTE: UI rendering (decorations, accept/reject buttons) is now handled
 * by the EditorInsetService using VS Code's webview insets API.
 * This service focuses only on file operations and editor state.
 */
export class VSCodeEditorAdapterService extends Effect.Service<VSCodeEditorAdapterService>()(
  "VSCodeEditorAdapterService",
  {
    effect: Effect.gen(function* () {
      // Set up listeners storage
      const fileChangeListenersRef = yield* Ref.make<
        Array<(filePath: string, content: string) => void>
      >([]);
      const activeFileListenersRef = yield* Ref.make<
        Array<(filePath: string | null) => void>
      >([]);

      // Set up event listeners - capture current listeners synchronously
      let currentFileChangeListeners: Array<
        (filePath: string, content: string) => void
      > = [];
      let currentActiveFileListeners: Array<(filePath: string | null) => void> =
        [];

      // Keep listeners in sync with Ref
      yield* Effect.sync(() => {
        // Set up document change listener
        vscode.workspace.onDidChangeTextDocument((event) => {
          const filePath = event.document.uri.fsPath;
          const content = event.document.getText();

          // Call all listeners synchronously
          for (const listener of currentFileChangeListeners) {
            listener(filePath, content);
          }
        });

        // Set up active file change listener
        vscode.window.onDidChangeActiveTextEditor((editor) => {
          const filePath = editor?.document.uri.fsPath ?? null;

          // Call all listeners synchronously
          for (const listener of currentActiveFileListeners) {
            listener(filePath);
          }
        });
      });

      // File Operations
      const readFile = (path: string) =>
        Effect.tryPromise({
          try: async () => {
            const uri = vscode.Uri.file(path);
            const document = await vscode.workspace.openTextDocument(uri);
            return document.getText();
          },
          catch: (error) =>
            new FileSystemError({
              message: `Failed to read file: ${path}`,
              cause: error,
            }),
        });

      const writeFile = (path: string, content: string) =>
        Effect.tryPromise({
          try: async () => {
            const uri = vscode.Uri.file(path);
            const buffer = Buffer.from(content, "utf-8");
            await vscode.workspace.fs.writeFile(uri, buffer);
          },
          catch: (error) =>
            new FileSystemError({
              message: `Failed to write file: ${path}`,
              cause: error,
            }),
        });

      const deleteFile = (path: string) =>
        Effect.tryPromise({
          try: async () => {
            const uri = vscode.Uri.file(path);
            await vscode.workspace.fs.delete(uri);
          },
          catch: (error) =>
            new FileSystemError({
              message: `Failed to delete file: ${path}`,
              cause: error,
            }),
        });

      const fileExists = (path: string) =>
        Effect.tryPromise({
          try: async () => {
            const uri = vscode.Uri.file(path);
            await vscode.workspace.fs.stat(uri);
            return true;
          },
          catch: () => false,
        }).pipe(Effect.catchAll(() => Effect.succeed(false)));

      // Editor State
      const getActiveFilePath = () =>
        Effect.sync(() => {
          const editor = vscode.window.activeTextEditor;
          return editor?.document.uri.fsPath ?? null;
        });

      const getFileContent = (path: string) =>
        Effect.tryPromise({
          try: async () => {
            const uri = vscode.Uri.file(path);
            const document = await vscode.workspace.openTextDocument(uri);
            return document.getText();
          },
          catch: (error) =>
            new FileSystemError({
              message: `Failed to get file content: ${path}`,
              cause: error,
            }),
        });

      const openFile = (path: string) =>
        Effect.tryPromise({
          try: async () => {
            const uri = vscode.Uri.file(path);
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document, {
              preview: false,
              preserveFocus: false,
            });
          },
          catch: (error) =>
            new EditorError({
              message: `Failed to open file: ${path}`,
              cause: error,
            }),
        });

      // Events
      const onFileChanged = (
        callback: (filePath: string, content: string) => void,
      ) =>
        Effect.gen(function* () {
          yield* Ref.update(fileChangeListenersRef, (listeners) => {
            const updated = [...listeners, callback];
            currentFileChangeListeners = updated;
            return updated;
          });

          return {
            dispose: () => {
              // Update both Ref and sync copy
              Effect.runSync(
                Ref.update(fileChangeListenersRef, (listeners) => {
                  const index = listeners.indexOf(callback);
                  if (index > -1) {
                    const updated = [...listeners];
                    updated.splice(index, 1);
                    currentFileChangeListeners = updated;
                    return updated;
                  }
                  return listeners;
                }),
              );
            },
          } satisfies Disposable;
        });

      const onActiveFileChanged = (
        callback: (filePath: string | null) => void,
      ) =>
        Effect.gen(function* () {
          yield* Ref.update(activeFileListenersRef, (listeners) => {
            const updated = [...listeners, callback];
            currentActiveFileListeners = updated;
            return updated;
          });

          return {
            dispose: () => {
              // Update both Ref and sync copy
              Effect.runSync(
                Ref.update(activeFileListenersRef, (listeners) => {
                  const index = listeners.indexOf(callback);
                  if (index > -1) {
                    const updated = [...listeners];
                    updated.splice(index, 1);
                    currentActiveFileListeners = updated;
                    return updated;
                  }
                  return listeners;
                }),
              );
            },
          } satisfies Disposable;
        });

      // Utilities
      const computeContentHash = (content: string): string => {
        return createHash("sha256").update(content).digest("hex");
      };

      return {
        readFile,
        writeFile,
        deleteFile,
        fileExists,
        getActiveFilePath,
        getFileContent,
        openFile,
        onFileChanged,
        onActiveFileChanged,
        computeContentHash,
      } satisfies EditorAdapter;
    }),
    dependencies: [],
  },
) {}
