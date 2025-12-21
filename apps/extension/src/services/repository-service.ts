import { Data, Effect } from "effect";
import { eq, desc, sql, cosineDistance, count } from "drizzle-orm";
import { db } from "@clive/db/client";
import { repositories, files } from "@clive/db/schema";
import { ConfigService } from "./config-service.js";
import type { IndexingStatusInfo } from "./indexing-status.js";

class RepositoryError extends Data.TaggedError("RepositoryError")<{
  message: string;
  cause?: unknown;
}> {}

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
 * Service for managing codebase repositories and file embeddings
 * Uses Drizzle ORM with pgvector for semantic search
 */
export class RepositoryService extends Effect.Service<RepositoryService>()(
  "RepositoryService",
  {
    effect: Effect.gen(function* () {
      const configService = yield* ConfigService;

      /**
       * Get current user ID from auth token
       * Delegates to ConfigService which handles JWT decoding
       */
      const getUserId = () => configService.getUserId();

      /**
       * Get current organization ID from auth token
       * Delegates to ConfigService which handles JWT decoding
       */
      const getOrganizationId = () => configService.getOrganizationId();

      /**
       * Upsert a repository (create or update)
       * If organizationId is provided, the repository is scoped to the organization
       */
      const upsertRepository = (
        userId: string,
        name: string,
        rootPath: string,
        organizationId?: string | null,
      ) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[RepositoryService] Upserting repository: ${name} at ${rootPath} (org: ${organizationId ?? "none"})`,
          );

          const repositoryId = organizationId
            ? `${organizationId}-${rootPath}`
            : `${userId}-${rootPath}`;

          const repository = yield* Effect.tryPromise({
            try: async () => {
              const [result] = await db
                .insert(repositories)
                .values({
                  id: repositoryId,
                  userId,
                  organizationId: organizationId ?? undefined,
                  name,
                  rootPath,
                  lastIndexedAt: new Date(),
                })
                .onConflictDoUpdate({
                  target: repositories.id,
                  set: {
                    name,
                    rootPath,
                    organizationId: organizationId ?? undefined,
                    lastIndexedAt: new Date(),
                    updatedAt: new Date(),
                  },
                })
                .returning();

              return result;
            },
            catch: (error) =>
              new RepositoryError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          yield* Effect.logDebug(
            `[RepositoryService] Repository upserted: ${repository.id}`,
          );
          return repository;
        });

      /**
       * Get repository by root path
       * If organizationId is provided, looks up by organization first
       */
      const getRepository = (
        userId: string,
        rootPath: string,
        organizationId?: string | null,
      ) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[RepositoryService] Getting repository: ${rootPath} (org: ${organizationId ?? "user"})`,
          );

          const repository = yield* Effect.tryPromise({
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
              const [result] = await db
                .select()
                .from(repositories)
                .where(
                  sql`${repositories.userId} = ${userId} AND ${repositories.rootPath} = ${rootPath}`,
                )
                .limit(1);

              return result || null;
            },
            catch: (error) =>
              new RepositoryError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          return repository;
        });

      /**
       * Upsert a file with embedding
       */
      const upsertFile = (repositoryId: string, file: FileData) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[RepositoryService] Upserting file: ${file.relativePath}`,
          );

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

          yield* Effect.logDebug(
            `[RepositoryService] File upserted: ${file.relativePath}`,
          );
        });

      /**
       * Delete a file
       */
      const deleteFile = (repositoryId: string, relativePath: string) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[RepositoryService] Deleting file: ${relativePath}`,
          );

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

          yield* Effect.logDebug(
            `[RepositoryService] File deleted: ${relativePath}`,
          );
        });

      /**
       * Get file by path
       */
      const getFileByPath = (repositoryId: string, relativePath: string) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[RepositoryService] Getting file: ${relativePath}`,
          );

          const file = yield* Effect.tryPromise({
            try: async () => {
              const [result] = await db
                .select()
                .from(files)
                .where(
                  sql`${files.repositoryId} = ${repositoryId} AND ${files.relativePath} = ${relativePath}`,
                )
                .limit(1);

              return result || null;
            },
            catch: (error) =>
              new RepositoryError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          return file;
        });

      /**
       * Semantic search using Drizzle's cosineDistance
       */
      const searchFiles = (
        repositoryId: string,
        queryEmbedding: number[],
        limit: number = 10,
      ) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[RepositoryService] Searching files in repository: ${repositoryId} (limit: ${limit})`,
          );

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

          yield* Effect.logDebug(
            `[RepositoryService] Found ${results.length} results`,
          );
          return results;
        });

      /**
       * Get all file hashes for a repository (batch query for incremental sync)
       * Returns a Map<relativePath, contentHash> for O(1) lookups
       */
      const getFileHashes = (repositoryId: string) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[RepositoryService] Getting file hashes for repository: ${repositoryId}`,
          );

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

          // Return as Map for O(1) lookups
          const hashMap = new Map<string, string>(
            results.map((f) => [f.relativePath, f.contentHash]),
          );

          yield* Effect.logDebug(
            `[RepositoryService] Retrieved ${hashMap.size} file hashes`,
          );

          return hashMap;
        });

      /**
       * Get indexing status for a repository
       */
      const getIndexingStatus = (
        userId: string,
        rootPath: string,
        organizationId?: string | null,
      ) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[RepositoryService] Getting indexing status for: ${rootPath} (org: ${organizationId ?? "user"})`,
          );

          const repo = yield* getRepository(userId, rootPath, organizationId);
          if (!repo) {
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
                .where(eq(files.repositoryId, repo.id));
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
            status: repo.lastIndexedAt
              ? ("complete" as const)
              : ("idle" as const),
            repositoryName: repo.name,
            repositoryPath: repo.rootPath,
            lastIndexedAt: repo.lastIndexedAt,
            fileCount: fileCountResult,
          } satisfies IndexingStatusInfo;
        });

      return {
        getUserId,
        getOrganizationId,
        upsertRepository,
        getRepository,
        upsertFile,
        deleteFile,
        getFileByPath,
        getFileHashes,
        searchFiles,
        getIndexingStatus,
      };
    }),
    dependencies: [ConfigService.Default],
  },
) {}
