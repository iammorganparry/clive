import { Data, Effect } from "effect";
import { VSCodeService } from "./vs-code.js";

class SecretStorageError extends Data.TaggedError("SecretStorageError")<{
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
      return {
        getAiApiKey: () =>
          Effect.gen(function* () {
            const vscode = yield* VSCodeService;

            return yield* Effect.tryPromise({
              try: async () => {
                return await vscode.secrets.get(Secrets.AiApiKey);
              },
              catch: (error) =>
                new SecretStorageError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                }),
            });
          }),
        storeAiApiKey: (key: string) =>
          Effect.gen(function* () {
            const vscode = yield* VSCodeService;
            yield* Effect.tryPromise({
              try: () => vscode.secrets.store(Secrets.AiApiKey, key),
              catch: (error) =>
                new SecretStorageError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                }),
            });
          }),
        isConfigured: () =>
          Effect.gen(function* () {
            const vscode = yield* VSCodeService;
            const storedKey = yield* Effect.tryPromise({
              try: async () => {
                return await vscode.secrets.get(Secrets.AiApiKey);
              },
              catch: (error) =>
                new SecretStorageError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                }),
            });
            return !!storedKey && storedKey.length > 0;
          }),
      };
    }),
    dependencies: [VSCodeService.Default],
  },
) {}
