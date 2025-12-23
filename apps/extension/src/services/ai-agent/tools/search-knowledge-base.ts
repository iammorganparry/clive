import { tool } from "ai";
import { z } from "zod";
import { Effect, Runtime } from "effect";
import type { KnowledgeBaseService } from "../../knowledge-base-service.js";
import type { RepositoryService } from "../../repository-service.js";
import {
  KnowledgeBaseCategorySchema,
  type KnowledgeBaseCategory,
} from "../../../constants.js";
import {
  getRepositoryIdForWorkspace,
  KnowledgeBaseConfigLayer,
} from "../../../lib/knowledge-base-utils.js";
import type { KnowledgeBaseSearchResult } from "../../knowledge-base-types.js";

/**
 * Create a searchKnowledgeBase tool that searches the repository's testing knowledge base
 */
export const createSearchKnowledgeBaseTool = (
  knowledgeBaseService: KnowledgeBaseService,
  repositoryService: RepositoryService,
) => {
  const runtime = Runtime.defaultRuntime;

  return tool({
    description: `Search the repository's testing knowledge base for conventions, patterns, and best practices.
Use this to find:
- How this codebase structures tests (describe blocks, naming conventions)
- Mock factories and test data utilities
- Fixture patterns and test setup
- Data-testid conventions and selector patterns
- Existing test examples for similar components
- Testing framework configuration and setup

IMPORTANT: Before proposing tests, use this tool to understand this repository's testing conventions.`,
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Natural language query about testing patterns (e.g., 'how do we mock API calls', 'authentication testing patterns', 'test structure conventions')",
        ),
      category: KnowledgeBaseCategorySchema.optional().describe(
        "Optional: filter to specific knowledge category",
      ),
      limit: z
        .number()
        .optional()
        .default(5)
        .describe("Maximum number of results to return (default: 5)"),
    }),
    execute: async ({
      query,
      category,
      limit = 5,
    }: {
      query: string;
      category?: KnowledgeBaseCategory;
      limit?: number;
    }): Promise<{
      results: KnowledgeBaseSearchResult[];
      query: string;
      count: number;
    }> => {
      // Get repository ID
      const repositoryId = await Runtime.runPromise(runtime)(
        getRepositoryIdForWorkspace(repositoryService),
      );

      // Search knowledge base
      const results = await Runtime.runPromise(runtime)(
        knowledgeBaseService
          .searchKnowledge(repositoryId, query, { category, limit })
          .pipe(Effect.provide(KnowledgeBaseConfigLayer)),
      );

      return {
        results,
        query,
        count: results.length,
      };
    },
  });
};

/**
 * Default searchKnowledgeBase tool (requires service instances)
 */
export const searchKnowledgeBaseTool = (
  knowledgeBaseService: KnowledgeBaseService,
  repositoryService: RepositoryService,
) => createSearchKnowledgeBaseTool(knowledgeBaseService, repositoryService);
