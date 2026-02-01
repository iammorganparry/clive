/**
 * @clive/memory - Search Service
 *
 * Effect-TS service for hybrid search combining vector similarity and BM25.
 */

import { Data, Effect } from "effect";
import { SearchDefaults, SnippetDefaults } from "../constants.js";
import type {
  MemoryChunk,
  MemorySearchOptions,
  MemorySearchResult,
  RawSearchResult,
} from "../types.js";
import { truncateToLength } from "../utils/file-utils.js";
import { EmbeddingService } from "./embedding-service.js";
import { StorageService } from "./storage-service.js";

/**
 * Error when search operation fails
 */
export class SearchError extends Data.TaggedError("SearchError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * Configuration for hybrid search
 */
export interface SearchConfig {
  /** Weight for vector similarity (default: 0.7) */
  vectorWeight?: number;
  /** Weight for BM25 (default: 0.3) */
  bm25Weight?: number;
}

/**
 * Escape special characters for FTS5 query
 */
function escapeFtsQuery(query: string): string {
  // FTS5 special characters that need escaping
  return query
    .replace(/"/g, '""')
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .map((term) => `"${term}"`)
    .join(" OR ");
}

/**
 * Merge results from vector and BM25 search
 */
function mergeResults(
  vectorResults: RawSearchResult[],
  bm25Results: RawSearchResult[],
  vectorWeight: number,
  bm25Weight: number,
): RawSearchResult[] {
  // Create a map of chunk ID to combined scores
  const scoreMap = new Map<
    string,
    { chunk: MemoryChunk; vectorScore: number; bm25Score: number }
  >();

  // Add vector results
  for (const result of vectorResults) {
    scoreMap.set(result.chunk.id, {
      chunk: result.chunk,
      vectorScore: result.score,
      bm25Score: 0,
    });
  }

  // Add or update with BM25 results
  for (const result of bm25Results) {
    const existing = scoreMap.get(result.chunk.id);
    if (existing) {
      existing.bm25Score = result.score;
    } else {
      scoreMap.set(result.chunk.id, {
        chunk: result.chunk,
        vectorScore: 0,
        bm25Score: result.score,
      });
    }
  }

  // Calculate combined scores and sort
  const combined: RawSearchResult[] = [];
  for (const { chunk, vectorScore, bm25Score } of scoreMap.values()) {
    const combinedScore = vectorScore * vectorWeight + bm25Score * bm25Weight;
    combined.push({
      chunk,
      score: combinedScore,
      searchType: vectorScore > bm25Score ? "vector" : "bm25",
    });
  }

  return combined.sort((a, b) => b.score - a.score);
}

/**
 * Convert raw search result to API result format
 */
function formatSearchResult(result: RawSearchResult): MemorySearchResult {
  return {
    path: result.chunk.filePath,
    startLine: result.chunk.startLine,
    endLine: result.chunk.endLine,
    snippet: truncateToLength(result.chunk.content, SnippetDefaults.maxLength),
    score: result.score,
    source: result.chunk.source,
  };
}

/**
 * Search Service implementation
 */
export class SearchService extends Effect.Service<SearchService>()(
  "SearchService",
  {
    effect: Effect.gen(function* () {
      const storage = yield* StorageService;
      const embeddingService = yield* EmbeddingService;

      /**
       * Perform hybrid search combining vector similarity and BM25
       */
      const hybridSearch = (query: string, options?: MemorySearchOptions) =>
        Effect.gen(function* () {
          const maxResults = options?.maxResults ?? SearchDefaults.maxResults;
          const minScore = options?.minScore ?? SearchDefaults.minScore;
          const vectorWeight = SearchDefaults.vectorWeight;
          const bm25Weight = SearchDefaults.bm25Weight;

          yield* Effect.logDebug(
            `[SearchService] Hybrid search for: "${query}" (limit: ${maxResults}, minScore: ${minScore})`,
          );

          // Generate query embedding for vector search
          const queryEmbedding = yield* embeddingService.embedText(query);

          // Perform vector search
          const vectorResults = yield* embeddingService.searchSimilar(
            queryEmbedding,
            maxResults * 2, // Get more results for merging
          );

          yield* Effect.logDebug(
            `[SearchService] Vector search returned ${vectorResults.length} results`,
          );

          // Perform BM25 search
          const escapedQuery = escapeFtsQuery(query);
          const bm25Results = yield* storage
            .searchBM25(escapedQuery, maxResults * 2)
            .pipe(
              Effect.catchAll((error) =>
                // BM25 search may fail if query has no valid terms
                Effect.logDebug(
                  `[SearchService] BM25 search failed: ${error}`,
                ).pipe(Effect.map(() => [])),
              ),
            );

          yield* Effect.logDebug(
            `[SearchService] BM25 search returned ${bm25Results.length} results`,
          );

          // Convert storage results to raw search results
          const bm25Raw: RawSearchResult[] = bm25Results.map((r) => ({
            chunk: r.chunk,
            score: r.score,
            searchType: "bm25" as const,
          }));

          const vectorRaw: RawSearchResult[] = vectorResults.map((r) => ({
            chunk: r.chunk,
            score: r.score,
            searchType: "vector" as const,
          }));

          // Merge results with weighted scoring
          const merged = mergeResults(
            vectorRaw,
            bm25Raw,
            vectorWeight,
            bm25Weight,
          );

          // Filter by minimum score and limit
          const filtered = merged
            .filter((r) => r.score >= minScore)
            .slice(0, maxResults);

          // Filter by source if specified
          const sourceFiltered = options?.source
            ? filtered.filter((r) => r.chunk.source === options.source)
            : filtered;

          yield* Effect.logDebug(
            `[SearchService] Returning ${sourceFiltered.length} results after filtering`,
          );

          // Format results
          return sourceFiltered.map(formatSearchResult);
        });

      /**
       * Perform vector-only search
       */
      const vectorSearch = (query: string, options?: MemorySearchOptions) =>
        Effect.gen(function* () {
          const maxResults = options?.maxResults ?? SearchDefaults.maxResults;
          const minScore = options?.minScore ?? SearchDefaults.minScore;

          // Generate query embedding
          const queryEmbedding = yield* embeddingService.embedText(query);

          // Perform vector search
          const results = yield* embeddingService.searchSimilar(
            queryEmbedding,
            maxResults * 2,
          );

          // Filter and format
          const filtered = results
            .filter((r) => r.score >= minScore)
            .slice(0, maxResults);

          const sourceFiltered = options?.source
            ? filtered.filter((r) => r.chunk.source === options.source)
            : filtered;

          return sourceFiltered.map((r) =>
            formatSearchResult({
              chunk: r.chunk,
              score: r.score,
              searchType: "vector",
            }),
          );
        });

      /**
       * Perform BM25-only search
       */
      const bm25Search = (query: string, options?: MemorySearchOptions) =>
        Effect.gen(function* () {
          const maxResults = options?.maxResults ?? SearchDefaults.maxResults;
          const minScore = options?.minScore ?? SearchDefaults.minScore;

          const escapedQuery = escapeFtsQuery(query);
          const results = yield* storage.searchBM25(escapedQuery, maxResults * 2);

          // Filter and format
          const filtered = results
            .filter((r) => r.score >= minScore)
            .slice(0, maxResults);

          const sourceFiltered = options?.source
            ? filtered.filter((r) => r.chunk.source === options.source)
            : filtered;

          return sourceFiltered.map((r) =>
            formatSearchResult({
              chunk: r.chunk,
              score: r.score,
              searchType: "bm25",
            }),
          );
        });

      return {
        hybridSearch,
        vectorSearch,
        bm25Search,
      };
    }),
    dependencies: [StorageService.Default, EmbeddingService.Default],
  },
) {}

/**
 * Live layer for SearchService
 */
export const SearchServiceLive = SearchService.Default;
