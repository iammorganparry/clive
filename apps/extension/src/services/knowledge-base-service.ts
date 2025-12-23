import { Effect } from "effect";
import { KnowledgeBaseAgent } from "./ai-agent/knowledge-base-agent.js";
import { KnowledgeFileService } from "./knowledge-file-service.js";
import type {
  KnowledgeBaseStatus,
  KnowledgeBaseProgressEvent,
} from "./knowledge-base-types.js";

/**
 * Service for analyzing repository testing patterns and building knowledge base
 * Uses filesystem-based storage in .clive/knowledge/ directory
 * Delegates to KnowledgeBaseAgent for AI-driven discovery and analysis
 */
export class KnowledgeBaseService extends Effect.Service<KnowledgeBaseService>()(
  "KnowledgeBaseService",
  {
    effect: Effect.gen(function* () {
      const knowledgeBaseAgent = yield* KnowledgeBaseAgent;
      const knowledgeFileService = yield* KnowledgeFileService;

      /**
       * Analyze repository and build knowledge base
       * Delegates to KnowledgeBaseAgent which uses bashExecute + AI analysis
       * Results are stored as markdown files in .clive/knowledge/
       */
      const analyzeRepository = (
        _repositoryId: string,
        progressCallback?: (event: KnowledgeBaseProgressEvent) => void,
        options?: { resume?: boolean },
      ) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[KnowledgeBaseService] Starting filesystem-based analysis, resume: ${options?.resume}`,
          );

          let skipCategories: string[] = [];

          if (options?.resume) {
            // Get current status to determine which categories are already complete
            const currentStatus = yield* getStatus();
            skipCategories = currentStatus.categories;

            yield* Effect.logDebug(
              `[KnowledgeBaseService] Resume mode: skipping ${skipCategories.length} completed categories: ${skipCategories.join(", ")}`,
            );
          }
          // No need to delete existing files - they will be overwritten by the agent

          // Delegate to agent for discovery and analysis
          const result = yield* knowledgeBaseAgent.analyze(progressCallback, {
            skipCategories,
          });

          yield* Effect.logDebug(
            `[KnowledgeBaseService] Analysis complete: ${result.entryCount} entries stored in .clive/knowledge/`,
          );

          return result;
        });

      /**
       * Get knowledge base status from filesystem
       * Checks .clive/knowledge/ directory for existing files
       */
      const getStatus = (_repositoryId?: string) =>
        Effect.gen(function* () {
          const exists = yield* knowledgeFileService.knowledgeBaseExists();

          if (!exists) {
            return {
              hasKnowledge: false,
              entryCount: 0,
              categories: [],
              lastUpdatedAt: null,
            } satisfies KnowledgeBaseStatus;
          }

          // List all knowledge files to determine status
          const files = yield* knowledgeFileService.listKnowledgeFiles();

          // Extract unique categories from files
          const categories = [
            ...new Set(
              files
                .map((f) => f.category)
                .filter((c): c is string => c !== undefined),
            ),
          ];

          return {
            hasKnowledge: files.length > 0,
            entryCount: files.length,
            categories,
            lastUpdatedAt: new Date(),
          } satisfies KnowledgeBaseStatus;
        });

      return {
        analyzeRepository,
        getStatus,
      };
    }),
  },
) {}

/**
 * Production layer - dependencies provided at composition site
 */
export const KnowledgeBaseServiceLive = KnowledgeBaseService.Default;
