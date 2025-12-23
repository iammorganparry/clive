import { Effect } from "effect";
import { embedMany } from "ai";
import { ConfigService } from "./config-service.js";
import { RepositoryService } from "./repository-service.js";
import { KnowledgeBaseAgent } from "./ai-agent/knowledge-base-agent.js";
import { createEmbeddingProvider } from "./ai-provider-factory.js";
import { AIModels } from "./ai-models.js";
import type { KnowledgeBaseCategory } from "../constants.js";
import type {
  KnowledgeBaseStatus,
  KnowledgeBaseSearchResult,
  KnowledgeBaseProgressEvent,
} from "./knowledge-base-types.js";
import { KnowledgeBaseError } from "./knowledge-base-errors.js";

/**
 * Service for analyzing repository testing patterns and building knowledge base
 * Delegates to KnowledgeBaseAgent for AI-driven discovery and analysis
 */
export class KnowledgeBaseService extends Effect.Service<KnowledgeBaseService>()(
  "KnowledgeBaseService",
  {
    effect: Effect.gen(function* () {
      const configService = yield* ConfigService;
      const repositoryService = yield* RepositoryService;
      const knowledgeBaseAgent = yield* KnowledgeBaseAgent;

      /**
       * Analyze repository and build knowledge base
       * Delegates to KnowledgeBaseAgent which uses bashExecute + AI analysis
       */
      const analyzeRepository = (
        repositoryId: string,
        progressCallback?: (event: KnowledgeBaseProgressEvent) => void,
        options?: { resume?: boolean },
      ) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[KnowledgeBaseService] Starting analysis for repository: ${repositoryId}, resume: ${options?.resume}`,
          );

          let skipCategories: string[] = [];

          if (options?.resume) {
            // Get current status to determine which categories are already complete
            const currentStatus = yield* getStatus(repositoryId);
            skipCategories = currentStatus.categories;

            yield* Effect.logDebug(
              `[KnowledgeBaseService] Resume mode: skipping ${skipCategories.length} completed categories: ${skipCategories.join(', ')}`,
            );
          } else {
            // Delete existing knowledge for this repository
            yield* repositoryService
              .callTrpcMutation<{ success: boolean }>("knowledgeBase.deleteAll", {
                repositoryId,
              })
              .pipe(Effect.catchAll(() => Effect.void));
          }

          // Delegate to agent for discovery and analysis
          const result = yield* knowledgeBaseAgent.analyze(progressCallback, { skipCategories });

          yield* Effect.logDebug(
            `[KnowledgeBaseService] Analysis complete: ${result.entryCount} entries stored`,
          );

          return result;
        });

      /**
       * Get knowledge base status
       */
      const getStatus = (repositoryId: string) =>
        Effect.gen(function* () {
          const status =
            yield* repositoryService.callTrpcQuery<KnowledgeBaseStatus>(
              "knowledgeBase.getStatus",
              { repositoryId },
            );

          return status;
        });

      /**
       * Search knowledge base
       */
      const searchKnowledge = (
        repositoryId: string,
        query: string,
        options?: {
          category?: KnowledgeBaseCategory;
          limit?: number;
        },
      ) =>
        Effect.gen(function* () {
          // Generate query embedding
          const gatewayToken = yield* configService.getAiGatewayToken();
          const provider = createEmbeddingProvider({
            token: gatewayToken,
            isGateway: true,
          });

          const queryEmbedding = yield* Effect.tryPromise({
            try: async () => {
              const { embeddings } = await embedMany({
                model: provider.embedding(AIModels.openai.embedding),
                values: [query],
              });
              return embeddings[0];
            },
            catch: (error) =>
              new KnowledgeBaseError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          // Search via API
          const results = yield* repositoryService.callTrpcQuery<
            KnowledgeBaseSearchResult[]
          >("knowledgeBase.search", {
            repositoryId,
            queryEmbedding,
            category: options?.category,
            limit: options?.limit ?? 5,
          });

          return results;
        });

      return {
        analyzeRepository,
        getStatus,
        searchKnowledge,
      };
    }),
  },
) {}

/**
 * Production layer - dependencies provided at composition site
 */
export const KnowledgeBaseServiceLive = KnowledgeBaseService.Default;
