import { describe, it, expect, beforeEach, vi } from "vitest";
import { Effect, Runtime } from "effect";
import { ConfigService } from "../config-service.js";
import {
  createBaseTestLayer,
  setAuthToken,
  setAnthropicApiKey,
} from "../../__tests__/test-layer-factory.js";
import { SecretKeys } from "../../constants.js";

describe("ConfigService", () => {
  const runtime = Runtime.defaultRuntime;

  describe("storeAuthToken", () => {
    it("should store auth token in secret storage", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      const testToken = "test-auth-token-123";

      await Effect.gen(function* () {
        const configService = yield* ConfigService;
        yield* configService.storeAuthToken(testToken);
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(storedTokens.get(SecretKeys.authToken)).toBe(testToken);
    });

    it("should overwrite existing auth token", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      const oldToken = "old-token";
      const newToken = "new-token";

      // Store initial token
      storedTokens.set(SecretKeys.authToken, oldToken);

      await Effect.gen(function* () {
        const configService = yield* ConfigService;
        yield* configService.storeAuthToken(newToken);
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(storedTokens.get(SecretKeys.authToken)).toBe(newToken);
      expect(storedTokens.get(SecretKeys.authToken)).not.toBe(oldToken);
    });

    it("should handle storage errors", async () => {
      const { layer, mockSecrets } = createBaseTestLayer();
      mockSecrets.store.mockRejectedValue(new Error("Storage failed"));

      await expect(
        Effect.gen(function* () {
          const configService = yield* ConfigService;
          yield* configService.storeAuthToken("test-token");
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow();
    });
  });

  describe("deleteAuthToken", () => {
    it("should delete auth token from secret storage", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      const testToken = "test-auth-token-123";
      storedTokens.set(SecretKeys.authToken, testToken);

      await Effect.gen(function* () {
        const configService = yield* ConfigService;
        yield* configService.deleteAuthToken();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(storedTokens.get(SecretKeys.authToken)).toBeUndefined();
    });

    it("should handle deletion when token does not exist", async () => {
      const { layer } = createBaseTestLayer();

      // No token stored
      await expect(
        Effect.gen(function* () {
          const configService = yield* ConfigService;
          yield* configService.deleteAuthToken();
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).resolves.not.toThrow();
    });

    it("should handle deletion errors", async () => {
      const { layer, mockSecrets } = createBaseTestLayer();
      mockSecrets.delete.mockRejectedValue(new Error("Deletion failed"));

      await expect(
        Effect.gen(function* () {
          const configService = yield* ConfigService;
          yield* configService.deleteAuthToken();
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow();
    });
  });

  describe("getAuthToken", () => {
    it("should retrieve stored auth token", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      const testToken = "test-auth-token-123";
      storedTokens.set(SecretKeys.authToken, testToken);

      const result = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.getAuthToken();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe(testToken);
    });

    it("should return undefined when no token is stored", async () => {
      const { layer } = createBaseTestLayer();

      const result = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.getAuthToken();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBeUndefined();
    });

    it("should handle retrieval errors", async () => {
      const { layer, mockSecrets } = createBaseTestLayer();
      mockSecrets.get.mockRejectedValue(new Error("Retrieval failed"));

      await expect(
        Effect.gen(function* () {
          const configService = yield* ConfigService;
          return yield* configService.getAuthToken();
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow();
    });
  });

  describe("isConfigured", () => {
    it("should return true when auth token exists", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      setAuthToken(storedTokens);

      const result = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.isConfigured();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe(true);
    });

    it("should return false when auth token does not exist", async () => {
      const { layer } = createBaseTestLayer();

      const result = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.isConfigured();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe(false);
    });

    it("should return false when auth token is empty string", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      storedTokens.set(SecretKeys.authToken, "");

      const result = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.isConfigured();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe(false);
    });
  });

  describe("isConfigured with stored API key", () => {
    it("should return true when stored API key exists (no auth token)", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      setAnthropicApiKey(storedTokens);
      // No auth token

      const result = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.isConfigured();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe(true);
    });

    it("should return true when auth token exists (no stored key)", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      setAuthToken(storedTokens);
      // No stored API key

      const result = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.isConfigured();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe(true);
    });

    it("should return false when neither stored key nor auth token exists", async () => {
      const { layer } = createBaseTestLayer();
      // Nothing stored

      const result = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.isConfigured();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe(false);
    });
  });

  describe("getAiGatewayToken", () => {
    beforeEach(() => {
      // Mock global fetch
      global.fetch = vi.fn();
    });

    it("should fetch gateway token when auth token exists", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      const authToken = "test-auth-token";
      const gatewayToken = "test-gateway-token-123";
      storedTokens.set(SecretKeys.authToken, authToken);

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: gatewayToken }),
        text: async () => "",
      } as Response);

      const result = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.getAiGatewayToken();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe(gatewayToken);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/ai/token",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
            "X-Clive-Extension": "true",
            "User-Agent": "Clive-Extension/1.0",
          },
        },
      );
    });

    it("should fail when auth token is missing", async () => {
      const { layer } = createBaseTestLayer();
      // No auth token stored

      await expect(
        Effect.gen(function* () {
          const configService = yield* ConfigService;
          return yield* configService.getAiGatewayToken();
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow("Authentication required");
    });

    it("should handle API errors", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      const authToken = "test-auth-token";
      storedTokens.set(SecretKeys.authToken, authToken);

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "Unauthorized",
      } as Response);

      await expect(
        Effect.gen(function* () {
          const configService = yield* ConfigService;
          return yield* configService.getAiGatewayToken();
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow("Failed to fetch gateway token");
    });

    it("should handle missing token in response", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      const authToken = "test-auth-token";
      storedTokens.set(SecretKeys.authToken, authToken);

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}), // No token field
        text: async () => "",
      } as Response);

      await expect(
        Effect.gen(function* () {
          const configService = yield* ConfigService;
          return yield* configService.getAiGatewayToken();
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow("No token in gateway token response");
    });

    it("should handle network errors", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      const authToken = "test-auth-token";
      storedTokens.set(SecretKeys.authToken, authToken);

      vi.mocked(global.fetch).mockRejectedValueOnce(new Error("Network error"));

      await expect(
        Effect.gen(function* () {
          const configService = yield* ConfigService;
          return yield* configService.getAiGatewayToken();
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow();
    });
  });

  describe("getAiApiKey", () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it("should return gateway token (backward compatibility)", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      const authToken = "test-auth-token";
      const gatewayToken = "test-gateway-token-123";
      storedTokens.set(SecretKeys.authToken, authToken);

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: gatewayToken }),
        text: async () => "",
      } as Response);

      const result = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.getAiApiKey();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toEqual({ token: gatewayToken, isGateway: true });
    });
  });

  describe("getAiApiKey with stored API key", () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it("should return stored Anthropic API key when available", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      const storedApiKey =
        "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";
      storedTokens.set(SecretKeys.anthropicApiKey, storedApiKey);

      const result = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.getAiApiKey();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toEqual({ token: storedApiKey, isGateway: false });
      expect(global.fetch).not.toHaveBeenCalled(); // Should not call gateway
    });

    it("should fall back to gateway token when no stored key exists", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      const authToken = "test-auth-token";
      const gatewayToken = "gateway-token-123";
      storedTokens.set(SecretKeys.authToken, authToken);
      // No anthropicApiKey stored

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: gatewayToken }),
        text: async () => "",
      } as Response);

      const result = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.getAiApiKey();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toEqual({ token: gatewayToken, isGateway: true });
      expect(global.fetch).toHaveBeenCalled();
    });

    it("should prefer stored key over gateway even when auth token exists", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      const storedApiKey =
        "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";
      storedTokens.set(SecretKeys.anthropicApiKey, storedApiKey);
      storedTokens.set(SecretKeys.authToken, "auth-token"); // Both exist

      const result = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.getAiApiKey();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toEqual({ token: storedApiKey, isGateway: false });
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("integration scenarios", () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it("should handle complete authentication flow", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      const authToken = "test-auth-token";
      const gatewayToken = "test-gateway-token-123";

      // 1. Store auth token
      await Effect.gen(function* () {
        const configService = yield* ConfigService;
        yield* configService.storeAuthToken(authToken);
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(storedTokens.get(SecretKeys.authToken)).toBe(authToken);

      // 2. Verify configured
      const isConfigured = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.isConfigured();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(isConfigured).toBe(true);

      // 3. Fetch gateway token
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: gatewayToken }),
        text: async () => "",
      } as Response);

      const fetchedToken = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.getAiGatewayToken();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(fetchedToken).toBe(gatewayToken);

      // 4. Logout (delete token)
      await Effect.gen(function* () {
        const configService = yield* ConfigService;
        yield* configService.deleteAuthToken();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      // 5. Verify not configured
      const isConfiguredAfterLogout = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.isConfigured();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(isConfiguredAfterLogout).toBe(false);
      expect(storedTokens.get(SecretKeys.authToken)).toBeUndefined();
    });

    it("should handle token refresh scenario", async () => {
      const { layer, storedTokens } = createBaseTestLayer();
      const authToken = "test-auth-token";
      const firstGatewayToken = "gateway-token-1";
      const secondGatewayToken = "gateway-token-2";

      storedTokens.set(SecretKeys.authToken, authToken);

      // First fetch
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: firstGatewayToken }),
        text: async () => "",
      } as Response);

      const firstToken = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.getAiGatewayToken();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(firstToken).toBe(firstGatewayToken);

      // Clear cache to ensure second fetch gets a new token
      await Effect.gen(function* () {
        const configService = yield* ConfigService;
        yield* configService.clearGatewayTokenCache();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      // Second fetch (simulating token refresh)
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: secondGatewayToken }),
        text: async () => "",
      } as Response);

      const secondToken = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.getAiGatewayToken();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(secondToken).toBe(secondGatewayToken);
      expect(secondToken).not.toBe(firstToken);
    });
  });

  describe("getMaxConcurrentFiles", () => {
    it("should return the default max concurrent files value", async () => {
      const { layer } = createBaseTestLayer();

      const result = await Effect.gen(function* () {
        const configService = yield* ConfigService;
        return yield* configService.getMaxConcurrentFiles();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe(3); // ConfigFile.defaults.maxConcurrentFiles
    });
  });
});
