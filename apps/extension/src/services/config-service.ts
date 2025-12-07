import { Data, Effect } from "effect";
import { SecretStorageService } from "./vs-code.js";
import { SecretKeys } from "../constants.js";

class SecretStorageError extends Data.TaggedError("SecretStorageError")<{
  message: string;
}> {}

class GatewayTokenError extends Data.TaggedError("GatewayTokenError")<{
  message: string;
}> {}

class AuthTokenMissingError extends Data.TaggedError("AuthTokenMissingError")<{
  message: string;
}> {}

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

          yield* Effect.logDebug("[ConfigService] Auth token found, fetching gateway token");
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
         * Gets the AI API key (now returns OIDC gateway token)
         * Maintains backward compatibility with existing code
         */
        getAiApiKey: fetchGatewayToken,

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
            yield* Effect.logDebug("[ConfigService] Auth token stored successfully");
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
            yield* Effect.logDebug("[ConfigService] Auth token deleted successfully");
          }),

        /**
         * Gets the auth token from secret storage
         */
        getAuthToken: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug("[ConfigService] Getting auth token from secret storage");
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
         * Checks if the service is configured (has auth token)
         */
        isConfigured: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug("[ConfigService] Checking if configured");
            const service = yield* ConfigService;
            const authToken = yield* service.getAuthToken();
            const configured = !!authToken && authToken.length > 0;
            yield* Effect.logDebug(
              `[ConfigService] Configuration status: ${configured ? "configured" : "not configured"}`,
            );
            return configured;
          }),
      };
    }),
    dependencies: [SecretStorageService.Default],
  },
) {}
