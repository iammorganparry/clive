import { Layer } from "effect";
import { SecretStorageService } from "../services/vs-code.js";
import type * as vscode from "vscode";

/**
 * Create a mock SecretStorageService layer for testing
 * @deprecated Use createSecretStorageTestLayer from test-layer-factory.ts instead
 */
export function createMockSecretStorageLayer(
  mockSecrets: Partial<vscode.SecretStorage>,
): Layer.Layer<SecretStorageService> {
  return Layer.succeed(SecretStorageService, {
    _tag: "SecretStorageService",
    secrets: {
      get: mockSecrets.get || (async () => undefined),
      store: mockSecrets.store || (async () => {}),
      delete: mockSecrets.delete || (async () => {}),
    } as vscode.SecretStorage,
  });
}

// Re-export new utilities for gradual migration
export {
  createMockSecretStorage,
  createSecretStorageTestLayer,
} from "../__tests__/test-layer-factory.js";
