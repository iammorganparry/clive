import { tool } from "ai";
import { z } from "zod";
import { Effect, Runtime, Layer } from "effect";
import type { TokenBudgetService } from "../token-budget.js";
import { CodebaseIndexingService } from "../../codebase-indexing-service.js";
import { VSCodeService } from "../../vs-code.js";
import { ConfigService } from "../../config-service.js";
import { ApiKeyService } from "../../api-key-service.js";
import { SecretStorageService } from "../../vs-code.js";
import { RepositoryService } from "../../repository-service.js";
import { countTokensInText } from "../../../utils/token-utils.js";

export interface SemanticSearchInput {
  query: string;
  limit?: number;
  fileType?: string;
}

export interface SemanticSearchOutput {
  results: Array<{
    filePath: string;
    relativePath: string;
    content: string;
    similarity: number;
    fileType: string;
  }>;
  query: string;
  totalResults: number;
}

/**
 * Factory function to create semanticSearchTool with token budget awareness
 * Uses CodebaseIndexingService for semantic search across indexed files
 */
export const createSemanticSearchTool = (budget: TokenBudgetService) =>
  tool({
    description:
      "Search the codebase semantically to find files, components, routes, or tests related to a query. This uses embeddings to find semantically similar code, not just text matches. Use this to: find which page/route contains a component, find existing tests for related functionality, find related components or utilities, understand how a feature fits into the application.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "The semantic search query. Examples: 'login page component', 'dashboard route configuration', 'user authentication tests', 'API call to fetch user data'",
        ),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum number of results to return (default: 10)"),
      fileType: z
        .string()
        .optional()
        .describe(
          "Optional file type filter (e.g., 'tsx', 'ts', 'cy.ts'). If not provided, searches all file types.",
        ),
    }),
    execute: async ({
      query,
      limit = 10,
      fileType,
    }: SemanticSearchInput): Promise<SemanticSearchOutput> => {
      return Runtime.runPromise(Runtime.defaultRuntime)(
        Effect.gen(function* () {
          const indexingService = yield* CodebaseIndexingService;

          // Perform semantic search
          const results = yield* indexingService.semanticSearch(query, limit);

          // Filter by file type if specified
          const filteredResults = fileType
            ? results.filter((r) => r.fileType === fileType)
            : results;

          // Format results for token counting
          const resultsText = JSON.stringify(
            { results: filteredResults, query },
            null,
            2,
          );

          // Apply budget-aware truncation (MEDIUM priority - search results)
          const { content: truncated, wasTruncated } =
            yield* budget.truncateToFit(resultsText, "medium");

          // Consume tokens for the truncated content
          const tokens = countTokensInText(truncated);
          yield* budget.consume(tokens);

          // Parse back to output format if truncated
          let finalOutput: SemanticSearchOutput;
          if (wasTruncated) {
            try {
              const parsed = JSON.parse(truncated) as SemanticSearchOutput;
              finalOutput = {
                ...parsed,
                results: parsed.results.slice(0, limit),
              };
            } catch {
              // If parsing fails, return empty results
              finalOutput = {
                results: [],
                query,
                totalResults: 0,
              };
            }
          } else {
            finalOutput = {
              results: filteredResults.slice(0, limit),
              query,
              totalResults: filteredResults.length,
            };
          }

          return finalOutput;
        }).pipe(
          Effect.provide(
            Layer.merge(
              Layer.merge(
                CodebaseIndexingService.Default,
                Layer.merge(
                  VSCodeService.Default,
                  Layer.merge(ConfigService.Default, ApiKeyService.Default),
                ),
              ),
              Layer.merge(
                RepositoryService.Default,
                SecretStorageService.Default,
              ),
            ),
          ),
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              yield* Effect.logDebug(
                `[SemanticSearchTool] Error: ${error instanceof Error ? error.message : String(error)}`,
              );
              return {
                results: [],
                query,
                totalResults: 0,
              } as SemanticSearchOutput;
            }),
          ),
        ),
      );
    },
  });
