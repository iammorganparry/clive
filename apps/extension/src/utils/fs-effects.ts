import { Effect } from "effect";
import type * as vscode from "vscode";
import { type FileSystemError, VSCodeService } from "../services/vs-code.js";

/**
 * Ensure a directory exists, creating it if needed
 * Also creates parent directories if they don't exist
 */
export const ensureDirectoryExists = (
  uri: vscode.Uri,
): Effect.Effect<vscode.Uri, FileSystemError, VSCodeService> =>
  Effect.gen(function* () {
    const vsCodeService = yield* VSCodeService;
    const exists = yield* vsCodeService
      .isDirectory(uri)
      .pipe(Effect.catchAll(() => Effect.succeed(false)));

    if (!exists) {
      // Create parent directory first if needed
      const parentUri = vsCodeService.joinPath(uri, "..");
      const parentExists = yield* vsCodeService
        .isDirectory(parentUri)
        .pipe(Effect.catchAll(() => Effect.succeed(false)));

      if (!parentExists) {
        yield* ensureDirectoryExists(parentUri);
      }

      yield* vsCodeService.createDirectory(uri);
    }

    return uri;
  });
