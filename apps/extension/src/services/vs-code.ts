import { Data, Effect, Layer, Option, pipe } from "effect";
import vscode from "vscode";

// ============================================================
// Error Types
// ============================================================

export class NoWorkspaceError extends Data.TaggedError("NoWorkspaceError")<{
  message: string;
}> {}

export class FileSystemError extends Data.TaggedError("FileSystemError")<{
  message: string;
  cause?: unknown;
}> {}

export class DocumentError extends Data.TaggedError("DocumentError")<{
  message: string;
  cause?: unknown;
}> {}

// ============================================================
// VSCodeService
// ============================================================

export class VSCodeService extends Effect.Service<VSCodeService>()(
  "VSCodeService",
  {
    effect: Effect.gen(function* () {
      return {
        workspace: vscode.workspace,
        window: vscode.window,
        Uri: vscode.Uri,
        WorkspaceEdit: vscode.WorkspaceEdit,
        Range: vscode.Range,

        // Workspace Operations
        getWorkspaceFolders: (): Effect.Effect<
          Option.Option<readonly vscode.WorkspaceFolder[]>
        > =>
          pipe(
            Effect.sync(() => vscode.workspace.workspaceFolders),
            Effect.map((folders) =>
              Option.fromNullable(
                folders && folders.length > 0 ? folders : null,
              ),
            ),
          ),

        getWorkspaceRoot: (): Effect.Effect<vscode.Uri, NoWorkspaceError> =>
          pipe(
            Effect.sync(() => vscode.workspace.workspaceFolders),
            Effect.flatMap((folders) =>
              pipe(
                Option.fromNullable(folders?.[0]?.uri),
                Option.match({
                  onNone: () =>
                    Effect.fail(
                      new NoWorkspaceError({
                        message: "No workspace folder found",
                      }),
                    ),
                  onSome: (uri) => Effect.succeed(uri),
                }),
              ),
            ),
          ),

        asRelativePath: (
          uri: vscode.Uri,
          includeWorkspaceFolder?: boolean,
        ): string =>
          vscode.workspace.asRelativePath(uri, includeWorkspaceFolder),

        openTextDocument: (
          uri: vscode.Uri,
        ): Effect.Effect<vscode.TextDocument, DocumentError> =>
          Effect.tryPromise({
            try: () => vscode.workspace.openTextDocument(uri),
            catch: (error) =>
              new DocumentError({
                message: "Failed to open text document",
                cause: error,
              }),
          }),

        applyEdit: (
          edit: vscode.WorkspaceEdit,
        ): Effect.Effect<boolean, DocumentError> =>
          Effect.tryPromise({
            try: () => vscode.workspace.applyEdit(edit),
            catch: (error) =>
              new DocumentError({
                message: "Failed to apply workspace edit",
                cause: error,
              }),
          }),

        // File System Operations
        stat: (
          uri: vscode.Uri,
        ): Effect.Effect<vscode.FileStat, FileSystemError> =>
          Effect.tryPromise({
            try: () => vscode.workspace.fs.stat(uri),
            catch: (error) =>
              new FileSystemError({
                message: "Failed to stat file",
                cause: error,
              }),
          }),

        createDirectory: (
          uri: vscode.Uri,
        ): Effect.Effect<void, FileSystemError> =>
          Effect.tryPromise({
            try: () => vscode.workspace.fs.createDirectory(uri),
            catch: (error) =>
              new FileSystemError({
                message: "Failed to create directory",
                cause: error,
              }),
          }),

        writeFile: (
          uri: vscode.Uri,
          content: Uint8Array,
        ): Effect.Effect<void, FileSystemError> =>
          Effect.tryPromise({
            try: () => vscode.workspace.fs.writeFile(uri, content),
            catch: (error) =>
              new FileSystemError({
                message: "Failed to write file",
                cause: error,
              }),
          }),

        readFile: (
          uri: vscode.Uri,
        ): Effect.Effect<Uint8Array, FileSystemError> =>
          Effect.tryPromise({
            try: () => vscode.workspace.fs.readFile(uri),
            catch: (error) =>
              new FileSystemError({
                message: "Failed to read file",
                cause: error,
              }),
          }),

        readFileAsString: (
          uri: vscode.Uri,
        ): Effect.Effect<string, FileSystemError> =>
          pipe(
            Effect.tryPromise({
              try: () => vscode.workspace.fs.readFile(uri),
              catch: (error) =>
                new FileSystemError({
                  message: "Failed to read file",
                  cause: error,
                }),
            }),
            Effect.map((content) => Buffer.from(content).toString("utf-8")),
          ),

        findFiles: (
          include: vscode.GlobPattern,
          exclude?: string | null,
          maxResults?: number,
        ): Effect.Effect<vscode.Uri[], FileSystemError> =>
          Effect.tryPromise({
            try: () => vscode.workspace.findFiles(include, exclude, maxResults),
            catch: (error) =>
              new FileSystemError({
                message: "Failed to find files",
                cause: error,
              }),
          }),

        isDirectory: (
          uri: vscode.Uri,
        ): Effect.Effect<boolean, FileSystemError> =>
          pipe(
            Effect.tryPromise({
              try: () => vscode.workspace.fs.stat(uri),
              catch: (error) =>
                new FileSystemError({
                  message: "Failed to stat file",
                  cause: error,
                }),
            }),
            Effect.map((stat) => stat.type === vscode.FileType.Directory),
          ),

        isFile: (
          uri: vscode.Uri,
        ): Effect.Effect<boolean, FileSystemError> =>
          pipe(
            Effect.tryPromise({
              try: () => vscode.workspace.fs.stat(uri),
              catch: (error) =>
                new FileSystemError({
                  message: "Failed to stat file",
                  cause: error,
                }),
            }),
            Effect.map((stat) => stat.type === vscode.FileType.File),
          ),

        deleteFile: (
          uri: vscode.Uri,
          options?: { recursive?: boolean; useTrash?: boolean },
        ): Effect.Effect<void, FileSystemError> =>
          Effect.tryPromise({
            try: () => vscode.workspace.fs.delete(uri, options),
            catch: (error) =>
              new FileSystemError({
                message: "Failed to delete file",
                cause: error,
              }),
          }),

        // Uri Utilities
        fileUri: (path: string): vscode.Uri => vscode.Uri.file(path),

        joinPath: (base: vscode.Uri, ...paths: string[]): vscode.Uri =>
          vscode.Uri.joinPath(base, ...paths),

        resolvePathToUri: (
          filePath: string,
          workspaceRoot: vscode.Uri,
        ): Effect.Effect<vscode.Uri> =>
          Effect.sync(() => {
            const path = require("node:path");
            if (path.isAbsolute(filePath)) {
              return vscode.Uri.file(filePath);
            }
            return vscode.Uri.joinPath(workspaceRoot, filePath);
          }),

        resolveFileUri: (
          filePath: string,
        ): Effect.Effect<vscode.Uri, NoWorkspaceError> =>
          pipe(
            Effect.sync(() => vscode.workspace.workspaceFolders),
            Effect.flatMap((folders) =>
              pipe(
                Option.fromNullable(folders?.[0]?.uri),
                Option.match({
                  onNone: () =>
                    Effect.fail(
                      new NoWorkspaceError({
                        message: "No workspace folder found",
                      }),
                    ),
                  onSome: (workspaceRoot) =>
                    Effect.sync(() => {
                      const path = require("node:path");
                      if (path.isAbsolute(filePath)) {
                        return vscode.Uri.file(filePath);
                      }
                      return vscode.Uri.joinPath(workspaceRoot, filePath);
                    }),
                }),
              ),
            ),
          ),

        // Window Operations
        showTextDocument: (
          document: vscode.TextDocument,
          options?: vscode.TextDocumentShowOptions,
        ): Effect.Effect<vscode.TextEditor, DocumentError> =>
          Effect.tryPromise({
            try: () => vscode.window.showTextDocument(document, options),
            catch: (error) =>
              new DocumentError({
                message: "Failed to show text document",
                cause: error,
              }),
          }),

        showErrorMessage: (message: string): Effect.Effect<void> =>
          Effect.sync(() => {
            vscode.window.showErrorMessage(message);
          }),

        // Edit Helpers
        createWorkspaceEdit: (): vscode.WorkspaceEdit =>
          new vscode.WorkspaceEdit(),

        createRange: (
          start: vscode.Position,
          end: vscode.Position,
        ): vscode.Range => new vscode.Range(start, end),
      };
    }),
    dependencies: [],
  },
) {}

/**
 * SecretStorageService - provides access to VS Code SecretStorage
 * Must be provided with ExtensionContext via createSecretStorageLayer
 */
export class SecretStorageService extends Effect.Service<SecretStorageService>()(
  "SecretStorageService",
  {
    effect: Effect.succeed({
      secrets: undefined as unknown as vscode.SecretStorage,
    }),
    dependencies: [],
  },
) {}

/**
 * Create a SecretStorageService layer from ExtensionContext
 */
export function createSecretStorageLayer(
  context: vscode.ExtensionContext,
): Layer.Layer<SecretStorageService> {
  return Layer.succeed(SecretStorageService, {
    _tag: "SecretStorageService",
    secrets: context.secrets,
  });
}
