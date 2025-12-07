import { Effect } from "effect";
import type * as vscode from "vscode";

/**
 * Create a SecretStorageService layer from ExtensionContext
 */
export function provideSecretStorage(context: vscode.ExtensionContext) {
  return Effect.succeed({
    secrets: context.secrets,
  });
}
