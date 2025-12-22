import { repositories, files } from "@clive/db/schema";
import { eq, sql, cosineDistance, desc, count } from "drizzle-orm";
import { Data, Effect } from "effect";
import { DrizzleDB, DrizzleDBLive } from "./drizzle-db.js";

class RepositoryError extends Data.TaggedError("RepositoryError")<{
  message: string;
  cause?: unknown;
}> {}

class RepositoryNotFoundError extends Data.TaggedError(
  "RepositoryNotFoundError",
)<{
  repositoryId: string;
}> {}

/**
 * Repository entity
 */
export interface Repository {
  id: string;
  userId: string;
  organizationId: string | null;
  name: string;
  rootPath: string;
  lastIndexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * File data for indexing
 */
export interface FileData {
  relativePath: string;
  content: string;
  embedding: number[];
  fileType: string;
  contentHash: string;
}

/**
 * Search result from semantic search
 */
export interface FileSearchResult {
  id: string;
  relativePath: string;
  content: string;
  fileType: string;
  similarity: number;
}

/**
 * Indexing status information
 */
export interface IndexingStatusInfo {
  status: "idle" | "in_progress" | "complete" | "error";
  repositoryName: string | null;
  repositoryPath: string | null;
  lastIndexedAt: Date | null;
  fileCount: number;
}

/**
 * Repository for managing codebase repositories and file embeddings
 */
export class RepositoryRepository extends Effect.Service<RepositoryRepository>()(
  "RepositoryRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDB;

      /**
       * Upsert a repository (create or update)
       */
      const upsert = (
        userId: string,
        name: string,
        rootPath: string,
        organizationId?: string | null,
      ) =>
        Effect.gen(function* () {
          const repositoryId = organizationId
            ? `${organizationId}-${rootPath}`
            : `${userId}-${rootPath}`;

          const result = yield* Effect.tryPromise({
            try: async () => {
              const [repo] = await db
                .insert(repositories)
                .values({
                  id: repositoryId,
                  userId,
                  organizationId: organizationId ?? null,
                  name,
                  rootPath,
                  lastIndexedAt: new Date(),
                })
                .onConflictDoUpdate({
                  target: repositories.id,
                  set: {
                    name,
                    rootPath,
                    organizationId: organizationId ?? null,
                    lastIndexedAt: new Date(),
                    updatedAt: new Date(),
                  },
                })
                .returning();

              if (!repo) {
                throw new Error("Failed to upsert repository");
              }

              return repo;
            },
            catch: (error) =>
              new RepositoryError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          return {
            id: result.id,
            userId: result.userId,
            organizationId: result.organizationId,
            name: result.name,
            rootPath: result.rootPath,
            lastIndexedAt: result.lastIndexedAt,
            createdAt: result.createdAt,
            updatedAt: result.updatedAt,
          } satisfies Repository;
        });

      /**
       * Get repository by root path
       */
      const get = (
        userId: string,
        rootPath: string,
        organizationId?: string | null,
      ) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              // If organization ID is provided, prioritize org-scoped lookup
              if (organizationId) {
                const [orgResult] = await db
                  .select()
                  .from(repositories)
                  .where(
                    sql`${repositories.organizationId} = ${organizationId} AND ${repositories.rootPath} = ${rootPath}`,
                  )
                  .limit(1);

                if (orgResult) return orgResult;
              }

              // Fall back to user-scoped lookup
              const [userResult] = await db
                .select()
                .from(repositories)
                .where(
                  sql`${repositories.userId} = ${userId} AND ${repositories.rootPath} = ${rootPath}`,
                )
                .limit(1);

              return userResult || null;
            },
            catch: (error) =>
              new RepositoryError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          if (!result) {
            return null;
          }

          return {
            id: result.id,
            userId: result.userId,
            organizationId: result.organizationId,
            name: result.name,
            rootPath: result.rootPath,
            lastIndexedAt: result.lastIndexedAt,
            createdAt: result.createdAt,
            updatedAt: result.updatedAt,
          } satisfies Repository;
        });

