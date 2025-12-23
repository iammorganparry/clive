import { tool } from "ai";
import { z } from "zod";
import { createHash } from "node:crypto";
import { embedMany } from "ai";
import { Effect, Runtime } from "effect";
import { createSecretStorageLayerFromService } from "../../layer-factory.js";
import type { RepositoryService } from "../../repository-service.js";
import type { SecretStorageService } from "../../vs-code.js";
import {
  KnowledgeBaseCategorySchema,
  type KnowledgeBaseCategory,
} from "../../../constants.js";
import { createEmbeddingProvider } from "../../ai-provider-factory.js";
import { AIModels } from "../../ai-models.js";

/**
 * Context values pre-fetched from the agent
 */
interface UpsertKnowledgeContext {
  userId: string;
  organizationId: string | null;
  workspaceRoot: { fsPath: string };
  repositoryId: string;
  gatewayToken: string;
  secretStorageService: SecretStorageService;
}

/**
 * Create an upsertKnowledge tool that stores knowledge entries with embeddings
 */
export const createUpsertKnowledgeTool = (
  repositoryService: RepositoryService,
  context: UpsertKnowledgeContext,
  onComplete?: (category: string, success: boolean) => void,
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
      console.log(
        `[UpsertKnowledge] Starting for category: ${category}, title: ${title.substring(0, 50)}...`,
      );

      // Use pre-fetched repository ID
      console.log(
        `[UpsertKnowledge] Using pre-fetched repository ID: ${context.repositoryId}`,
      );

      console.log(
        `[UpsertKnowledge] Using pre-fetched gateway token, generating embedding...`,
      );

      const provider = createEmbeddingProvider({
        token: context.gatewayToken,
        isGateway: true,
      });

      const embeddingText = `${title}\n\n${content}`;
      console.log(`[UpsertKnowledge] Calling embedMany API...`);
      const { embeddings } = await embedMany({
        model: provider.embedding(AIModels.openai.embedding),
        values: [embeddingText],
      });

      if (!embeddings || embeddings.length === 0) {
        throw new Error("No embeddings returned");
      }

      console.log(
        `[UpsertKnowledge] Embedding generated, length: ${embeddings[0].length}`,
      );
      const embedding = embeddings[0];

      // Compute content hash
      const contentToHash = `${category}:${title}:${content}`;
      const contentHash = createHash("md5").update(contentToHash).digest("hex");

      // Store via API using abstracted call
      console.log(
        `[UpsertKnowledge] Calling API to store entry for ${category}...`,
      );

      // Provide the SecretStorageService layer needed by ConfigService.getAuthToken()
      const secretStorageLayer = createSecretStorageLayerFromService(
        context.secretStorageService,
      );

      await Runtime.runPromise(runtime)(
        repositoryService
          .callTrpcMutation<{ success: boolean }>("knowledgeBase.upsert", {
            repositoryId: context.repositoryId,
            category,
            title,
            content,
            examples: examples.length > 0 ? examples : null,
            sourceFiles: sourceFiles.length > 0 ? sourceFiles : null,
            embedding,
            contentHash,
          })
          .pipe(Effect.provide(secretStorageLayer)),
      );

      console.log(`[UpsertKnowledge] API call successful for ${category}`);
      onComplete?.(category, true);
      return { success: true };
    },
  });
};
