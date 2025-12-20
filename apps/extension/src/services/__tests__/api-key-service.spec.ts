import { describe, it, expect, beforeEach } from "vitest";
import { Effect, Runtime, Layer } from "effect";
import { ApiKeyService } from "../api-key-service.js";
import { createMockSecretStorageLayer } from "../../__mocks__/secret-storage-service.js";
import { SecretKeys } from "../../constants.js";
import type * as vscode from "vscode";

describe("ApiKeyService", () => {
  const runtime = Runtime.defaultRuntime;
  let mockSecrets: Partial<vscode.SecretStorage>;
  let storedKeys: Map<string, string>;

  beforeEach(() => {
    storedKeys = new Map();
    mockSecrets = {
      get: async (key: string) => {
        return storedKeys.get(key) || undefined;
      },
      store: async (key: string, value: string) => {
        storedKeys.set(key, value);
      },
      delete: async (key: string) => {
        storedKeys.delete(key);
      },
    };
  });

  describe("validateApiKey", () => {
    it("should reject empty key", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      await expect(
        Effect.gen(function* () {
          const service = yield* ApiKeyService;
          yield* service.validateApiKey("anthropic", "");
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow("API key cannot be empty");
    });

    it("should reject key with invalid prefix", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      await expect(
        Effect.gen(function* () {
          const service = yield* ApiKeyService;
          yield* service.validateApiKey("anthropic", "invalid-prefix-key");
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow('API key must start with "sk-ant-"');
    });

    it("should reject key that is too short", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      await expect(
        Effect.gen(function* () {
          const service = yield* ApiKeyService;
          yield* service.validateApiKey("anthropic", "sk-ant-123");
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow("API key must be at least 20 characters long");
    });

    it("should reject key with invalid characters", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      await expect(
        Effect.gen(function* () {
          const service = yield* ApiKeyService;
          yield* service.validateApiKey("anthropic", "sk-ant-abc123!@#invalid");
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow(
        "API key contains invalid characters. Only letters, numbers, hyphens, and underscores are allowed.",
      );
    });

    it("should accept valid key", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const validKey =
        "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";
      await expect(
        Effect.gen(function* () {
          const service = yield* ApiKeyService;
          yield* service.validateApiKey("anthropic", validKey);
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).resolves.not.toThrow();
    });

    it("should trim whitespace before validation", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const validKey =
        "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";
      await expect(
        Effect.gen(function* () {
          const service = yield* ApiKeyService;
          yield* service.validateApiKey("anthropic", `  ${validKey}  `);
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).resolves.not.toThrow();
    });
  });

  describe("getApiKey", () => {
    it("should return key when it exists", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const testKey =
        "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";
      storedKeys.set(SecretKeys.anthropicApiKey, testKey);

      const result = await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        return yield* service.getApiKey("anthropic");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe(testKey);
    });

    it("should return undefined when key does not exist", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const result = await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        return yield* service.getApiKey("anthropic");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBeUndefined();
    });

    it("should handle storage errors", async () => {
      const errorMockSecrets: Partial<vscode.SecretStorage> = {
        get: async () => {
          throw new Error("Storage retrieval failed");
        },
      };

      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(errorMockSecrets),
      );

      await expect(
        Effect.gen(function* () {
          const service = yield* ApiKeyService;
          return yield* service.getApiKey("anthropic");
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow();
    });
  });

  describe("setApiKey", () => {
    it("should store valid key", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const testKey =
        "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";

      await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        yield* service.setApiKey("anthropic", testKey);
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(storedKeys.get(SecretKeys.anthropicApiKey)).toBe(testKey);
    });

    it("should trim key before storing", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const testKey =
        "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";

      await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        yield* service.setApiKey("anthropic", `  ${testKey}  `);
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(storedKeys.get(SecretKeys.anthropicApiKey)).toBe(testKey);
    });

    it("should reject empty key", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      await expect(
        Effect.gen(function* () {
          const service = yield* ApiKeyService;
          yield* service.setApiKey("anthropic", "");
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow("API key cannot be empty");

      expect(storedKeys.get(SecretKeys.anthropicApiKey)).toBeUndefined();
    });

    it("should reject key with invalid prefix", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      await expect(
        Effect.gen(function* () {
          const service = yield* ApiKeyService;
          yield* service.setApiKey("anthropic", "invalid-prefix-key");
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow('API key must start with "sk-ant-"');

      expect(storedKeys.get(SecretKeys.anthropicApiKey)).toBeUndefined();
    });

    it("should reject key that is too short", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      await expect(
        Effect.gen(function* () {
          const service = yield* ApiKeyService;
          yield* service.setApiKey("anthropic", "sk-ant-123");
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow("API key must be at least 20 characters long");

      expect(storedKeys.get(SecretKeys.anthropicApiKey)).toBeUndefined();
    });

    it("should reject key with invalid characters", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      await expect(
        Effect.gen(function* () {
          const service = yield* ApiKeyService;
          yield* service.setApiKey("anthropic", "sk-ant-abc123!@#invalid");
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow(
        "API key contains invalid characters. Only letters, numbers, hyphens, and underscores are allowed.",
      );

      expect(storedKeys.get(SecretKeys.anthropicApiKey)).toBeUndefined();
    });

    it("should overwrite existing key", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const oldKey =
        "sk-ant-api03-oldkey12345678901234567890123456789012345678901234567890";
      const newKey =
        "sk-ant-api03-newkey12345678901234567890123456789012345678901234567890";

      storedKeys.set(SecretKeys.anthropicApiKey, oldKey);

      await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        yield* service.setApiKey("anthropic", newKey);
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(storedKeys.get(SecretKeys.anthropicApiKey)).toBe(newKey);
      expect(storedKeys.get(SecretKeys.anthropicApiKey)).not.toBe(oldKey);
    });

    it("should handle storage errors", async () => {
      const errorMockSecrets: Partial<vscode.SecretStorage> = {
        store: async () => {
          throw new Error("Storage failed");
        },
      };

      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(errorMockSecrets),
      );

      const validKey =
        "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";

      await expect(
        Effect.gen(function* () {
          const service = yield* ApiKeyService;
          yield* service.setApiKey("anthropic", validKey);
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow();
    });
  });

  describe("deleteApiKey", () => {
    it("should delete existing key", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const testKey =
        "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";
      storedKeys.set(SecretKeys.anthropicApiKey, testKey);

      await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        yield* service.deleteApiKey("anthropic");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(storedKeys.get(SecretKeys.anthropicApiKey)).toBeUndefined();
    });

    it("should handle deletion when key does not exist", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      await expect(
        Effect.gen(function* () {
          const service = yield* ApiKeyService;
          yield* service.deleteApiKey("anthropic");
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).resolves.not.toThrow();
    });

    it("should handle deletion errors", async () => {
      const errorMockSecrets: Partial<vscode.SecretStorage> = {
        delete: async () => {
          throw new Error("Deletion failed");
        },
      };

      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(errorMockSecrets),
      );

      await expect(
        Effect.gen(function* () {
          const service = yield* ApiKeyService;
          yield* service.deleteApiKey("anthropic");
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow();
    });
  });

  describe("hasApiKey", () => {
    it("should return true when key exists", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const testKey =
        "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";
      storedKeys.set(SecretKeys.anthropicApiKey, testKey);

      const result = await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        return yield* service.hasApiKey("anthropic");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe(true);
    });

    it("should return false when key does not exist", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const result = await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        return yield* service.hasApiKey("anthropic");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe(false);
    });

    it("should return false when key is empty string", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      storedKeys.set(SecretKeys.anthropicApiKey, "");

      const result = await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        return yield* service.hasApiKey("anthropic");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe(false);
    });
  });

  describe("getApiKeysStatus", () => {
    it("should return status for all providers", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const result = await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        return yield* service.getApiKeysStatus();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toHaveLength(1);
      expect(result[0].provider).toBe("anthropic");
      expect(result[0].hasKey).toBe(false);
    });

    it("should include masked key when key exists", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const testKey =
        "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";
      storedKeys.set(SecretKeys.anthropicApiKey, testKey);

      const result = await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        return yield* service.getApiKeysStatus();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result[0].hasKey).toBe(true);
      expect(result[0].maskedKey).toBeDefined();
      expect(result[0].maskedKey).toContain("sk-ant-");
      expect(result[0].maskedKey).not.toBe(testKey);
      expect(result[0].maskedKey).toMatch(/sk-ant-\.\.\.[a-zA-Z0-9_-]{4}$/);
    });

    it("should not include masked key when key does not exist", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const result = await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        return yield* service.getApiKeysStatus();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result[0].hasKey).toBe(false);
      expect(result[0].maskedKey).toBeUndefined();
    });

    it("should mask short keys correctly", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const shortKey = "sk-ant-abc";
      storedKeys.set(SecretKeys.anthropicApiKey, shortKey);

      const result = await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        return yield* service.getApiKeysStatus();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result[0].maskedKey).toBe("sk-ant-****");
    });
  });

  describe("listProviders", () => {
    it("should return all supported providers", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const result = await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        return yield* service.listProviders();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toEqual(["anthropic"]);
      expect(result).toHaveLength(1);
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete lifecycle: set -> get -> verify -> delete -> verify deleted", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const testKey =
        "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";

      // 1. Set key
      await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        yield* service.setApiKey("anthropic", testKey);
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(storedKeys.get(SecretKeys.anthropicApiKey)).toBe(testKey);

      // 2. Get key
      const retrievedKey = await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        return yield* service.getApiKey("anthropic");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(retrievedKey).toBe(testKey);

      // 3. Verify hasKey
      const hasKey = await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        return yield* service.hasApiKey("anthropic");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(hasKey).toBe(true);

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

      expect(hasKeyAfterDelete).toBe(false);
      expect(storedKeys.get(SecretKeys.anthropicApiKey)).toBeUndefined();
    });

    it("should handle key update: set -> update -> verify new value", async () => {
      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const oldKey =
        "sk-ant-api03-oldkey12345678901234567890123456789012345678901234567890";
      const newKey =
        "sk-ant-api03-newkey12345678901234567890123456789012345678901234567890";

      // 1. Set initial key
      await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        yield* service.setApiKey("anthropic", oldKey);
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(storedKeys.get(SecretKeys.anthropicApiKey)).toBe(oldKey);

      // 2. Update to new key
      await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        yield* service.setApiKey("anthropic", newKey);
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      // 3. Verify new value
      const retrievedKey = await Effect.gen(function* () {
        const service = yield* ApiKeyService;
        return yield* service.getApiKey("anthropic");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(retrievedKey).toBe(newKey);
      expect(retrievedKey).not.toBe(oldKey);
    });

    it("should handle error recovery: storage failures gracefully", async () => {
      const errorMockSecrets: Partial<vscode.SecretStorage> = {
        get: async () => {
          throw new Error("Storage unavailable");
        },
        store: async () => {
          throw new Error("Storage unavailable");
        },
        delete: async () => {
          throw new Error("Storage unavailable");
        },
      };

      const layer = Layer.merge(
        ApiKeyService.Default,
        createMockSecretStorageLayer(errorMockSecrets),
      );

      const validKey =
        "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";

      // All operations should fail gracefully with errors
      await expect(
        Effect.gen(function* () {
          const service = yield* ApiKeyService;
          return yield* service.getApiKey("anthropic");
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow();

      await expect(
        Effect.gen(function* () {
          const service = yield* ApiKeyService;
          yield* service.setApiKey("anthropic", validKey);
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow();

      await expect(
        Effect.gen(function* () {
          const service = yield* ApiKeyService;
          yield* service.deleteApiKey("anthropic");
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow();
    });
  });
});