      /**
       * Get indexing status for a repository
       */
      const getStatus = (
        userId: string,
        rootPath: string,
        organizationId?: string | null,
      ) =>
        Effect.gen(function* () {
          // Get repository - call get directly instead of yielding the service
          const repository = yield* get(userId, rootPath, organizationId);

          if (!repository) {
            return {
              status: "idle" as const,
              repositoryName: null,
              repositoryPath: null,
              lastIndexedAt: null,
              fileCount: 0,
            } satisfies IndexingStatusInfo;
          }

          // Get file count
          const fileCountResult = yield* Effect.tryPromise({
            try: async () => {
              const result = await db
                .select({ count: count() })
                .from(files)
                .where(eq(files.repositoryId, repository.id));
              return result[0]?.count ?? 0;
            },
            catch: (error) =>
              new RepositoryError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          return {
            status: repository.lastIndexedAt
              ? ("complete" as const)
              : ("idle" as const),
            repositoryName: repository.name,
            repositoryPath: repository.rootPath,
            lastIndexedAt: repository.lastIndexedAt,
            fileCount: fileCountResult,
          } satisfies IndexingStatusInfo;
        });

      /**
       * Upsert a file with embedding
       */
      const upsertFile = (repositoryId: string, file: FileData) =>
        Effect.gen(function* () {
          const fileId = `${repositoryId}-${file.relativePath}`;

          yield* Effect.tryPromise({
            try: async () => {
              await db
                .insert(files)
                .values({
                  id: fileId,
                  repositoryId,
                  relativePath: file.relativePath,
                  content: file.content,
                  embedding: file.embedding,
                  fileType: file.fileType,
                  contentHash: file.contentHash,
                  updatedAt: new Date(),
                })
                .onConflictDoUpdate({
                  target: [files.repositoryId, files.relativePath],
                  set: {
                    content: file.content,
                    embedding: file.embedding,
                    contentHash: file.contentHash,
                    updatedAt: new Date(),
                  },
                });
            },
            catch: (error) =>
              new RepositoryError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });
        });

      /**
       * Delete a file
       */
      const deleteFile = (repositoryId: string, relativePath: string) =>
        Effect.gen(function* () {
          yield* Effect.tryPromise({
            try: async () => {
              await db
                .delete(files)
                .where(
                  sql`${files.repositoryId} = ${repositoryId} AND ${files.relativePath} = ${relativePath}`,
                );
            },
            catch: (error) =>
              new RepositoryError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });
        });

      /**
       * Get file by path
       */
      const getFileByPath = (repositoryId: string, relativePath: string) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [file] = await db
                .select()
                .from(files)
                .where(
                  sql`${files.repositoryId} = ${repositoryId} AND ${files.relativePath} = ${relativePath}`,
                )
                .limit(1);

              return file || null;
            },
            catch: (error) =>
              new RepositoryError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          return result;
        });

      /**
       * Get all file hashes for a repository (batch query for incremental sync)
       */
      const getFileHashes = (repositoryId: string) =>
        Effect.gen(function* () {
          const results = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .select({
                  relativePath: files.relativePath,
                  contentHash: files.contentHash,
                })
                .from(files)
                .where(eq(files.repositoryId, repositoryId));
            },
            catch: (error) =>
              new RepositoryError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          // Return as object for JSON serialization
          const hashMap: Record<string, string> = {};
          for (const f of results) {
            hashMap[f.relativePath] = f.contentHash;
          }

          return hashMap;
        });

      /**
       * Semantic search using cosine distance
       */
      const searchFiles = (
        repositoryId: string,
        queryEmbedding: number[],
        limit: number = 10,
      ) =>
        Effect.gen(function* () {
          const results = yield* Effect.tryPromise({
            try: async () => {
              // Calculate similarity: 1 - cosineDistance (higher is more similar)
              const similarity = sql<number>`1 - (${cosineDistance(
                files.embedding,
                queryEmbedding,
              )})`;

              const searchResults = await db
                .select({
                  id: files.id,
                  relativePath: files.relativePath,
                  content: files.content,
                  fileType: files.fileType,
                  similarity,
                })
                .from(files)
                .where(eq(files.repositoryId, repositoryId))
                .orderBy(desc(similarity))
                .limit(limit);

              return searchResults as FileSearchResult[];
            },
            catch: (error) =>
              new RepositoryError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          return results;
        });

      return {
        upsert,
        get,
        getStatus,
        upsertFile,
        deleteFile,
        getFileByPath,
        getFileHashes,
        searchFiles,
      };
    }),
    dependencies: [DrizzleDBLive],
  },
) {}

export const RepositoryRepositoryDefault = RepositoryRepository.Default;

export type { RepositoryError, RepositoryNotFoundError };
