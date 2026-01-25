import { createRouter } from "@clive/webview-rpc";
import { Effect } from "effect";
import { z } from "zod";
import { ConfigService } from "../../services/config-service.js";
import { KnowledgeBaseService } from "../../services/knowledge-base-service.js";
import type { KnowledgeBaseProgressEvent } from "../../services/knowledge-base-types.js";
import { createConfigServiceLayer } from "../../services/layer-factory.js";
import { RepositoryService } from "../../services/repository-service.js";
import { VSCodeService } from "../../services/vs-code.js";
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
    const vsCodeService = yield* VSCodeService;
    const userId = yield* configService.getUserId();
    const organizationId = yield* configService.getOrganizationId();
    const workspaceRoot = yield* vsCodeService.getWorkspaceRoot();
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
   * Status is now based on filesystem (.clive/knowledge/)
   */
  getStatus: procedure.input(z.void()).query(({ ctx }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug(
        "[KnowledgeBaseRouter] Getting status from filesystem",
      );
      const knowledgeBaseService = yield* KnowledgeBaseService;

      // No longer needs repositoryId - status is based on local filesystem
      const status = yield* knowledgeBaseService.getStatus();
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
   * Regenerate knowledge base with progress streaming
   */
  regenerateWithProgress: procedure
    .input(z.object({ resume: z.boolean().optional() }))
    .subscription(async function* ({
      input,
      ctx,
      signal: _signal,
      onProgress,
    }: {
      input: { resume?: boolean };
      ctx: RpcContext;
      signal: AbortSignal;
      onProgress?: (data: unknown) => void;
    }) {
      const serviceLayer = provideConfigLayer(ctx);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          yield* Effect.logDebug(
            "[KnowledgeBaseRouter] Regenerating knowledge base with progress",
          );
          const knowledgeBaseService = yield* KnowledgeBaseService;
          const repositoryId = yield* getRepositoryId();

          // Progress callback that yields to client
          const progressCallback = (event: KnowledgeBaseProgressEvent) => {
            if (onProgress) {
              onProgress(event);
            }
          };

          // Run analysis with progress callback
          const result = yield* knowledgeBaseService.analyzeRepository(
            repositoryId,
            progressCallback,
            { resume: input.resume },
          );

          return result;
        }).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
              yield* Effect.logDebug(
                `[KnowledgeBaseRouter] Failed to regenerate: ${errorMessage}`,
              );
              throw new Error(errorMessage);
            }),
          ),
          serviceLayer,
        ),
      );

      // Return the final result
      return result;
    }),

  /**
   * Get knowledge entries by category
   */
  getCategories: procedure.input(z.void()).query(({ ctx }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug(
        "[KnowledgeBaseRouter] Getting categories from filesystem",
      );
      const knowledgeBaseService = yield* KnowledgeBaseService;

      // No longer needs repositoryId - status is based on local filesystem
      const status = yield* knowledgeBaseService.getStatus();
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
