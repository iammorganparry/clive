import { tool } from "ai";
import { z } from "zod";
import { Effect, Runtime, Layer } from "effect";
import type { CodebaseIndexingService } from "../../codebase-indexing-service.js";
import { ConfigService } from "../../config-service.js";
import { SecretStorageService } from "../../vs-code.js";

/**
 * Search result from semantic search
 */
export interface SemanticSearchResult {
  filePath: string;
  relativePath: string;
  content: string;
  similarity: number;
  fileType: string;
}

/**
 * Create a semantic search tool that searches the indexed codebase
 * Uses CodebaseIndexingService to find related code patterns and files
 * Falls back to in-memory search if repository ID is not available
 */
export const createSemanticSearchTool = (
  indexingService: CodebaseIndexingService,
) => {
  const runtime = Runtime.defaultRuntime;

  return tool({
    description:
      "Search the indexed codebase for related code patterns, components, and files using semantic similarity. Use this to find related components, existing test patterns, route definitions, and understand code dependencies. This searches both the database-indexed files and in-memory indexed files.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Natural language query describing what you're looking for (e.g., 'login form component', 'existing Cypress tests for authentication', 'route definitions for dashboard')",
        ),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum number of results to return (default: 10)"),
    }),
    execute: async ({
      query,
      limit = 10,
    }: {
      query: string;
      limit?: number;
    }): Promise<{
      results: SemanticSearchResult[];
      query: string;
      count: number;
    }> => {
      // Perform semantic search (repositoryId is optional - will use in-memory fallback if not provided)
      // Provide required dependencies for the Effect
      const layer = Layer.merge(
        ConfigService.Default,
        SecretStorageService.Default,
      );
      const results = await Runtime.runPromise(runtime)(
        indexingService
          .semanticSearch(query, limit)
          .pipe(Effect.provide(layer)),
      );

      return {
        results,
        query,
        count: results.length,
      };
    },
  });
};
