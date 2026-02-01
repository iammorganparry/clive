/**
 * @clive/memory - Indexer Service
 *
 * Effect-TS service for watching and indexing memory files.
 * Uses chokidar for file watching with debouncing.
 */

import * as path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { Data, Effect } from "effect";
import { FilePatterns, IndexingDefaults, MemoryPaths } from "../constants.js";
import {
  getFileStats,
  getRelativePath,
  getSourceFromPath,
  hashContent,
  readFile,
} from "../utils/file-utils.js";
import { ChunkerService } from "./chunker-service.js";
import { EmbeddingService } from "./embedding-service.js";
import { StorageService } from "./storage-service.js";

/**
 * Error when indexing operation fails
 */
export class IndexerError extends Data.TaggedError("IndexerError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * Configuration for the indexer
 */
export interface IndexerConfig {
  /** Debounce time for file changes in milliseconds */
  debounceMs?: number;
  /** Maximum concurrent indexing operations */
  maxConcurrent?: number;
}

/**
 * Indexer Service implementation
 */
export class IndexerService extends Effect.Service<IndexerService>()(
  "IndexerService",
  {
    effect: Effect.gen(function* () {
      const storage = yield* StorageService;
      const chunker = yield* ChunkerService;
      const embedding = yield* EmbeddingService;

      let watcher: FSWatcher | null = null;
      let workspaceRoot: string | null = null;
      let debounceMs: number = IndexingDefaults.debounceMs;
      let isRunning = false;

      // Pending file changes to process
      const pendingChanges = new Map<string, NodeJS.Timeout>();

      /**
       * Process a file change
       */
      const processFile = (absolutePath: string) =>
        Effect.gen(function* () {
          if (!workspaceRoot) {
            return yield* Effect.fail(
              new IndexerError({ message: "Workspace root not set" }),
            );
          }

          const relativePath = getRelativePath(workspaceRoot, absolutePath);
          const source = getSourceFromPath(relativePath);

          yield* Effect.logDebug(`[IndexerService] Processing file: ${relativePath}`);

          // Read file content and stats
          const content = yield* readFile(absolutePath).pipe(
            Effect.catchAll(() => Effect.succeed("")),
          );

          if (!content) {
            // File was deleted or empty - remove from index
            yield* storage.deleteFile(relativePath);
            yield* Effect.logDebug(`[IndexerService] Removed file from index: ${relativePath}`);
            return;
          }

          const stats = yield* getFileStats(absolutePath).pipe(
            Effect.catchAll(() => Effect.succeed(null)),
          );

          if (!stats) {
            return;
          }

          // Check if file has changed
          const contentHash = hashContent(content);
          const existingFile = yield* storage.getFile(relativePath);

          if (existingFile && existingFile.hash === contentHash) {
            yield* Effect.logDebug(
              `[IndexerService] File unchanged, skipping: ${relativePath}`,
            );
            return;
          }

          // Update file metadata
          yield* storage.upsertFile({
            path: relativePath,
            source,
            hash: contentHash,
            modifiedAt: stats.mtime,
            size: stats.size,
          });

          // Chunk the file
          const chunks = yield* chunker.chunkFile(relativePath, content, source);

          // Generate embeddings for chunks
          const chunksWithEmbeddings = yield* embedding.embedChunks(chunks);

          // Store chunks
          yield* storage.upsertChunks(chunksWithEmbeddings);

          // Remove any old chunks beyond current count
          if (existingFile) {
            yield* storage.deleteChunksAfterIndex(relativePath, chunks.length - 1);
          }

          yield* Effect.logDebug(
            `[IndexerService] Indexed ${chunks.length} chunks for: ${relativePath}`,
          );
        });

      /**
       * Handle a file change with debouncing
       */
      const handleFileChange = (absolutePath: string) => {
        // Clear any pending timeout for this file
        const existing = pendingChanges.get(absolutePath);
        if (existing) {
          clearTimeout(existing);
        }

        // Set new timeout
        const timeout = setTimeout(() => {
          pendingChanges.delete(absolutePath);

          // Run the indexing in the background
          Effect.runPromise(
            processFile(absolutePath).pipe(
              Effect.catchAll((error) =>
                Effect.logError(
                  `[IndexerService] Failed to process file: ${absolutePath} - ${error}`,
                ),
              ),
            ),
          ).catch((err) => {
            console.error(`[IndexerService] Unhandled error processing ${absolutePath}:`, err);
          });
        }, debounceMs);

        pendingChanges.set(absolutePath, timeout);
      };

      /**
       * Initialize the file watcher
       */
      const initialize = (root: string, config?: IndexerConfig) =>
        Effect.gen(function* () {
          workspaceRoot = root;
          debounceMs = config?.debounceMs ?? IndexingDefaults.debounceMs;

          const memoryDir = path.join(root, MemoryPaths.base);

          yield* Effect.logDebug(`[IndexerService] Watching directory: ${memoryDir}`);

          // Create the watcher
          watcher = chokidar.watch(
            path.join(memoryDir, FilePatterns.memoryFiles),
            {
              persistent: true,
              ignoreInitial: false, // Process existing files
              awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100,
              },
              ignored: [
                /(^|[/\\])\../, // Ignore dotfiles
                /index\//, // Ignore index directory
              ],
            },
          );

          // Set up event handlers
          watcher.on("add", handleFileChange);
          watcher.on("change", handleFileChange);
          watcher.on("unlink", (absolutePath: string) => {
            if (!workspaceRoot) return;

            const relativePath = getRelativePath(workspaceRoot, absolutePath);
            Effect.runPromise(
              storage.deleteFile(relativePath).pipe(
                Effect.catchAll((error) =>
                  Effect.logError(
                    `[IndexerService] Failed to delete file from index: ${relativePath} - ${error}`,
                  ),
                ),
              ),
            ).catch((err) => {
              console.error(`[IndexerService] Unhandled error deleting ${relativePath}:`, err);
            });
          });

          watcher.on("error", (error: unknown) => {
            console.error("[IndexerService] Watcher error:", error);
          });

          isRunning = true;

          yield* Effect.logDebug("[IndexerService] File watcher initialized");
        });

      /**
       * Stop the file watcher
       */
      const stop = () =>
        Effect.gen(function* () {
          if (watcher) {
            yield* Effect.tryPromise({
              try: () => watcher!.close(),
              catch: (error) =>
                new IndexerError({
                  message: "Failed to close watcher",
                  cause: error,
                }),
            });
            watcher = null;
          }

          // Clear pending changes
          for (const timeout of pendingChanges.values()) {
            clearTimeout(timeout);
          }
          pendingChanges.clear();

          isRunning = false;

          yield* Effect.logDebug("[IndexerService] File watcher stopped");
        });

      /**
       * Reindex all files
       */
      const reindexAll = () =>
        Effect.gen(function* () {
          if (!workspaceRoot) {
            return yield* Effect.fail(
              new IndexerError({ message: "Workspace root not set" }),
            );
          }

          yield* Effect.logDebug("[IndexerService] Starting full reindex");

          // Get all indexed files
          const indexedPaths = yield* storage.getAllFilePaths();

          // Process each file
          for (const relativePath of indexedPaths) {
            const absolutePath = path.join(
              workspaceRoot,
              MemoryPaths.base,
              relativePath,
            );
            yield* processFile(absolutePath);
          }

          yield* Effect.logDebug(
            `[IndexerService] Reindexed ${indexedPaths.length} files`,
          );
        });

      /**
       * Index a specific file immediately (bypass debounce)
       */
      const indexFile = (absolutePath: string) => processFile(absolutePath);

      /**
       * Check if the indexer is running
       */
      const isActive = () => Effect.sync(() => isRunning);

      return {
        initialize,
        stop,
        reindexAll,
        indexFile,
        isActive,
      };
    }),
    dependencies: [StorageService.Default, ChunkerService.Default, EmbeddingService.Default],
  },
) {}

/**
 * Live layer for IndexerService
 */
export const IndexerServiceLive = IndexerService.Default;
