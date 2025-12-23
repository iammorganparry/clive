import { tool } from "ai";
import { z } from "zod";
import { createHash } from "crypto";
import { embedMany } from "ai";
import { Effect, Runtime } from "effect";
import { ConfigService } from "../../config-service.js";
import type { RepositoryService } from "../../repository-service.js";
import {
  KnowledgeBaseCategorySchema,
  type KnowledgeBaseCategory,
} from "../../../constants.js";
import { createEmbeddingProvider } from "../../ai-provider-factory.js";
import { AIModels } from "../../ai-models.js";
import {
  getRepositoryIdForWorkspace,
  KnowledgeBaseConfigLayer,
} from "../../../lib/knowledge-base-utils.js";
import { KnowledgeBaseError } from "../../knowledge-base-errors.js";

/**
 * Create an upsertKnowledge tool that stores knowledge entries with embeddings
 */
export const createUpsertKnowledgeTool = (
  repositoryService: RepositoryService,
) => {
  const runtime = Runtime.defaultRuntime;

  return tool({
    description: `Store a knowledge base entry for this repository's testing patterns.
    Use this after discovering and analyzing testing patterns, frameworks, mocks, fixtures, etc.
    Also use this to record gaps (missing mocks, fixtures, test coverage) and improvements (suggestions for better testing practices).
    Each entry should be focused on a specific category and include concrete examples.
    Categories: framework, patterns, mocks, fixtures, selectors, routes, assertions, hooks, utilities, coverage, gaps, improvements.`,
    inputSchema: z.object({
      category: KnowledgeBaseCategorySchema.describe(
        "Category of knowledge entry",
      ),
      title: z
        .string()
        .describe("Short, descriptive title for this knowledge entry"),
      content: z
        .string()
        .describe(
          "Detailed description of the testing pattern, framework configuration, or convention",
        ),
      examples: z
        .array(z.string())
        .optional()
        .describe("Code examples demonstrating this pattern"),
      sourceFiles: z
        .array(z.string())
        .optional()
        .describe("File paths where this knowledge was discovered"),
    }),
    execute: async ({
      category,
      title,
      content,
      examples = [],
      sourceFiles = [],
    }: {
      category: KnowledgeBaseCategory;
      title: string;
      content: string;
      examples?: string[];
      sourceFiles?: string[];
    }): Promise<{
      success: boolean;
      entryId?: string;
      error?: string;
    }> => {
      // Get repository ID
      const repositoryId = await Runtime.runPromise(runtime)(
        getRepositoryIdForWorkspace(repositoryService),
      );

      const result = await Runtime.runPromise(runtime)(
        Effect.gen(function* () {
          const configService = yield* ConfigService;

          // Generate embedding from title + content
          const gatewayToken = yield* configService.getAiGatewayToken();
          const provider = createEmbeddingProvider({
            token: gatewayToken,
            isGateway: true,
          });

          const embeddingText = `${title}\n\n${content}`;
          const embedding = yield* Effect.tryPromise({
            try: async () => {
              const { embeddings } = await embedMany({
                model: provider.embedding(AIModels.openai.embedding),
                values: [embeddingText],
              });

              if (!embeddings || embeddings.length === 0) {
                throw new Error("No embeddings returned");
              }

              return embeddings[0];
            },
            catch: (error) =>
              new KnowledgeBaseError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          // Compute content hash
          const contentToHash = `${category}:${title}:${content}`;
          const contentHash = createHash("md5")
            .update(contentToHash)
            .digest("hex");

          // Store via API
          yield* repositoryService.callTrpcMutation<{ success: boolean }>(
            "knowledgeBase.upsert",
            {
              repositoryId,
              category,
              title,
              content,
              examples: examples.length > 0 ? examples : null,
              sourceFiles: sourceFiles.length > 0 ? sourceFiles : null,
              embedding,
              contentHash,
            },
          );

          return { success: true };
        }).pipe(
          Effect.catchAll((error) =>
            Effect.succeed({
              success: false,
              error: error instanceof Error ? error.message : "Unknown error",
            }),
          ),
          Effect.provide(KnowledgeBaseConfigLayer),
        ),
      );

      return result;
    },
  });
};

/**
 * Default upsertKnowledge tool (requires service instance)
 */
export const upsertKnowledgeTool = (repositoryService: RepositoryService) =>
  createUpsertKnowledgeTool(repositoryService);
