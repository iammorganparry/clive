import { Data, Effect, Layer } from "effect";
import { SecretStorageService } from "./vs-code.js";
import { SecretKeys } from "../constants.js";

class SecretStorageError extends Data.TaggedError("SecretStorageError")<{
  message: string;
}> {}

export class InvalidApiKeyError extends Data.TaggedError("InvalidApiKeyError")<{
  message: string;
  reason: "empty" | "invalid_prefix" | "too_short" | "invalid_format";
}> {}

export type ApiProvider = "anthropic";

export const API_PROVIDERS: Record<
  ApiProvider,
  { name: string; keyPrefix: string }
> = {
  anthropic: { name: "Anthropic", keyPrefix: "sk-ant-" },
} as const;

export interface ApiKeyStatus {
  provider: ApiProvider;
  hasKey: boolean;
  maskedKey?: string;
}

/**
 * Service for managing API keys for various providers
 * Uses VSCode's SecretStorage API for encrypted storage
 */
export class ApiKeyService extends Effect.Service<ApiKeyService>()(
  "ApiKeyService",
  {
    effect: Effect.gen(function* () {
      /**
       * Masks an API key for display purposes
       */
      const maskApiKey = (key: string, prefix: string): string => {
        if (key.length <= prefix.length + 4) {
          return `${prefix}****`;
        }
        const visibleChars = 4;
        return `${prefix}...${key.slice(-visibleChars)}`;
      };

      /**
       * Gets the secret storage key for a provider
       */
      const getSecretKey = (provider: ApiProvider): string => {
        switch (provider) {
          case "anthropic":
            return SecretKeys.anthropicApiKey;
          default:
            throw new Error(`Unknown provider: ${provider}`);
        }
      };

      /**
       * Validates an API key format for a provider
       */
      const validateApiKey = (
        provider: ApiProvider,
        key: string,
      ): Effect.Effect<void, InvalidApiKeyError> =>
        Effect.gen(function* () {
          const trimmedKey = key.trim();

          // Check if empty
          if (!trimmedKey) {
            return yield* Effect.fail(
              new InvalidApiKeyError({
                message: "API key cannot be empty",
                reason: "empty",
              }),
            );
          }

          const providerInfo = API_PROVIDERS[provider];

          // Check prefix
          if (!trimmedKey.startsWith(providerInfo.keyPrefix)) {
            return yield* Effect.fail(
              new InvalidApiKeyError({
                message: `API key must start with "${providerInfo.keyPrefix}"`,
                reason: "invalid_prefix",
              }),
            );
          }

          // Check minimum length (20 characters for Anthropic)
          const minLength = 20;
          if (trimmedKey.length < minLength) {
            return yield* Effect.fail(
              new InvalidApiKeyError({
                message: `API key must be at least ${minLength} characters long`,
                reason: "too_short",
              }),
            );
          }

          // Check format (alphanumeric, hyphens, underscores after prefix)
          const keyBody = trimmedKey.slice(providerInfo.keyPrefix.length);
          const validFormat = /^[a-zA-Z0-9_-]+$/.test(keyBody);
          if (!validFormat) {
            return yield* Effect.fail(
              new InvalidApiKeyError({
                message:
                  "API key contains invalid characters. Only letters, numbers, hyphens, and underscores are allowed.",
                reason: "invalid_format",
              }),
            );
          }
        });

      return {
        /**
         * Gets an API key for a specific provider
         */
        getApiKey: (provider: ApiProvider) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              `[ApiKeyService] Getting API key for provider: ${provider}`,
            );
            const secretStorage = yield* SecretStorageService;
            const secretKey = getSecretKey(provider);
            const key = yield* Effect.tryPromise({
              try: async () => {
                return await secretStorage.secrets.get(secretKey);
              },
              catch: (error) =>
                new SecretStorageError({
                  message:
                    error instanceof Error
                      ? `Failed to get API key: ${error.message}`
                      : "Unknown error",
                }),
            });
            yield* Effect.logDebug(
              `[ApiKeyService] API key ${key ? "found" : "not found"} for ${provider}`,
            );
            return key;
          }),

        /**
         * Validates an API key format
         */
        validateApiKey: (provider: ApiProvider, key: string) =>
          validateApiKey(provider, key),

        /**
         * Sets an API key for a specific provider
         */
        setApiKey: (provider: ApiProvider, key: string) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              `[ApiKeyService] Setting API key for provider: ${provider}`,
            );
            // Validate before storing
            yield* validateApiKey(provider, key);
            const secretStorage = yield* SecretStorageService;
            const secretKey = getSecretKey(provider);
            yield* Effect.tryPromise({
              try: () => secretStorage.secrets.store(secretKey, key.trim()),
              catch: (error) =>
                new SecretStorageError({
                  message:
                    error instanceof Error
                      ? `Failed to store API key: ${error.message}`
                      : "Unknown error",
                }),
            });
            yield* Effect.logDebug(
              `[ApiKeyService] API key stored successfully for ${provider}`,
            );
          }),

        /**
         * Deletes an API key for a specific provider
         */
        deleteApiKey: (provider: ApiProvider) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              `[ApiKeyService] Deleting API key for provider: ${provider}`,
            );
            const secretStorage = yield* SecretStorageService;
            const secretKey = getSecretKey(provider);
            yield* Effect.tryPromise({
              try: () => secretStorage.secrets.delete(secretKey),
              catch: (error) =>
                new SecretStorageError({
                  message:
                    error instanceof Error
                      ? `Failed to delete API key: ${error.message}`
                      : "Unknown error",
                }),
            });
            yield* Effect.logDebug(
              `[ApiKeyService] API key deleted successfully for ${provider}`,
            );
          }),

        /**
         * Checks if an API key exists for a provider
         */
        hasApiKey: (provider: ApiProvider) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              `[ApiKeyService] Checking if API key exists for provider: ${provider}`,
            );
            const service = yield* ApiKeyService;
            const key = yield* service.getApiKey(provider);
            const hasKey = !!key && key.length > 0;
            yield* Effect.logDebug(
              `[ApiKeyService] API key ${hasKey ? "exists" : "does not exist"} for ${provider}`,
            );
            return hasKey;
          }),

        /**
         * Gets the status of all API keys
         */
        getApiKeysStatus: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug("[ApiKeyService] Getting API keys status");
            const service = yield* ApiKeyService;
            const providers: ApiProvider[] = ["anthropic"];
            const statuses: ApiKeyStatus[] = [];

            for (const provider of providers) {
              const hasKey = yield* service.hasApiKey(provider);
              let maskedKey: string | undefined;
              if (hasKey) {
                const key = yield* service.getApiKey(provider);
                if (key) {
                  const providerInfo = API_PROVIDERS[provider];
                  maskedKey = maskApiKey(key, providerInfo.keyPrefix);
                }
              }
              statuses.push({
                provider,
                hasKey,
                maskedKey,
              });
            }

            yield* Effect.logDebug(
              `[ApiKeyService] Retrieved status for ${statuses.length} provider(s)`,
            );
            return statuses;
          }),

        /**
         * Lists all supported providers
         */
        listProviders: () =>
          Effect.sync(() => Object.keys(API_PROVIDERS) as ApiProvider[]),
      };
    }),
    // No dependencies - allows test injection via Layer.provide()
  },
) {}

/**
 * Production layer - ApiKeyService.Default requires SecretStorageService to be provided.
 * SecretStorageService is context-specific and must be provided at the composition site.
 * Use ApiKeyService.Default directly and provide SecretStorageService from context.
 */
export const ApiKeyServiceLive = ApiKeyService.Default;
