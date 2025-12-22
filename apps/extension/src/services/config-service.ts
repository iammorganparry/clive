import { Data, Effect, Layer } from "effect";
import { jwtDecode } from "jwt-decode";
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

class InvalidTokenError extends Data.TaggedError("InvalidTokenError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * JWT payload structure
 */
interface JwtPayload {
  sub: string; // userId
  activeOrganizationId?: string; // Better Auth organization plugin
  [key: string]: unknown;
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
         * Gets the AI API key
         * First checks for stored Anthropic API key via ApiKeyService
         * Falls back to fetching OIDC gateway token if no stored key exists
         */
        getAiApiKey: () =>
          Effect.gen(function* () {
            // First, check for stored Anthropic API key
            const apiKeyService = yield* ApiKeyService;
            const storedKey = yield* apiKeyService.getApiKey("anthropic");

            if (storedKey && storedKey.length > 0) {
              yield* Effect.logDebug(
                "[ConfigService] Using stored Anthropic API key",
              );
              return storedKey;
            }

            // Fall back to gateway token
            yield* Effect.logDebug(
              "[ConfigService] No stored key, fetching gateway token",
            );
            return yield* fetchGatewayToken();
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
         * Gets the current user ID from the auth token
         * Decodes JWT to extract the user ID from the 'sub' claim
         */
        getUserId: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              "[ConfigService] Extracting userId from auth token",
            );
            const service = yield* ConfigService;
            const authToken = yield* service.getAuthToken();
            if (!authToken) {
              return yield* Effect.fail(
                new AuthTokenMissingError({
                  message: "Authentication required",
                }),
              );
            }

            // Decode JWT to extract userId
            const decoded = yield* Effect.try({
              try: () => jwtDecode<JwtPayload>(authToken),
              catch: (error) =>
                new InvalidTokenError({
                  message:
                    error instanceof Error
                      ? `Failed to decode JWT: ${error.message}`
                      : "Failed to decode JWT",
                  cause: error,
                }),
            });

            if (!decoded.sub) {
              return yield* Effect.fail(
                new InvalidTokenError({
                  message: "Invalid token: missing user ID (sub claim)",
                }),
              );
            }

            yield* Effect.logDebug(
              `[ConfigService] UserId extracted: ${decoded.sub}`,
            );
            return decoded.sub;
          }),

        /**
         * Gets the current organization ID from the auth token
         * Decodes JWT to extract the activeOrganizationId from Better Auth's organization plugin
         */
        getOrganizationId: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              "[ConfigService] Extracting organizationId from auth token",
            );
            const service = yield* ConfigService;
            const authToken = yield* service.getAuthToken();
            if (!authToken) {
              return yield* Effect.fail(
                new AuthTokenMissingError({
                  message: "Authentication required",
                }),
              );
            }

            // Decode JWT to extract organizationId
            const decoded = yield* Effect.try({
              try: () => jwtDecode<JwtPayload>(authToken),
              catch: (error) =>
                new InvalidTokenError({
                  message:
                    error instanceof Error
                      ? `Failed to decode JWT: ${error.message}`
                      : "Failed to decode JWT",
                  cause: error,
                }),
            });

            const organizationId = decoded.activeOrganizationId;

            yield* Effect.logDebug(
              `[ConfigService] OrganizationId extracted: ${organizationId ?? "none"}`,
            );
            return organizationId ?? null;
          }),
      };
    }),
    // No dependencies - allows test injection via Layer.provide()
  },
) {}

/**
 * Production layer with all dependencies composed.
 * Use this in production code; use ConfigService.Default in tests with mocked deps.
 */
export const ConfigServiceLive = ConfigService.Default.pipe(
  Layer.provide(SecretStorageService.Default),
  Layer.provide(ApiKeyService.Default),
);
