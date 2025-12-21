/**
 * Effect wrappers for VSCode API calls
 * Provides a declarative, Effect-based interface to VSCode workspace operations
 */

import { Effect, Data } from "effect";
import * as vscode from "vscode";

/**
 * Error types for VSCode operations
 */
export class VSCodeFileReadError extends Data.TaggedError(
  "VSCodeFileReadError",
)<{
  uri: string;
  cause: unknown;
}> {}

export class VSCodeFileFindError extends Data.TaggedError(
  "VSCodeFileFindError",
)<{
  pattern: string;
  cause: unknown;
}> {}

export class VSCodeFileStatError extends Data.TaggedError(
  "VSCodeFileStatError",
)<{
  uri: string;
  cause: unknown;
}> {}

export class NoWorkspaceFolderError extends Data.TaggedError(
  "NoWorkspaceFolderError",
)<{
  message: string;
}> {}

export class VSCodeDocumentOpenError extends Data.TaggedError(
  "VSCodeDocumentOpenError",
)<{
  uri: string;
  cause: unknown;
}> {}

export class VSCodeDocumentShowError extends Data.TaggedError(
  "VSCodeDocumentShowError",
)<{
  uri: string;
  cause: unknown;
}> {}

/**
 * Get workspace root, failing if not available
 */
export const getWorkspaceRoot = () =>
  Effect.gen(function* () {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return yield* Effect.fail(
        new NoWorkspaceFolderError({ message: "No workspace folder found" }),
      );
    }
    return workspaceFolders[0].uri;
  });

/**
 * Read file contents as Uint8Array
 */
export const readFileEffect = (uri: vscode.Uri) =>
  Effect.tryPromise({
    try: () => vscode.workspace.fs.readFile(uri),
    catch: (error) =>
      new VSCodeFileReadError({
        uri: uri.fsPath,
        cause: error,
      }),
  });

/**
 * Read file contents as string
 */
export const readFileAsStringEffect = (uri: vscode.Uri) =>
  Effect.gen(function* () {
    const content = yield* readFileEffect(uri);
    return Buffer.from(content).toString("utf-8");
  });

/**
 * Find files matching a glob pattern
 */
export const findFilesEffect = (
  include: vscode.GlobPattern,
  exclude?: string | null,
  maxResults?: number,
) =>
  Effect.tryPromise({
    try: () => vscode.workspace.findFiles(include, exclude, maxResults),
    catch: (error) =>
      new VSCodeFileFindError({
        pattern: typeof include === "string" ? include : include.pattern,
        cause: error,
      }),
  });

/**
 * Get file/directory stats
 */
export const statFileEffect = (uri: vscode.Uri) =>
  Effect.tryPromise({
    try: () => vscode.workspace.fs.stat(uri),
    catch: (error) =>
      new VSCodeFileStatError({
        uri: uri.fsPath,
        cause: error,
      }),
  });

/**
 * Check if a URI points to a directory
 */
export const isDirectoryEffect = (uri: vscode.Uri) =>
  Effect.gen(function* () {
    const stat = yield* statFileEffect(uri);
    return stat.type === vscode.FileType.Directory;
  });

/**
 * Check if a URI points to a file (not directory)
 */
export const isFileEffect = (uri: vscode.Uri) =>
  Effect.gen(function* () {
    const stat = yield* statFileEffect(uri);
    return stat.type === vscode.FileType.File;
  });

/**
 * Get relative path from workspace root
 */
export const getRelativePath = (uri: vscode.Uri) =>
  Effect.sync(() => vscode.workspace.asRelativePath(uri, false));

/**
 * Resolve a path (relative or absolute) to a URI
 */
export const resolvePathToUri = (filePath: string, workspaceRoot: vscode.Uri) =>
  Effect.sync(() => {
    const path = require("node:path");
    if (path.isAbsolute(filePath)) {
      return vscode.Uri.file(filePath);
    }
    return vscode.Uri.joinPath(workspaceRoot, filePath);
  });

/**
 * Resolve a file path to a URI, using workspace root if available
 */
export const resolveFileUri = (filePath: string) =>
  Effect.gen(function* () {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const workspaceRoot = workspaceFolders[0].uri;
      return yield* resolvePathToUri(filePath, workspaceRoot);
    }
    return vscode.Uri.file(filePath);
  });

/**
 * Open a text document
 */
export const openTextDocumentEffect = (uri: vscode.Uri) =>
  Effect.tryPromise({
    try: () => vscode.workspace.openTextDocument(uri),
    catch: (error) =>
      new VSCodeDocumentOpenError({
        uri: uri.fsPath,
        cause: error,
      }),
  });

/**
 * Show a text document in the editor
 */
export const showTextDocumentEffect = (
  document: vscode.TextDocument,
  column?: vscode.ViewColumn,
  preserveFocus?: boolean,
) =>
  Effect.tryPromise({
    try: () => vscode.window.showTextDocument(document, column, preserveFocus),
    catch: (error) =>
      new VSCodeDocumentShowError({
        uri: document.uri.fsPath,
        cause: error,
      }),
  });

/**
 * Show an error message to the user
 */
export const showErrorMessageEffect = (message: string) =>
  Effect.sync(() => {
    vscode.window.showErrorMessage(message);
  });
