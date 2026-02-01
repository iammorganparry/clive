/**
 * @clive/memory - Storage Service
 *
 * Effect-TS service for SQLite database operations.
 * Handles schema initialization, CRUD for chunks/files, and embedding cache.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { Data, Effect } from "effect";
import { MemoryPaths, SqliteSchema } from "../constants.js";
import type {
  EmbeddingCacheEntry,
  FileMetadata,
  MemoryChunk,
  MemorySource,
} from "../types.js";

/**
 * Error when database operation fails
 */
export class StorageError extends Data.TaggedError("StorageError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * Internal row type for chunks table
 */
interface ChunkRow {
  id: string;
  file_path: string;
  source: string;
  chunk_index: number;
  start_line: number;
  end_line: number;
  content: string;
  content_hash: string;
  embedding: Buffer | null;
  model: string | null;
  created_at: number;
  rowid?: number;
}

/**
 * Internal row type for files table
 */
interface FileRow {
  path: string;
  source: string;
  hash: string;
  modified_at: number;
  size: number;
}

/**
 * Internal row type for embedding cache
 */
interface EmbeddingCacheRow {
  content_hash: string;
  embedding: Buffer;
  dimension: number;
  provider: string;
  model: string;
  updated_at: number;
}

/**
 * Convert a Buffer to Float32Array for embeddings
 */
function bufferToFloat32Array(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
}

/**
 * Convert a Float32Array to Buffer for storage
 */
function float32ArrayToBuffer(array: Float32Array): Buffer {
  return Buffer.from(array.buffer);
}

/**
 * Storage Service implementation
 */
export class StorageService extends Effect.Service<StorageService>()(
  "StorageService",
  {
    effect: Effect.gen(function* () {
      let db: Database.Database | null = null;
      let dbPath: string | null = null;

      /**
       * Initialize the database connection and schema
       */
      const initialize = (workspaceRoot: string) =>
        Effect.gen(function* () {
          const indexDir = path.join(workspaceRoot, MemoryPaths.index);
          dbPath = path.join(indexDir, MemoryPaths.dbFile);

          // Ensure index directory exists
          yield* Effect.try({
            try: () => fs.mkdirSync(indexDir, { recursive: true }),
            catch: (error) =>
              new StorageError({
                message: `Failed to create index directory: ${indexDir}`,
                cause: error,
              }),
          });

          // Open database with WAL mode for concurrent access
          yield* Effect.try({
            try: () => {
              db = new Database(dbPath as string);
              db.pragma("journal_mode = WAL");
              db.pragma("foreign_keys = ON");
              db.exec(SqliteSchema);
            },
            catch: (error) =>
              new StorageError({
                message: `Failed to initialize database: ${dbPath}`,
                cause: error,
              }),
          });

          yield* Effect.logDebug(`[StorageService] Database initialized at ${dbPath}`);
        });

      /**
       * Close the database connection
       */
      const close = () =>
        Effect.gen(function* () {
          if (db) {
            yield* Effect.try({
              try: () => {
                db?.close();
                db = null;
              },
              catch: (error) =>
                new StorageError({
                  message: "Failed to close database",
                  cause: error,
                }),
            });
          }
        });

      /**
       * Get a file's metadata
       */
      const getFile = (filePath: string) =>
        Effect.gen(function* () {
          if (!db) {
            return yield* Effect.fail(
              new StorageError({ message: "Database not initialized" }),
            );
          }

          const row = yield* Effect.try({
            try: () =>
              db
                ?.prepare("SELECT * FROM files WHERE path = ?")
                .get(filePath) as FileRow | undefined,
            catch: (error) =>
              new StorageError({
                message: `Failed to get file: ${filePath}`,
                cause: error,
              }),
          });

          if (!row) {
            return null;
          }

          return {
            path: row.path,
            source: row.source as MemorySource,
            hash: row.hash,
            modifiedAt: new Date(row.modified_at),
            size: row.size,
          } as FileMetadata;
        });

      /**
       * Upsert a file's metadata
       */
      const upsertFile = (file: FileMetadata) =>
        Effect.gen(function* () {
          if (!db) {
            return yield* Effect.fail(
              new StorageError({ message: "Database not initialized" }),
            );
          }

          yield* Effect.try({
            try: () =>
              db
                ?.prepare(
                  `INSERT INTO files (path, source, hash, modified_at, size)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(path) DO UPDATE SET
                     source = excluded.source,
                     hash = excluded.hash,
                     modified_at = excluded.modified_at,
                     size = excluded.size`,
                )
                .run(
                  file.path,
                  file.source,
                  file.hash,
                  file.modifiedAt.getTime(),
                  file.size,
                ),
            catch: (error) =>
              new StorageError({
                message: `Failed to upsert file: ${file.path}`,
                cause: error,
              }),
          });
        });

      /**
       * Delete a file and its chunks
       */
      const deleteFile = (filePath: string) =>
        Effect.gen(function* () {
          if (!db) {
            return yield* Effect.fail(
              new StorageError({ message: "Database not initialized" }),
            );
          }

          yield* Effect.try({
            try: () => {
              // Chunks are deleted via CASCADE
              db?.prepare("DELETE FROM files WHERE path = ?").run(filePath);
            },
            catch: (error) =>
              new StorageError({
                message: `Failed to delete file: ${filePath}`,
                cause: error,
              }),
          });
        });

      /**
       * Insert or update chunks for a file
       */
      const upsertChunks = (chunks: MemoryChunk[]) =>
        Effect.gen(function* () {
          if (!db) {
            return yield* Effect.fail(
              new StorageError({ message: "Database not initialized" }),
            );
          }

          yield* Effect.try({
            try: () => {
              const stmt = db?.prepare(
                `INSERT INTO chunks (id, file_path, source, chunk_index, start_line, end_line, content, content_hash, embedding, model, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(file_path, chunk_index) DO UPDATE SET
                   id = excluded.id,
                   source = excluded.source,
                   start_line = excluded.start_line,
                   end_line = excluded.end_line,
                   content = excluded.content,
                   content_hash = excluded.content_hash,
                   embedding = excluded.embedding,
                   model = excluded.model,
                   created_at = excluded.created_at`,
              );

              const transaction = db?.transaction(() => {
                for (const chunk of chunks) {
                  const embeddingBuffer = chunk.embedding
                    ? float32ArrayToBuffer(chunk.embedding)
                    : null;

                  stmt?.run(
                    chunk.id,
                    chunk.filePath,
                    chunk.source,
                    chunk.chunkIndex,
                    chunk.startLine,
                    chunk.endLine,
                    chunk.content,
                    chunk.contentHash,
                    embeddingBuffer,
                    chunk.model,
                    chunk.createdAt.getTime(),
                  );
                }
              });

              transaction?.();
            },
            catch: (error) =>
              new StorageError({
                message: "Failed to upsert chunks",
                cause: error,
              }),
          });
        });

      /**
       * Get chunks for a file
       */
      const getChunksForFile = (filePath: string) =>
        Effect.gen(function* () {
          if (!db) {
            return yield* Effect.fail(
              new StorageError({ message: "Database not initialized" }),
            );
          }

          const rows = yield* Effect.try({
            try: () =>
              db
                ?.prepare(
                  "SELECT * FROM chunks WHERE file_path = ? ORDER BY chunk_index",
                )
                .all(filePath) as ChunkRow[],
            catch: (error) =>
              new StorageError({
                message: `Failed to get chunks for file: ${filePath}`,
                cause: error,
              }),
          });

          return (rows || []).map((row) => ({
            id: row.id,
            filePath: row.file_path,
            source: row.source as MemorySource,
            chunkIndex: row.chunk_index,
            startLine: row.start_line,
            endLine: row.end_line,
            content: row.content,
            contentHash: row.content_hash,
            embedding: row.embedding
              ? bufferToFloat32Array(row.embedding)
              : null,
            model: row.model,
            createdAt: new Date(row.created_at),
          })) as MemoryChunk[];
        });

      /**
       * Delete chunks for a file that are beyond a certain index
       */
      const deleteChunksAfterIndex = (filePath: string, afterIndex: number) =>
        Effect.gen(function* () {
          if (!db) {
            return yield* Effect.fail(
              new StorageError({ message: "Database not initialized" }),
            );
          }

          yield* Effect.try({
            try: () =>
              db
                ?.prepare(
                  "DELETE FROM chunks WHERE file_path = ? AND chunk_index > ?",
                )
                .run(filePath, afterIndex),
            catch: (error) =>
              new StorageError({
                message: `Failed to delete chunks after index ${afterIndex} for file: ${filePath}`,
                cause: error,
              }),
          });
        });

      /**
       * Get all chunks with embeddings for vector search
       */
      const getAllChunksWithEmbeddings = () =>
        Effect.gen(function* () {
          if (!db) {
            return yield* Effect.fail(
              new StorageError({ message: "Database not initialized" }),
            );
          }

          const rows = yield* Effect.try({
            try: () =>
              db
                ?.prepare("SELECT * FROM chunks WHERE embedding IS NOT NULL")
                .all() as ChunkRow[],
            catch: (error) =>
              new StorageError({
                message: "Failed to get chunks with embeddings",
                cause: error,
              }),
          });

          return (rows || []).map((row) => ({
            id: row.id,
            filePath: row.file_path,
            source: row.source as MemorySource,
            chunkIndex: row.chunk_index,
            startLine: row.start_line,
            endLine: row.end_line,
            content: row.content,
            contentHash: row.content_hash,
            embedding: row.embedding
              ? bufferToFloat32Array(row.embedding)
              : null,
            model: row.model,
            createdAt: new Date(row.created_at),
          })) as MemoryChunk[];
        });

      /**
       * Search using FTS5 (BM25)
       */
      const searchBM25 = (query: string, limit: number) =>
        Effect.gen(function* () {
          if (!db) {
            return yield* Effect.fail(
              new StorageError({ message: "Database not initialized" }),
            );
          }

          const rows = yield* Effect.try({
            try: () =>
              db
                ?.prepare(
                  `SELECT c.*, bm25(chunks_fts) as score
                   FROM chunks c
                   JOIN chunks_fts ON c.rowid = chunks_fts.rowid
                   WHERE chunks_fts MATCH ?
                   ORDER BY score
                   LIMIT ?`,
                )
                .all(query, limit) as (ChunkRow & { score: number })[],
            catch: (error) =>
              new StorageError({
                message: `Failed to search BM25: ${query}`,
                cause: error,
              }),
          });

          return (rows || []).map((row) => ({
            chunk: {
              id: row.id,
              filePath: row.file_path,
              source: row.source as MemorySource,
              chunkIndex: row.chunk_index,
              startLine: row.start_line,
              endLine: row.end_line,
              content: row.content,
              contentHash: row.content_hash,
              embedding: row.embedding
                ? bufferToFloat32Array(row.embedding)
                : null,
              model: row.model,
              createdAt: new Date(row.created_at),
            } as MemoryChunk,
            // BM25 scores are negative (more negative = better match)
            // Normalize to 0-1 range where higher is better
            score: Math.min(1, Math.max(0, 1 + row.score / 10)),
          }));
        });

      /**
       * Get cached embedding
       */
      const getCachedEmbedding = (contentHash: string) =>
        Effect.gen(function* () {
          if (!db) {
            return yield* Effect.fail(
              new StorageError({ message: "Database not initialized" }),
            );
          }

          const row = yield* Effect.try({
            try: () =>
              db
                ?.prepare("SELECT * FROM embedding_cache WHERE content_hash = ?")
                .get(contentHash) as EmbeddingCacheRow | undefined,
            catch: (error) =>
              new StorageError({
                message: `Failed to get cached embedding: ${contentHash}`,
                cause: error,
              }),
          });

          if (!row) {
            return null;
          }

          return {
            contentHash: row.content_hash,
            embedding: bufferToFloat32Array(row.embedding),
            dimension: row.dimension,
            provider: row.provider,
            model: row.model,
            updatedAt: new Date(row.updated_at),
          } as EmbeddingCacheEntry;
        });

      /**
       * Cache an embedding
       */
      const cacheEmbedding = (entry: EmbeddingCacheEntry) =>
        Effect.gen(function* () {
          if (!db) {
            return yield* Effect.fail(
              new StorageError({ message: "Database not initialized" }),
            );
          }

          yield* Effect.try({
            try: () =>
              db
                ?.prepare(
                  `INSERT INTO embedding_cache (content_hash, embedding, dimension, provider, model, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(content_hash) DO UPDATE SET
                     embedding = excluded.embedding,
                     dimension = excluded.dimension,
                     provider = excluded.provider,
                     model = excluded.model,
                     updated_at = excluded.updated_at`,
                )
                .run(
                  entry.contentHash,
                  float32ArrayToBuffer(entry.embedding),
                  entry.dimension,
                  entry.provider,
                  entry.model,
                  entry.updatedAt.getTime(),
                ),
            catch: (error) =>
              new StorageError({
                message: `Failed to cache embedding: ${entry.contentHash}`,
                cause: error,
              }),
          });
        });

      /**
       * Get all indexed file paths
       */
      const getAllFilePaths = () =>
        Effect.gen(function* () {
          if (!db) {
            return yield* Effect.fail(
              new StorageError({ message: "Database not initialized" }),
            );
          }

          const rows = yield* Effect.try({
            try: () =>
              db?.prepare("SELECT path FROM files").all() as { path: string }[],
            catch: (error) =>
              new StorageError({
                message: "Failed to get all file paths",
                cause: error,
              }),
          });

          return (rows || []).map((row) => row.path);
        });

      return {
        initialize,
        close,
        getFile,
        upsertFile,
        deleteFile,
        upsertChunks,
        getChunksForFile,
        deleteChunksAfterIndex,
        getAllChunksWithEmbeddings,
        searchBM25,
        getCachedEmbedding,
        cacheEmbedding,
        getAllFilePaths,
      };
    }),
  },
) {}

/**
 * Live layer for StorageService
 */
export const StorageServiceLive = StorageService.Default;
