/**
 * @clive/memory - memory_search MCP Tool
 *
 * Semantic search across memory files using hybrid vector + BM25 search.
 */

import { Effect } from "effect";
import type { MemorySearchOptions, MemorySearchResult, MemorySource } from "../types.js";
import { MemoryService } from "../services/memory-service.js";

/**
 * Input schema for memory_search tool
 */
export interface MemorySearchInput {
  /** What to search for */
  query: string;
  /** Maximum number of results (default: 6) */
  maxResults?: number;
  /** Minimum relevance score 0-1 (default: 0.35) */
  minScore?: number;
  /** Filter by source: 'memory' for long-term, 'sessions' for daily logs */
  source?: MemorySource;
}

/**
 * Tool definition for MCP
 */
export const memorySearchToolDefinition = {
  name: "memory_search",
  description:
    "Search across memory files using semantic search. Returns relevant snippets from daily logs and long-term memory. Use this at the start of tasks to find relevant context.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          "What to search for. Can be keywords, phrases, or natural language questions.",
      },
      maxResults: {
        type: "number",
        description: "Maximum number of results to return. Default: 6",
      },
      minScore: {
        type: "number",
        description:
          "Minimum relevance score (0-1). Higher values return only more relevant results. Default: 0.35",
      },
      source: {
        type: "string",
        enum: ["memory", "sessions"],
        description:
          "Filter by source: 'memory' for long-term curated knowledge, 'sessions' for daily logs. If not specified, searches both.",
      },
    },
    required: ["query"],
  },
};

/**
 * Format search results for display
 */
function formatSearchResults(
  results: MemorySearchResult[],
  query: string,
): string {
  if (results.length === 0) {
    return `No results found for: "${query}"`;
  }

  const header = `Found ${results.length} result${results.length === 1 ? "" : "s"} for: "${query}"\n`;
  const separator = "═".repeat(60);

  const formattedResults = results.map((result, index) => {
    const scorePercent = Math.round(result.score * 100);
    const lines = `lines ${result.startLine}-${result.endLine}`;
    const sourceLabel = result.source === "memory" ? "📚" : "📝";

    return `
${index + 1}. ${sourceLabel} ${result.path} (${lines}) [${scorePercent}% match]
${"─".repeat(50)}
${result.snippet}
`;
  });

  return `${header}${separator}\n${formattedResults.join("\n")}`;
}

/**
 * Execute the memory_search tool
 */
export const executeMemorySearch = (input: MemorySearchInput) =>
  Effect.gen(function* () {
    const memory = yield* MemoryService;

    const options: MemorySearchOptions = {
      maxResults: input.maxResults,
      minScore: input.minScore,
      source: input.source,
    };

    const results = yield* memory.searchMemory(input.query, options);

    return {
      results,
      formatted: formatSearchResults(results, input.query),
      metadata: {
        query: input.query,
        totalResults: results.length,
        options,
      },
    };
  });

/**
 * Handle memory_search tool call
 */
export const handleMemorySearch = (input: unknown) =>
  Effect.gen(function* () {
    // Validate input
    const validatedInput = input as MemorySearchInput;

    if (!validatedInput.query || typeof validatedInput.query !== "string") {
      return yield* Effect.fail(new Error("Invalid input: query is required"));
    }

    if (validatedInput.query.trim().length === 0) {
      return yield* Effect.fail(
        new Error("Invalid input: query cannot be empty"),
      );
    }

    // Validate source if provided
    if (
      validatedInput.source &&
      !["memory", "sessions"].includes(validatedInput.source)
    ) {
      return yield* Effect.fail(
        new Error(
          "Invalid input: source must be 'memory' or 'sessions'",
        ),
      );
    }

    const result = yield* executeMemorySearch(validatedInput);

    return {
      type: "text" as const,
      text: result.formatted,
    };
  });
