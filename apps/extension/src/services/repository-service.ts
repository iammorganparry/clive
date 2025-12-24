import { Data, Effect } from "effect";
import { ConfigService } from "./config-service.js";
import { TrpcClientService } from "./trpc-client-service.js";
import { wrapTrpcCall } from "../utils/trpc-utils.js";
import type { IndexingStatusInfo } from "./indexing-status.js";

class RepositoryError extends Data.TaggedError("RepositoryError")<{
  message: string;
  cause?: unknown;
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
 * Service for managing codebase repositories and file embeddings
 * Calls backend API endpoints instead of direct database access
 */
export class RepositoryService extends Effect.Service<RepositoryService>()(
  "RepositoryService",
  {
    effect: Effect.gen(function* () {
      const configService = yield* ConfigService;
      const trpcClientService = yield* TrpcClientService;

      /**
       * Get current user ID from auth token
       */
      const getUserId = () => configService.getUserId();

      /**
       * Get current organization ID from auth token
       */
      const getOrganizationId = () => configService.getOrganizationId();

      /**
       * Upsert a repository (create or update)
       * Note: userId is extracted from auth token on the server side
       */
      const upsertRepository = (
        _userId: string,
        name: string,
        rootPath: string,
        organizationId?: string | null,
      ) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[RepositoryService] Upserting repository: ${name} at ${rootPath}`,
          );

          const client = yield* trpcClientService.getClient();
          const repository = yield* wrapTrpcCall((c) =>
            c.repository.upsert.mutate({
              name,
              rootPath,
              organizationId: organizationId ?? null,
            }),
          )(client).pipe(
            Effect.catchAll((error) =>
              Effect.fail(
                new RepositoryError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                }),
              ),
            ),
          );

          yield* Effect.logDebug(
            `[RepositoryService] Repository upserted: ${repository.id}`,
          );
          return repository;
        });

      /**
       * Get repository by root path
       * Note: userId is extracted from auth token on the server side
       */
      const getRepository = (
        _userId: string,
        rootPath: string,
        organizationId?: string | null,
      ) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[RepositoryService] Getting repository: ${rootPath}`,
          );

          const client = yield* trpcClientService.getClient();
          const repository = yield* wrapTrpcCall((c) =>
            c.repository.get.query({
              rootPath,
              organizationId: organizationId ?? null,
            }),
          )(client).pipe(
            Effect.catchAll((error) =>
              Effect.fail(
                new RepositoryError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                }),
              ),
            ),
          );

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

          const client = yield* trpcClientService.getClient();
          yield* wrapTrpcCall((c) =>
            c.repository.upsertFile.mutate({ repositoryId, file }),
          )(client).pipe(
            Effect.catchAll((error) =>
              Effect.fail(
                new RepositoryError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                }),
              ),
            ),
          );

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

          const client = yield* trpcClientService.getClient();
          yield* wrapTrpcCall((c) =>
            c.repository.deleteFile.mutate({ repositoryId, relativePath }),
          )(client).pipe(
            Effect.catchAll((error) =>
              Effect.fail(
                new RepositoryError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                }),
              ),
            ),
          );

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

          const client = yield* trpcClientService.getClient();
          const file = yield* wrapTrpcCall((c) =>
            c.repository.getFileByPath.query({ repositoryId, relativePath }),
          )(client).pipe(
            Effect.catchAll((error) =>
              Effect.fail(
                new RepositoryError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                }),
              ),
            ),
          );

          return file;
        });

      /**
       * Get all file hashes for a repository (batch query for incremental sync)
       */
      const getFileHashes = (repositoryId: string) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[RepositoryService] Getting file hashes for repository: ${repositoryId}`,
          );

          const client = yield* trpcClientService.getClient();
          const hashMap = yield* wrapTrpcCall((c) =>
            c.repository.getFileHashes.query({ repositoryId }),
          )(client).pipe(
            Effect.catchAll((error) =>
              Effect.fail(
                new RepositoryError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                }),
              ),
            ),
          );

          // Convert back to Map for compatibility
          const map = new Map<string, string>(Object.entries(hashMap));

          yield* Effect.logDebug(
            `[RepositoryService] Retrieved ${map.size} file hashes`,
          );

          return map;
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
          yield* Effect.logDebug(
            `[RepositoryService] Searching files in repository: ${repositoryId}`,
          );

          const client = yield* trpcClientService.getClient();
          const results = yield* wrapTrpcCall((c) =>
            c.repository.searchFiles.query({
              repositoryId,
              queryEmbedding,
              limit,
            }),
          )(client).pipe(
            Effect.catchAll((error) =>
              Effect.fail(
                new RepositoryError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                }),
              ),
            ),
          );

          yield* Effect.logDebug(
            `[RepositoryService] Found ${results.length} results`,
          );

          return results;
        });

      /**
       * Get indexing status for a repository
       * Note: userId is extracted from auth token on the server side
       */
      const getIndexingStatus = (
        _userId: string,
        rootPath: string,
        organizationId?: string | null,
      ) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[RepositoryService] Getting indexing status for: ${rootPath}`,
          );

          const client = yield* trpcClientService.getClient();
          const status = yield* wrapTrpcCall((c) =>
            c.repository.getStatus.query({
              rootPath,
              organizationId: organizationId ?? null,
            }),
          )(client).pipe(
            Effect.catchAll((error) =>
              Effect.fail(
                new RepositoryError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                }),
              ),
            ),
          );

          return status as IndexingStatusInfo;
        });

      /**
       * Get the typed tRPC client for direct access
       * Use this for procedures not wrapped by this service
       */
      const getClient = () => trpcClientService.getClient();

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
        getClient,
      };
    }),
    // No dependencies - allows test injection via Layer.provide()
  },
) {}

/**
 * Production layer with all dependencies composed.
 * Use this in production code; use RepositoryService.Default in tests with mocked deps.
 */
/**
 * RepositoryService depends on ConfigService which has context-specific deps.
 * Use RepositoryService.Default directly - dependencies provided at composition site.
 */
export const RepositoryServiceLive = RepositoryService.Default;
