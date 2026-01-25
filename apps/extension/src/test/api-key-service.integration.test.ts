import * as assert from "node:assert";
import { Effect, Layer, Runtime } from "effect";
import * as vscode from "vscode";
import type { ExtensionExports } from "../extension.js";
import {
  ApiKeyService,
  InvalidApiKeyError,
} from "../services/api-key-service.js";
import {
  createSecretStorageLayer,
  type SecretStorageService,
} from "../services/vs-code.js";

suite("ApiKeyService Integration Tests", () => {
  let context: vscode.ExtensionContext;
  const runtime = Runtime.defaultRuntime;
  let layer: Layer.Layer<ApiKeyService | SecretStorageService>;

  suiteSetup(async () => {
    // In VS Code test environment, the extension context is provided by the test runner
    // We need to activate the extension and access its context
    // The extension ID should match the "name" field in package.json
    const extensionId = "clive";

    // Get and activate the extension
    const extension =
      vscode.extensions.getExtension<ExtensionExports>(extensionId);
    if (!extension) {
      // Try to find extension by checking all installed extensions
      const allExtensions = vscode.extensions.all;
      const foundExtension = allExtensions.find(
        (ext) => ext.id === extensionId || ext.id.includes("clive"),
      ) as vscode.Extension<ExtensionExports> | undefined;

      if (!foundExtension) {
        throw new Error(
          `Extension "${extensionId}" not found. Make sure the extension is installed and the test is running in VS Code extension host.`,
        );
      }

      if (!foundExtension.isActive) {
        await foundExtension.activate();
      }

      // Get context from extension exports
      const exportedContext = foundExtension.exports?.context;
      if (exportedContext?.secrets) {
        context = exportedContext;
      } else {
        throw new Error(
          "Unable to access extension context. Integration tests require VS Code extension host with properly activated extension.",
        );
      }
    } else {
      if (!extension.isActive) {
        await extension.activate();
      }

      // Get context from extension exports
      const exportedContext = extension.exports?.context;
      if (exportedContext?.secrets) {
        context = exportedContext;
      } else {
        throw new Error(
          "Unable to access extension context. Make sure the extension is properly activated in the test environment.",
        );
      }
    }

    layer = Layer.merge(
      ApiKeyService.Default,
      createSecretStorageLayer(context),
    );
  });

  suiteTeardown(async () => {
    // Clean up: delete any test keys
    try {
      const cleanupLayer = Layer.merge(
        ApiKeyService.Default,
        createSecretStorageLayer(context),
      );

      await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        yield* service.deleteApiKey("anthropic");
      }).pipe(Effect.provide(cleanupLayer), Runtime.runPromise(runtime));
    } catch (_error) {
      // Ignore cleanup errors
      console.warn("Cleanup error:", _error);
    }
  });

  test("should store and retrieve API key using real SecretStorage", async () => {
    const testKey =
      "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";

    // Store key
    await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      yield* service.setApiKey("anthropic", testKey);
    }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

    // Retrieve key
    const retrievedKey = await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      return yield* service.getApiKey("anthropic");
    }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

    assert.strictEqual(
      retrievedKey,
      testKey,
      "Retrieved key should match stored key",
    );
  });

  test("should delete API key and verify removal", async () => {
    const testKey =
      "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";

    // Store key first
    await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      yield* service.setApiKey("anthropic", testKey);
    }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

    // Verify it exists
    const hasKeyBefore = await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      return yield* service.hasApiKey("anthropic");
    }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

    assert.strictEqual(hasKeyBefore, true, "Key should exist before deletion");

    // Delete key
    await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      yield* service.deleteApiKey("anthropic");
    }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

    // Verify it's deleted
    const hasKeyAfter = await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      return yield* service.hasApiKey("anthropic");
    }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

    assert.strictEqual(
      hasKeyAfter,
      false,
      "Key should not exist after deletion",
    );
  });

  test("should handle full authentication flow with real encryption", async () => {
    const testKey =
      "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";

    // 1. Store key
    await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      yield* service.setApiKey("anthropic", testKey);
    }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

    // 2. Verify configured
    const hasKey = await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      return yield* service.hasApiKey("anthropic");
    }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

    assert.strictEqual(hasKey, true, "Key should exist after storage");

    // 3. Get status
    const statuses = await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      return yield* service.getApiKeysStatus();
    }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

    assert.strictEqual(
      statuses.length,
      1,
      "Should have status for one provider",
    );
    assert.strictEqual(
      statuses[0].provider,
      "anthropic",
      "Provider should be anthropic",
    );
    assert.strictEqual(statuses[0].hasKey, true, "Should have key");
    assert.ok(statuses[0].maskedKey, "Should have masked key");
    const maskedKey = statuses[0].maskedKey;
    if (maskedKey) {
      assert.ok(
        maskedKey.startsWith("sk-ant-"),
        "Masked key should start with prefix",
      );
      assert.notStrictEqual(
        maskedKey,
        testKey,
        "Masked key should not be the full key",
      );
    }

    // 4. Delete key
    await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      yield* service.deleteApiKey("anthropic");
    }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

    // 5. Verify deleted
    const hasKeyAfterDelete = await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      return yield* service.hasApiKey("anthropic");
    }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

    assert.strictEqual(hasKeyAfterDelete, false, "Key should be deleted");
  });

  test("should verify keys persist across service instances", async () => {
    const testKey =
      "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";

    // Store key with first service instance
    await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      yield* service.setApiKey("anthropic", testKey);
    }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

    // Create a new service instance (new layer)
    const newLayer = Layer.merge(
      ApiKeyService.Default,
      createSecretStorageLayer(context),
    );

    // Retrieve key with second service instance
    const retrievedKey = await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      return yield* service.getApiKey("anthropic");
    }).pipe(Effect.provide(newLayer), Runtime.runPromise(runtime));

    assert.strictEqual(
      retrievedKey,
      testKey,
      "Key should persist across service instances",
    );

    // Clean up
    await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      yield* service.deleteApiKey("anthropic");
    }).pipe(Effect.provide(newLayer), Runtime.runPromise(runtime));
  });

  test("should reject invalid keys with real storage", async () => {
    const invalidKey = "invalid-key-format";

    await assert.rejects(
      async () => {
        await Effect.gen(function* () {
          const service = yield* ApiKeyService;
          yield* service.setApiKey("anthropic", invalidKey);
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));
      },
      (error: unknown) => {
        return error instanceof InvalidApiKeyError;
      },
      "Should reject invalid key format",
    );
  });

  test("should handle key update with real storage", async () => {
    const oldKey =
      "sk-ant-api03-oldkey12345678901234567890123456789012345678901234567890";
    const newKey =
      "sk-ant-api03-newkey12345678901234567890123456789012345678901234567890";

    // Store initial key
    await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      yield* service.setApiKey("anthropic", oldKey);
    }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

    // Update to new key
    await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      yield* service.setApiKey("anthropic", newKey);
    }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

    // Verify new value
    const retrievedKey = await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      return yield* service.getApiKey("anthropic");
    }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

    assert.strictEqual(retrievedKey, newKey, "Should have new key value");
    assert.notStrictEqual(
      retrievedKey,
      oldKey,
      "Should not have old key value",
    );

    // Clean up
    await Effect.gen(function* () {
      const service = yield* ApiKeyService;
      yield* service.deleteApiKey("anthropic");
    }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));
  });
});
