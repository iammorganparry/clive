import { Data, Effect } from "effect";
import { ApiUrls, ConfigFile, SecretKeys } from "../constants.js";
import { extractErrorMessage } from "../utils/error-utils.js";
import { ApiKeyService } from "./api-key-service.js";
import { SecretStorageError } from "./errors.js";
import { SecretStorageService } from "./vs-code.js";

class GatewayTokenError extends Data.TaggedError("GatewayTokenError")<{
  message: string;
}> {}

class AuthTokenMissingError extends Data.TaggedError("AuthTokenMissingError")<{
  message: string;
}> {}

class UserInfoMissingError extends Data.TaggedError("UserInfoMissingError")<{
  message: string;
}> {}

export interface UserInfo {
  userId: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  organizationId?: string | null;
}

/**
 * Result from getAiApiKey indicating the token type
 */
export interface AiTokenResult {
  token: string;
  isGateway: boolean; // true = use gateway, false = direct provider
}

export const Secrets = {
  AiApiKey: "clive.ai_api_key",
} as const;

/**
 * Service for managing application configuration and API keys
 * Uses VSCode's SecretStorage API for encrypted storage
 */
export class ConfigService extends Effect.Service<ConfigService>()(
  "ConfigService",
  {
    effect: Effect.gen(function* () {
      /**
       * Gateway token TTL: 55 minutes (tokens are valid for 1 hour)
       */
      const GATEWAY_TOKEN_TTL_MS = 55 * 60 * 1000;

      /**
       * Get cached gateway token if valid
       */
      const getCachedGatewayToken = () =>
        Effect.gen(function* () {
          const secretStorage = yield* SecretStorageService;
          const [token, expiryStr] = yield* Effect.all([
            Effect.tryPromise({
              try: () => secretStorage.secrets.get(SecretKeys.gatewayToken),
              catch: () => null,
            }),
            Effect.tryPromise({
              try: () =>
                secretStorage.secrets.get(SecretKeys.gatewayTokenExpiry),
              catch: () => null,
            }),
          ]);

          if (!token || !expiryStr) {
            return null;
          }

          const expiry = Number.parseInt(expiryStr, 10);
          const now = Date.now();

          if (Number.isNaN(expiry) || now >= expiry) {
            // Cache expired, clear it
            yield* Effect.tryPromise({
              try: () => secretStorage.secrets.delete(SecretKeys.gatewayToken),
              catch: () => null,
            });
            yield* Effect.tryPromise({
              try: () =>
                secretStorage.secrets.delete(SecretKeys.gatewayTokenExpiry),
              catch: () => null,
            });
            return null;
          }

          return token;
        });

      /**
       * Cache gateway token with expiry
       */
      const cacheGatewayToken = (token: string) =>
        Effect.gen(function* () {
          const secretStorage = yield* SecretStorageService;
          const expiry = Date.now() + GATEWAY_TOKEN_TTL_MS;
          yield* Effect.all([
            Effect.tryPromise({
              try: () =>
                secretStorage.secrets.store(SecretKeys.gatewayToken, token),
              catch: (error) =>
                new SecretStorageError({
                  message: extractErrorMessage(error),
                }),
            }),
            Effect.tryPromise({
              try: () =>
                secretStorage.secrets.store(
                  SecretKeys.gatewayTokenExpiry,
                  expiry.toString(),
                ),
              catch: (error) =>
                new SecretStorageError({
                  message: extractErrorMessage(error),
                }),
            }),
          ]);
        });

      /**
       * Helper function to fetch the AI Gateway OIDC token
       */
      const fetchGatewayToken = (skipCache = false) =>
        Effect.gen(function* () {
          // Check cache first unless skipCache is true
          if (!skipCache) {
            const cachedToken = yield* getCachedGatewayToken();
            if (cachedToken) {
              yield* Effect.logDebug(
                "[ConfigService] Using cached gateway token",
              );
              return cachedToken;
            }
          }

          yield* Effect.logDebug("[ConfigService] Fetching AI Gateway token");
          const service = yield* ConfigService;
          // Get auth token first
          const authToken = yield* service.getAuthToken();

          if (!authToken) {
            yield* Effect.logDebug(
              "[ConfigService] Auth token missing, authentication required",
            );
            return yield* Effect.fail(
              new AuthTokenMissingError({
                message: "Authentication required. Please log in.",
              }),
            );
          }

          yield* Effect.logDebug(
            "[ConfigService] Auth token found, fetching gateway token",
          );
          // Fetch OIDC gateway token from app
          const gatewayToken = yield* Effect.tryPromise({
            try: async () => {
              const response = await fetch(
                `${ApiUrls.dashboard}/api/ai/token`,
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

              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                  `Failed to fetch gateway token: ${response.status} ${response.statusText} - ${errorText}`,
                );
              }

              const data = await response.json();
              if (!data.token) {
                throw new Error("No token in gateway token response");
              }

              return data.token as string;
            },
            catch: (error) =>
              new GatewayTokenError({
                message: extractErrorMessage(error),
              }),
          });

          // Cache the token
          yield* cacheGatewayToken(gatewayToken);

          yield* Effect.logDebug(
            "[ConfigService] Gateway token fetched and cached successfully",
          );
          return gatewayToken;
        });

      return {
        /**
         * Fetches the AI Gateway OIDC token from the app's /api/ai/token endpoint
         * Requires an auth token to be stored in secret storage
         */
        getAiGatewayToken: fetchGatewayToken,

        /**
         * Gets the AI API key with metadata
         * First checks for stored Anthropic API key via ApiKeyService
         * Falls back to fetching OIDC gateway token if no stored key exists
         * Returns token with isGateway flag to indicate which provider to use
         */
        getAiApiKey: () =>
          Effect.gen(function* () {
            // First, check for stored Anthropic API key
            const apiKeyService = yield* ApiKeyService;
            const storedKey = yield* apiKeyService.getApiKey("anthropic");

            if (storedKey && storedKey.length > 0) {
              yield* Effect.logDebug(
                "[ConfigService] Using stored Anthropic API key (direct provider)",
              );
              return {
                token: storedKey,
                isGateway: false,
              } as AiTokenResult;
            }

            // Fall back to gateway token (checks cache first)
            yield* Effect.logDebug(
              "[ConfigService] No stored key, using gateway token",
            );
            const gatewayToken = yield* fetchGatewayToken();
            return {
              token: gatewayToken,
              isGateway: true,
            } as AiTokenResult;
          }),

        /**
         * Refreshes the gateway token (forces new fetch)
         */
        refreshGatewayToken: () => fetchGatewayToken(true),

        /**
         * Clears the cached gateway token
         */
        clearGatewayTokenCache: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              "[ConfigService] Clearing gateway token cache",
            );
            const secretStorage = yield* SecretStorageService;
            yield* Effect.all([
              Effect.tryPromise({
                try: () =>
                  secretStorage.secrets.delete(SecretKeys.gatewayToken),
                catch: () => null,
              }),
              Effect.tryPromise({
                try: () =>
                  secretStorage.secrets.delete(SecretKeys.gatewayTokenExpiry),
                catch: () => null,
              }),
            ]);
            yield* Effect.logDebug(
              "[ConfigService] Gateway token cache cleared",
            );
          }),

        /**
         * Gets the Firecrawl API key from ApiKeyService
         */
        getFirecrawlApiKey: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug("[ConfigService] Getting Firecrawl API key");
            const apiKeyService = yield* ApiKeyService;
            const key = yield* apiKeyService.getApiKey("firecrawl");
            if (!key || key.length === 0) {
              yield* Effect.logDebug(
                "[ConfigService] Firecrawl API key not found",
              );
              return null;
            }
            yield* Effect.logDebug("[ConfigService] Firecrawl API key found");
            return key;
          }),

        /**
         * Stores the auth token in secret storage
         */
        storeAuthToken: (token: string) =>
          Effect.gen(function* () {
            yield* Effect.logDebug("[ConfigService] Storing auth token");
            const secretStorage = yield* SecretStorageService;
            yield* Effect.tryPromise({
              try: () =>
                secretStorage.secrets.store(SecretKeys.authToken, token),
              catch: (error) =>
                new SecretStorageError({
                  message: extractErrorMessage(error),
                }),
            });
            yield* Effect.logDebug(
              "[ConfigService] Auth token stored successfully",
            );
          }),

        /**
         * Deletes the auth token from secret storage
         * Also clears gateway token cache
         */
        deleteAuthToken: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug("[ConfigService] Deleting auth token");
            const secretStorage = yield* SecretStorageService;
            yield* Effect.all([
              Effect.tryPromise({
                try: () => secretStorage.secrets.delete(SecretKeys.authToken),
                catch: (error) =>
                  new SecretStorageError({
                    message:
                      error instanceof Error ? error.message : "Unknown error",
                  }),
              }),
              // Also clear gateway token cache on logout
              Effect.tryPromise({
                try: () =>
                  secretStorage.secrets.delete(SecretKeys.gatewayToken),
                catch: () => null,
              }),
              Effect.tryPromise({
                try: () =>
                  secretStorage.secrets.delete(SecretKeys.gatewayTokenExpiry),
                catch: () => null,
              }),
            ]);
            yield* Effect.logDebug(
              "[ConfigService] Auth token and gateway cache deleted successfully",
            );
          }),

        /**
         * Gets the auth token from secret storage
         */
        getAuthToken: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              "[ConfigService] Getting auth token from secret storage",
            );
            const secretStorage = yield* SecretStorageService;
            const token = yield* Effect.tryPromise({
              try: async () => {
                return await secretStorage.secrets.get(SecretKeys.authToken);
              },
              catch: (error) =>
                new SecretStorageError({
                  message: `Failed to get the secret storage: ${extractErrorMessage(error)}`,
                }),
            });
            yield* Effect.logDebug(
              `[ConfigService] Auth token ${token ? "found" : "not found"}`,
            );
            return token;
          }),

        /**
         * Stores user info in secret storage
         */
        storeUserInfo: (userInfo: UserInfo) =>
          Effect.gen(function* () {
            yield* Effect.logDebug("[ConfigService] Storing user info");
            const secretStorage = yield* SecretStorageService;
            yield* Effect.tryPromise({
              try: () =>
                secretStorage.secrets.store(
                  SecretKeys.userInfo,
                  JSON.stringify(userInfo),
                ),
              catch: (error) =>
                new SecretStorageError({
                  message: extractErrorMessage(error),
                }),
            });
            yield* Effect.logDebug(
              "[ConfigService] User info stored successfully",
            );
          }),

        /**
         * Gets user info from secret storage
         */
        getUserInfo: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              "[ConfigService] Getting user info from secret storage",
            );
            const secretStorage = yield* SecretStorageService;
            const userInfoStr = yield* Effect.tryPromise({
              try: async () => {
                return await secretStorage.secrets.get(SecretKeys.userInfo);
              },
              catch: (error) =>
                new SecretStorageError({
                  message: `Failed to get user info: ${extractErrorMessage(error)}`,
                }),
            });

            if (!userInfoStr) {
              yield* Effect.logDebug("[ConfigService] User info not found");
              return null;
            }

            try {
              const userInfo = JSON.parse(userInfoStr) as UserInfo;
              yield* Effect.logDebug(
                `[ConfigService] User info found: userId=${userInfo.userId}`,
              );
              return userInfo;
            } catch {
              yield* Effect.logDebug(
                "[ConfigService] Failed to parse user info",
              );
              return null;
            }
          }),

        /**
         * Deletes user info from secret storage
         */
        deleteUserInfo: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug("[ConfigService] Deleting user info");
            const secretStorage = yield* SecretStorageService;
            yield* Effect.tryPromise({
              try: () => secretStorage.secrets.delete(SecretKeys.userInfo),
              catch: (error) =>
                new SecretStorageError({
                  message: extractErrorMessage(error),
                }),
            });
            yield* Effect.logDebug(
              "[ConfigService] User info deleted successfully",
            );
          }),

        /**
         * Clears all secrets from secret storage
         * Used during logout to ensure complete cleanup
         */
        clearAllSecrets: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              "[ConfigService] Clearing all secret storage",
            );
            const secretStorage = yield* SecretStorageService;

            // Delete all secret keys
            const keysToDelete = [
              SecretKeys.authToken,
              SecretKeys.userInfo,
              SecretKeys.gatewayToken,
              SecretKeys.gatewayTokenExpiry,
              SecretKeys.anthropicApiKey,
              SecretKeys.firecrawlApiKey,
            ];

            yield* Effect.all(
              keysToDelete.map((key) =>
                Effect.tryPromise({
                  try: () => secretStorage.secrets.delete(key),
                  catch: () => null,
                }),
              ),
            );

            yield* Effect.logDebug(
              "[ConfigService] All secrets cleared successfully",
            );
          }),

        /**
         * Checks if the service is configured
         * Returns true if either a stored API key OR auth token exists
         */
        isConfigured: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug("[ConfigService] Checking if configured");
            // Check for stored API key first
            const apiKeyService = yield* ApiKeyService;
            const storedKey = yield* apiKeyService.getApiKey("anthropic");
            if (storedKey && storedKey.length > 0) {
              yield* Effect.logDebug(
                "[ConfigService] Configuration status: configured (stored API key)",
              );
              return true;
            }

            // Fall back to checking auth token
            const service = yield* ConfigService;
            const authToken = yield* service.getAuthToken();
            const configured = !!authToken && authToken.length > 0;
            yield* Effect.logDebug(
              `[ConfigService] Configuration status: ${configured ? "configured (auth token)" : "not configured"}`,
            );
            return configured;
          }),

        /**
         * Gets the maximum number of concurrent files to process
         * Returns the default value from constants
         */
        getMaxConcurrentFiles: () =>
          Effect.succeed(ConfigFile.defaults.maxConcurrentFiles),

        /**
         * Gets the current user ID from stored user info
         */
        getUserId: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              "[ConfigService] Getting userId from stored user info",
            );
            const service = yield* ConfigService;
            const userInfo = yield* service.getUserInfo();

            if (!userInfo) {
              return yield* Effect.fail(
                new UserInfoMissingError({
                  message: "Authentication required. Please log in.",
                }),
              );
            }

            if (!userInfo.userId) {
              return yield* Effect.fail(
                new UserInfoMissingError({
                  message: "Invalid user info: missing userId",
                }),
              );
            }

            yield* Effect.logDebug(
              `[ConfigService] UserId found: ${userInfo.userId}`,
            );
            return userInfo.userId;
          }),

        /**
         * Gets the current organization ID from stored user info
         */
        getOrganizationId: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              "[ConfigService] Getting organizationId from stored user info",
            );
            const service = yield* ConfigService;
            const userInfo = yield* service.getUserInfo();

            if (!userInfo) {
              return yield* Effect.fail(
                new UserInfoMissingError({
                  message: "Authentication required. Please log in.",
                }),
              );
            }

            const organizationId = userInfo.organizationId ?? null;

            yield* Effect.logDebug(
              `[ConfigService] OrganizationId: ${organizationId ?? "none"}`,
            );
            return organizationId;
          }),
      };
    }),
    // No dependencies - allows test injection via Layer.provide()
  },
) {}

/**
 * Production layer - ConfigService.Default requires SecretStorageService and ApiKeyService.
 * SecretStorageService is context-specific and must be provided at the composition site.
 * Use ConfigService.Default directly - dependencies provided at composition site.
 */
export const ConfigServiceLive = ConfigService.Default;
