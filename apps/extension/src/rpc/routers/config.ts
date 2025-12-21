import { Effect, Layer } from "effect";
import { z } from "zod";
import { createRouter } from "@clive/webview-rpc";
import { ConfigService as ConfigServiceEffect } from "../../services/config-service.js";
import { ApiKeyService } from "../../services/api-key-service.js";
import { CodebaseIndexingService } from "../../services/codebase-indexing-service.js";
import { RepositoryService } from "../../services/repository-service.js";
import {
  VSCodeService,
  createSecretStorageLayer,
} from "../../services/vs-code.js";
import { createLoggerLayer } from "../../services/logger-service.js";
import { getWorkspaceRoot } from "../../lib/vscode-effects.js";
import type { RpcContext } from "../context.js";

const { procedure } = createRouter<RpcContext>();

/**
 * Helper to create error response for indexing status errors
 */
function createIndexingStatusErrorResponse(
  errorType: string,
  error: { message: string },
) {
  return Effect.gen(function* () {
    yield* Effect.logDebug(
      `[ConfigRouter] ${errorType} error getting indexing status: ${error.message}`,
    );
    return {
      status: "error" as const,
      repositoryName: null,
      repositoryPath: null,
      lastIndexedAt: null,
      fileCount: 0,
      errorMessage: error.message,
    };
  });
}

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
    RepositoryService.Default,
    CodebaseIndexingService.Default,
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

  /**
   * Get indexing status
   */
  getIndexingStatus: procedure.input(z.void()).query(({ ctx }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug("[ConfigRouter] Getting indexing status");
      const configService = yield* ConfigServiceEffect;
      const repositoryService = yield* RepositoryService;
      const indexingService = yield* CodebaseIndexingService;

      // Get userId and organizationId
      const userId = yield* configService.getUserId();
      const organizationId = yield* configService.getOrganizationId();

      // Get workspace root
      const workspaceRoot = yield* getWorkspaceRoot();
      const rootPath = workspaceRoot.fsPath;

      // Get repository status (scoped to organization if available)
      const repoStatus = yield* repositoryService.getIndexingStatus(
        userId,
        rootPath,
        organizationId,
      );

      // Get current indexing state
      const currentStatus = yield* indexingService.getStatus();

      // Merge statuses - if indexing is in progress, use that; otherwise use repo status
      const status =
        currentStatus === "in_progress" || currentStatus === "error"
          ? currentStatus
          : repoStatus.status;

      return {
        ...repoStatus,
        status,
      };
    }).pipe(
      Effect.catchTag("RepositoryError", (error) =>
        createIndexingStatusErrorResponse("Repository", error),
      ),
      Effect.catchTag("InvalidTokenError", (error) =>
        createIndexingStatusErrorResponse("Invalid token", error),
      ),
      Effect.catchTag("AuthTokenMissingError", (error) =>
        createIndexingStatusErrorResponse("Auth token missing", error),
      ),
      Effect.catchTag("NoWorkspaceFolderError", (error) =>
        createIndexingStatusErrorResponse("No workspace folder", error),
      ),
      Effect.provide(createServiceLayer(ctx)),
    ),
  ),

  /**
   * Trigger re-indexing of the workspace
   */
  triggerReindex: procedure.input(z.void()).mutation(({ ctx }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug("[ConfigRouter] Triggering re-index");
      const indexingService = yield* CodebaseIndexingService;

      // Trigger indexing in background (don't wait for completion)
      // Fork the effect - errors in the forked effect are handled by the indexing service itself
      yield* indexingService.indexWorkspace().pipe(
        Effect.fork,
        Effect.catchAll(() => Effect.void), // Ignore fork errors - indexing runs in background
      );

      return { success: true };
    }).pipe(Effect.provide(createServiceLayer(ctx))),
  ),
};
