import { tool } from "ai";
import { z } from "zod";
import { Effect, Runtime } from "effect";
import { KnowledgeFileService } from "../../knowledge-file-service.js";

/**
 * Critical categories that should return full content instead of truncated
 */
const CRITICAL_CATEGORIES = [
  "test-execution",
  "test-patterns",
  "infrastructure",
] as const;

/**
 * Callback function called when knowledge is retrieved
 * Used to store knowledge in persistent context
 */
export type OnKnowledgeRetrieved = (
  results: Array<{
    category: string;
    title: string;
    content: string;
    path: string;
  }>,
) => void;

/**
 * Create a search tool for the knowledge base
 * Searches knowledge articles by text matching (category, title, content)
 */
export const createSearchKnowledgeTool = (
  knowledgeFileService: KnowledgeFileService,
  onKnowledgeRetrieved?: OnKnowledgeRetrieved,
) => {
  const runtime = Runtime.defaultRuntime;

  return tool({
    description:
      "Search the knowledge base for relevant information about this codebase using semantic similarity. Use this to find articles about architecture, user journeys, components, integrations, testing patterns, or any other documented knowledge.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "What you want to find (e.g., 'authentication flow', 'API endpoints', 'component patterns', 'error handling')",
        ),
      limit: z
        .number()
        .optional()
        .default(5)
        .describe("Maximum number of results to return (default: 5)"),
    }),
    execute: async ({
      query,
      limit = 5,
    }: {
      query: string;
      limit?: number;
    }): Promise<{
      results: Array<{
        category: string;
        title: string;
        content: string;
        path: string;
        similarity: number;
      }>;
      query: string;
      count: number;
    }> => {
      try {
        // List all knowledge files
        const files = await Runtime.runPromise(runtime)(
          knowledgeFileService
            .listKnowledgeFiles()
            .pipe(Effect.provide(KnowledgeFileService.Default)),
        );

        if (files.length === 0) {
          return {
            results: [],
            query,
            count: 0,
          };
        }

        // Read all knowledge files
        const articles = await Runtime.runPromise(runtime)(
          Effect.all(
            files.map((file) =>
              knowledgeFileService
                .readKnowledgeFile(file.relativePath)
                .pipe(Effect.provide(KnowledgeFileService.Default)),
            ),
            { concurrency: 10 },
          ),
        );

        // Text-based search: match query terms against category, title, and content
        const queryLower = query.toLowerCase();
        const scoredItems = articles
          .map((article) => {
            const searchableText =
              `${article.metadata.category} ${article.metadata.title} ${article.content}`.toLowerCase();
            const queryTerms = queryLower.split(/\s+/);
            let score = 0;

            // Simple scoring: count matches
            for (const term of queryTerms) {
              if (searchableText.includes(term)) {
                score += 1;
              }
            }

            // Boost score if category or title matches
            if (article.metadata.category.toLowerCase().includes(queryLower)) {
              score += 2;
            }
            if (article.metadata.title.toLowerCase().includes(queryLower)) {
              score += 2;
            }

            return {
              article,
              score,
            };
          })
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        // Call callback to store knowledge in persistent context BEFORE truncating
        if (onKnowledgeRetrieved && scoredItems.length > 0) {
          // Pass full content (not truncated) to callback - always use full article content
          const fullResults = scoredItems.map((item) => ({
            category: item.article.metadata.category,
            title: item.article.metadata.title,
            content: item.article.content, // Always use full content for persistent storage
            path: item.article.relativePath,
          }));
          onKnowledgeRetrieved(fullResults);
        }

        // Map to final result format with truncation for response
        const scoredArticles = scoredItems.map((item) => {
          const category = item.article.metadata.category;
          const isCritical = CRITICAL_CATEGORIES.includes(
            category as (typeof CRITICAL_CATEGORIES)[number],
          );

          return {
            category,
            title: item.article.metadata.title,
            // Return full content for critical categories, truncated for others
            content: isCritical
              ? item.article.content
              : item.article.content.substring(0, 500),
            path: item.article.relativePath,
            similarity: item.score / (queryLower.split(/\s+/).length + 4), // Normalize to 0-1
          };
        });

        return {
          results: scoredArticles,
          query,
          count: scoredArticles.length,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        console.error(`[SearchKnowledge] Error: ${errorMessage}`);
        return {
          results: [],
          query,
          count: 0,
        };
      }
    },
  });
};
