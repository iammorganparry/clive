import { Effect, Layer } from "effect";
import vscode from "vscode";

export class VSCodeService extends Effect.Service<VSCodeService>()(
  "VSCodeService",
  {
    effect: Effect.succeed({
      workspace: vscode.workspace,
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
