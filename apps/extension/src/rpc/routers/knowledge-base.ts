import { Effect } from "effect";
import { z } from "zod";
import { createRouter } from "@clive/webview-rpc";
import { KnowledgeBaseService } from "../../services/knowledge-base-service.js";
import { RepositoryService } from "../../services/repository-service.js";
import { ConfigService } from "../../services/config-service.js";
import { createConfigServiceLayer } from "../../services/layer-factory.js";
import { getWorkspaceRoot } from "../../lib/vscode-effects.js";
import type { RpcContext } from "../context.js";

const { procedure } = createRouter<RpcContext>();

/**
 * Get the config layer - uses override if provided, otherwise creates default.
 */
const provideConfigLayer = (ctx: RpcContext) => {
  const layer = ctx.configLayer ?? createConfigServiceLayer(ctx.layerContext);
  return <A, E>(effect: Effect.Effect<A, E, unknown>) =>
    effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>;
};

/**
 * Get repository ID for current workspace
 * Uses services from the provided layer context
 */
const getRepositoryId = () =>
  Effect.gen(function* () {
    const configService = yield* ConfigService;
    const repositoryService = yield* RepositoryService;
    const userId = yield* configService.getUserId();
    const organizationId = yield* configService.getOrganizationId();
    const workspaceRoot = yield* getWorkspaceRoot();
    const rootPath = workspaceRoot.fsPath;
    const workspaceName = rootPath.split("/").pop() || "workspace";

    const repository = yield* repositoryService.upsertRepository(
      userId,
      workspaceName,
      rootPath,
      organizationId,
    );

    return repository.id;
  });

/**
 * Knowledge base router
 */
export const knowledgeBaseRouter = {
  /**
   * Get knowledge base status for current workspace
   */
  getStatus: procedure.input(z.void()).query(({ ctx }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug("[KnowledgeBaseRouter] Getting status");
      const knowledgeBaseService = yield* KnowledgeBaseService;
      const repositoryId = yield* getRepositoryId();

      const status = yield* knowledgeBaseService.getStatus(repositoryId);
      return status;
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          yield* Effect.logDebug(
            `[KnowledgeBaseRouter] Failed to get status: ${errorMessage}`,
          );
          return {
            hasKnowledge: false,
            lastUpdatedAt: null,
            categories: [],
            entryCount: 0,
          };
        }),
      ),
      provideConfigLayer(ctx),
    ),
  ),

  /**
   * Regenerate knowledge base for current workspace
   */
  regenerate: procedure.input(z.void()).mutation(({ ctx }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug(
        "[KnowledgeBaseRouter] Regenerating knowledge base",
      );
      const knowledgeBaseService = yield* KnowledgeBaseService;
      const repositoryId = yield* getRepositoryId();

      // Run analysis in background
      yield* knowledgeBaseService.analyzeRepository(repositoryId).pipe(
        Effect.tapError((error) =>
          Effect.logDebug(
            `[KnowledgeBaseRouter] Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ),
        Effect.forkDaemon,
        Effect.catchAll(() => Effect.void),
      );

      return { success: true };
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          yield* Effect.logDebug(
            `[KnowledgeBaseRouter] Failed to regenerate: ${errorMessage}`,
          );
          return { success: false, error: errorMessage };
        }),
      ),
      provideConfigLayer(ctx),
    ),
  ),

  /**
   * Get knowledge entries by category
   */
  getCategories: procedure.input(z.void()).query(({ ctx }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug("[KnowledgeBaseRouter] Getting categories");
      const knowledgeBaseService = yield* KnowledgeBaseService;
      const repositoryId = yield* getRepositoryId();

      const status = yield* knowledgeBaseService.getStatus(repositoryId);
      return {
        categories: status.categories,
        entryCount: status.entryCount,
      };
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          yield* Effect.logDebug(
            `[KnowledgeBaseRouter] Failed to get categories: ${errorMessage}`,
          );
          return { categories: [], entryCount: 0 };
        }),
      ),
      provideConfigLayer(ctx),
    ),
  ),
};
