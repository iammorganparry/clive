import { Data, Effect } from "effect";
import { SecretStorageService } from "./vs-code.js";
import { ApiKeyService } from "./api-key-service.js";
import { SecretKeys, ConfigFile } from "../constants.js";

class SecretStorageError extends Data.TaggedError("SecretStorageError")<{
  message: string;
}> {}

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
       * Helper function to fetch the AI Gateway OIDC token
       */
      const fetchGatewayToken = () =>
        Effect.gen(function* () {
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
              const backendUrl = "http://localhost:3000";
              const response = await fetch(`${backendUrl}/api/ai/token`, {
                method: "GET",
                headers: {
                  Authorization: `Bearer ${authToken}`,
                  "Content-Type": "application/json",
                },
              });

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
                message:
                  error instanceof Error ? error.message : "Unknown error",
              }),
          });

          yield* Effect.logDebug(
            "[ConfigService] Gateway token fetched successfully",
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

            // Fall back to gateway token
            yield* Effect.logDebug(
              "[ConfigService] No stored key, fetching gateway token",
            );
            const gatewayToken = yield* fetchGatewayToken();
            return {
              token: gatewayToken,
              isGateway: true,
            } as AiTokenResult;
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
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                }),
            });
            yield* Effect.logDebug(
              "[ConfigService] Auth token stored successfully",
            );
          }),

        /**
         * Deletes the auth token from secret storage
         */
        deleteAuthToken: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug("[ConfigService] Deleting auth token");
            const secretStorage = yield* SecretStorageService;
            yield* Effect.tryPromise({
              try: () => secretStorage.secrets.delete(SecretKeys.authToken),
              catch: (error) =>
                new SecretStorageError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                }),
            });
            yield* Effect.logDebug(
              "[ConfigService] Auth token deleted successfully",
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
                  message:
                    error instanceof Error
                      ? `Failed to get the secret storage: ${error.message}`
                      : "Unknown error",
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
                  message:
                    error instanceof Error ? error.message : "Unknown error",
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
                  message:
                    error instanceof Error
                      ? `Failed to get user info: ${error.message}`
                      : "Unknown error",
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
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                }),
            });
            yield* Effect.logDebug(
              "[ConfigService] User info deleted successfully",
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
