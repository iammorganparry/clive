/**
 * @clive/memory - Memory Service
 *
 * Main facade for the memory system. Coordinates storage, indexing, and search.
 * This is the primary interface for interacting with the memory system.
 */

import * as path from "node:path";
import { Data, Effect, Layer } from "effect";
import { MemoryPaths } from "../constants.js";
import type {
  ExtractedSessionInfo,
  MemoryEntry,
  MemoryGetOptions,
  MemoryGetResult,
  MemorySearchOptions,
} from "../types.js";
import {
  appendFile,
  ensureDir,
  fileExists,
  formatDailyLogHeader,
  formatMemoryEntry,
  getDailyLogPath,
  getMemoryFilePath,
  readFileLines,
  writeFile,
} from "../utils/file-utils.js";
import { ChunkerService, ChunkerServiceLive } from "./chunker-service.js";
import { EmbeddingService, type EmbeddingConfig } from "./embedding-service.js";
import { IndexerService, type IndexerConfig } from "./indexer-service.js";
import { SearchService } from "./search-service.js";
import { StorageService, StorageServiceLive } from "./storage-service.js";

/**
 * Error when memory operation fails
 */
export class MemoryError extends Data.TaggedError("MemoryError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * Configuration for the memory service
 */
export interface MemoryConfig {
  /** Workspace root directory */
  workspaceRoot: string;
  /** Embedding configuration */
  embedding: EmbeddingConfig;
  /** Indexer configuration */
  indexer?: IndexerConfig;
  /** Whether to start the file watcher automatically */
  autoWatch?: boolean;
}

/**
 * Memory Service implementation
 */
export class MemoryService extends Effect.Service<MemoryService>()(
  "MemoryService",
  {
    effect: Effect.gen(function* () {
      const storage = yield* StorageService;
      const chunker = yield* ChunkerService;
      const embedding = yield* EmbeddingService;
      const indexer = yield* IndexerService;
      const search = yield* SearchService;

      let workspaceRoot: string | null = null;
      let isInitialized = false;

      /**
       * Initialize the memory system
       */
      const initialize = (config: MemoryConfig) =>
        Effect.gen(function* () {
          workspaceRoot = config.workspaceRoot;

          yield* Effect.logDebug(
            `[MemoryService] Initializing memory system at: ${workspaceRoot}`,
          );

          // Ensure memory directories exist
          yield* ensureDir(path.join(workspaceRoot, MemoryPaths.daily));
          yield* ensureDir(path.join(workspaceRoot, MemoryPaths.longTerm));
          yield* ensureDir(path.join(workspaceRoot, MemoryPaths.index));

          // Initialize storage
          yield* storage.initialize(workspaceRoot);

          // Initialize embedding service
          yield* embedding.initialize(config.embedding);

          // Initialize indexer if auto-watch is enabled
          if (config.autoWatch !== false) {
            yield* indexer.initialize(workspaceRoot, config.indexer);
          }

          isInitialized = true;

          yield* Effect.logDebug("[MemoryService] Memory system initialized");
        });

      /**
       * Shutdown the memory system
       */
      const shutdown = () =>
        Effect.gen(function* () {
          yield* Effect.logDebug("[MemoryService] Shutting down memory system");

          yield* indexer.stop();
          yield* storage.close();

          isInitialized = false;
        });

      /**
       * Search memory using hybrid search
       */
      const searchMemory = (query: string, options?: MemorySearchOptions) =>
        Effect.gen(function* () {
          if (!isInitialized) {
            return yield* Effect.fail(
              new MemoryError({ message: "Memory system not initialized" }),
            );
          }

          return yield* search.hybridSearch(query, options);
        });

      /**
       * Read lines from a memory file
       */
      const getMemoryFile = (options: MemoryGetOptions) =>
        Effect.gen(function* () {
          if (!workspaceRoot) {
            return yield* Effect.fail(
              new MemoryError({ message: "Workspace root not set" }),
            );
          }

          const absolutePath = getMemoryFilePath(workspaceRoot, options.path);

          const exists = yield* fileExists(absolutePath);
          if (!exists) {
            return yield* Effect.fail(
              new MemoryError({ message: `File not found: ${options.path}` }),
            );
          }

          const result = yield* readFileLines(
            absolutePath,
            options.from ?? 1,
            options.lines,
          );

          return result as MemoryGetResult;
        });

      /**
       * Save an entry to today's daily log
       */
      const saveToDaily = (entry: MemoryEntry) =>
        Effect.gen(function* () {
          if (!workspaceRoot) {
            return yield* Effect.fail(
              new MemoryError({ message: "Workspace root not set" }),
            );
          }

          const dailyLogPath = getDailyLogPath(workspaceRoot);

          // Check if file exists, create with header if not
          const exists = yield* fileExists(dailyLogPath);
          if (!exists) {
            yield* writeFile(dailyLogPath, formatDailyLogHeader());
          }

          // Format and append the entry
          const formattedEntry = formatMemoryEntry(entry);
          yield* appendFile(dailyLogPath, formattedEntry);

          yield* Effect.logDebug(
            `[MemoryService] Saved ${entry.category} entry to daily log`,
          );
        });

      /**
       * Save extracted session information to daily log
       */
      const saveSessionInfo = (info: ExtractedSessionInfo) =>
        Effect.gen(function* () {
          // Build content from extracted info
          const sections: string[] = [];

          sections.push(`**Session:** ${info.sessionId}`);
          sections.push(`**Mode:** ${info.mode}`);

          if (info.linearIssue) {
            sections.push(`**Linear Issue:** ${info.linearIssue}`);
          }

          if (info.outcome) {
            sections.push(`**Outcome:** ${info.outcome}`);
          }

          if (info.decisions?.length) {
            sections.push("\n**Decisions:**");
            for (const decision of info.decisions) {
              sections.push(`- ${decision}`);
            }
          }

          if (info.patterns?.length) {
            sections.push("\n**Patterns:**");
            for (const pattern of info.patterns) {
              sections.push(`- ${pattern}`);
            }
          }

          if (info.gotchas?.length) {
            sections.push("\n**Gotchas:**");
            for (const gotcha of info.gotchas) {
              sections.push(`- ${gotcha}`);
            }
          }

          if (info.notes?.length) {
            sections.push("\n**Notes:**");
            for (const note of info.notes) {
              sections.push(`- ${note}`);
            }
          }

          const content = sections.join("\n");

          yield* saveToDaily({
            category: "note",
            content,
            tags: [info.mode, info.outcome ?? "unknown"].filter(Boolean),
          });
        });

      /**
       * Get recent decisions from daily logs
       */
      const getRecentDecisions = (daysBack: number) =>
        Effect.gen(function* () {
          // Search for decision entries in recent daily logs
          const results = yield* searchMemory("decision", {
            maxResults: 10,
            source: "sessions",
          });

          return results;
        });

      /**
       * Trigger a reindex of all memory files
       */
      const reindex = () =>
        Effect.gen(function* () {
          if (!isInitialized) {
            return yield* Effect.fail(
              new MemoryError({ message: "Memory system not initialized" }),
            );
          }

          yield* indexer.reindexAll();
        });

      /**
       * Get the count of tokens in text
       */
      const countTokens = (text: string) => chunker.getTokenCount(text);

      /**
       * Check if the memory system is initialized
       */
      const isReady = () => Effect.sync(() => isInitialized);

      return {
        initialize,
        shutdown,
        searchMemory,
        getMemoryFile,
        saveToDaily,
        saveSessionInfo,
        getRecentDecisions,
        reindex,
        countTokens,
        isReady,
      };
    }),
    dependencies: [
      StorageService.Default,
      ChunkerService.Default,
      EmbeddingService.Default,
      IndexerService.Default,
      SearchService.Default,
    ],
  },
) {}

/**
 * Live layer for MemoryService
 */
export const MemoryServiceLive = MemoryService.Default;

/**
 * Create a complete memory layer with all dependencies
 */
export const createMemoryLayer = () =>
  Layer.mergeAll(
    StorageServiceLive,
    ChunkerServiceLive,
  ).pipe(
    Layer.provideMerge(MemoryServiceLive),
  );
