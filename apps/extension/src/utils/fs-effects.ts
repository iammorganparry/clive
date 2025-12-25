import { Effect } from "effect";
import * as vscode from "vscode";
import { statFileEffect, VSCodeFileStatError } from "../lib/vscode-effects.js";

/**
 * Ensure a directory exists, creating it if needed
 * Also creates parent directories if they don't exist
 */
export const ensureDirectoryExists = (
  uri: vscode.Uri,
): Effect.Effect<vscode.Uri, VSCodeFileStatError, never> =>
  Effect.gen(function* () {
    const exists = yield* statFileEffect(uri).pipe(
      Effect.map((stat) => stat.type === vscode.FileType.Directory),
      Effect.catchAll(() => Effect.succeed(false)),
    );

    if (!exists) {
      // Create parent directory first if needed
      const parentUri = vscode.Uri.joinPath(uri, "..");
      const parentExists = yield* statFileEffect(parentUri).pipe(
        Effect.map((stat) => stat.type === vscode.FileType.Directory),
        Effect.catchAll(() => Effect.succeed(false)),
      );

      if (!parentExists) {
        yield* ensureDirectoryExists(parentUri);
      }

      yield* Effect.tryPromise({
        try: () => vscode.workspace.fs.createDirectory(uri),
        catch: (error) =>
          new VSCodeFileStatError({
            uri: uri.fsPath,
            cause: error,
          }),
      });
    }

    return uri;
  });
