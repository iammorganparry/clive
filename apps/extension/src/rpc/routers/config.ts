import { Effect, Layer } from "effect";
import { z } from "zod";
import { createRouter } from "@clive/webview-rpc";
import { ConfigService as ConfigServiceEffect } from "../../services/config-service.js";
import { ApiKeyService } from "../../services/api-key-service.js";
import {
  VSCodeService,
  createSecretStorageLayer,
} from "../../services/vs-code.js";
import { createLoggerLayer } from "../../services/logger-service.js";
import type { RpcContext } from "../context.js";

const { procedure } = createRouter<RpcContext>();

/**
 * Helper to create the service layer from context
 */
function createServiceLayer(ctx: RpcContext) {
  // Merge all layers - Effect-TS will automatically resolve dependencies
  // when all required services are included in the merge
  return Layer.mergeAll(
    ConfigServiceEffect.Default,
    ApiKeyService.Default,
    VSCodeService.Default,
    createSecretStorageLayer(ctx.context),
    createLoggerLayer(ctx.outputChannel, ctx.isDev),
  );
}

/**
 * Config router - handles configuration operations
 */
export const configRouter = {
  /**
   * Get API keys status
   */
  getApiKeys: procedure.input(z.void()).query(({ ctx }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug("[ConfigRouter] Getting API keys status");
      const apiKeyService = yield* ApiKeyService;
      const statuses = yield* apiKeyService.getApiKeysStatus();
      return { statuses };
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          yield* Effect.logDebug(
            `[ConfigRouter] Failed to get API keys: ${errorMessage}`,
          );
          return { statuses: [], error: errorMessage };
        }),
      ),
      Effect.provide(createServiceLayer(ctx)),
    ),
  ),

  /**
   * Save API key
   */
  saveApiKey: procedure
    .input(
      z.object({
        provider: z.string(),
        key: z.string(),
      }),
    )
    .mutation(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[ConfigRouter] Saving API key for provider: ${input.provider}`,
        );
        const apiKeyService = yield* ApiKeyService;
        yield* apiKeyService.setApiKey(
          input.provider as "anthropic",
          input.key,
        );
        // Refresh and return updated status
        const statuses = yield* apiKeyService.getApiKeysStatus();
        return { statuses };
      }).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            yield* Effect.logDebug(
              `[ConfigRouter] Failed to save API key: ${errorMessage}`,
            );
            return { statuses: [], error: errorMessage };
          }),
        ),
        Effect.provide(createServiceLayer(ctx)),
      ),
    ),

  /**
   * Delete API key
   */
  deleteApiKey: procedure
    .input(
      z.object({
        provider: z.string(),
      }),
    )
    .mutation(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[ConfigRouter] Deleting API key for provider: ${input.provider}`,
        );
        const apiKeyService = yield* ApiKeyService;
        yield* apiKeyService.deleteApiKey(input.provider as "anthropic");
        // Refresh and return updated status
        const statuses = yield* apiKeyService.getApiKeysStatus();
        return { statuses };
      }).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            yield* Effect.logDebug(
              `[ConfigRouter] Failed to delete API key: ${errorMessage}`,
            );
            return { statuses: [], error: errorMessage };
          }),
        ),
        Effect.provide(createServiceLayer(ctx)),
      ),
    ),
};
