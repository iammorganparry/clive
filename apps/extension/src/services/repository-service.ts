import { Data, Effect } from "effect";
import SuperJSON from "superjson";
import { ConfigService } from "./config-service.js";
import { parseTrpcError } from "../lib/error-messages.js";
import type { IndexingStatusInfo } from "./indexing-status.js";

class RepositoryError extends Data.TaggedError("RepositoryError")<{
  message: string;
  cause?: unknown;
}> {}

class ApiError extends Data.TaggedError("ApiError")<{
  message: string;
  status?: number;
  cause?: unknown;
}> {}

class NetworkError extends Data.TaggedError("NetworkError")<{
  message: string;
  cause?: unknown;
}> {}

class AuthTokenMissingError extends Data.TaggedError("AuthTokenMissingError")<{
  message: string;
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

      /**
       * Helper to get auth token
       */
      const getAuthToken = () =>
        Effect.gen(function* () {
          const token = yield* configService.getAuthToken().pipe(
            Effect.catchAll(() =>
              Effect.fail(
                new AuthTokenMissingError({
                  message: "Failed to retrieve auth token. Please log in.",
                }),
              ),
            ),
          );
          if (!token) {
            return yield* Effect.fail(
              new AuthTokenMissingError({
                message: "Auth token not available. Please log in.",
              }),
            );
          }
          return token;
        });

      /**
       * Helper to make tRPC API calls (queries)
       */
      const callTrpcQuery = <T>(procedure: string, input: unknown) =>
        Effect.gen(function* () {
          const authToken = yield* getAuthToken();
          const backendUrl = "http://localhost:3000";

          const response = yield* Effect.tryPromise({
            try: async () => {
              const serializedInput = SuperJSON.serialize(input);
              const inputStr = encodeURIComponent(
                JSON.stringify(serializedInput),
              );
              const url = `${backendUrl}/api/trpc/${procedure}?input=${inputStr}`;

              return fetch(url, {
                method: "GET",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${authToken}`,
                },
              });
            },
            catch: (error) =>
              new NetworkError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          if (!response.ok) {
            const errorText = yield* Effect.tryPromise({
              try: () => response.text(),
              catch: () =>
                new NetworkError({
                  message: "Failed to read error response",
                }),
            });
            const userMessage = parseTrpcError(errorText, response.status);
            return yield* Effect.fail(
              new ApiError({
                message: userMessage,
                status: response.status,
                cause: errorText,
              }),
            );
          }

          const responseText = yield* Effect.tryPromise({
            try: () => response.text(),
            catch: (error) =>
              new ApiError({
                message: "Failed to read API response body",
                cause: error,
              }),
          });

          yield* Effect.logDebug(
            `[RepositoryService] Response body (first 500 chars): ${responseText.substring(0, 500)}`,
          );

          const data = yield* Effect.try({
            try: () =>
              JSON.parse(responseText) as { result?: { data?: unknown } },
            catch: (error) =>
              new ApiError({
                message: `Failed to parse API response: ${responseText.substring(0, 200)}`,
                cause: error,
              }),
          });

          if (data.result?.data !== undefined && data.result.data !== null) {
            return SuperJSON.deserialize<T>(
              data.result.data as Parameters<typeof SuperJSON.deserialize>[0],
            );
          }

          return yield* Effect.fail(
            new ApiError({
              message: "Invalid response format from API",
            }),
          );
        });

      /**
       * Helper to make tRPC API calls (mutations)
       */
      const callTrpcMutation = <T>(procedure: string, input: unknown) =>
        Effect.gen(function* () {
          const authToken = yield* getAuthToken();
          const backendUrl = "http://localhost:3000";

          const response = yield* Effect.tryPromise({
            try: async () => {
              const url = `${backendUrl}/api/trpc/${procedure}`;
              const serializedInput = SuperJSON.serialize(input);
              const body = JSON.stringify(serializedInput);

              return fetch(url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${authToken}`,
                },
                body,
              });
            },
            catch: (error) =>
              new NetworkError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          if (!response.ok) {
            const errorText = yield* Effect.tryPromise({
              try: () => response.text(),
              catch: () =>
                new NetworkError({
                  message: "Failed to read error response",
                }),
            });
            const userMessage = parseTrpcError(errorText, response.status);
            return yield* Effect.fail(
              new ApiError({
                message: userMessage,
                status: response.status,
                cause: errorText,
              }),
            );
          }

          const responseText = yield* Effect.tryPromise({
            try: () => response.text(),
            catch: (error) =>
              new ApiError({
                message: "Failed to read API response body",
                cause: error,
              }),
          });

          yield* Effect.logDebug(
            `[RepositoryService] Response body (first 500 chars): ${responseText.substring(0, 500)}`,
          );

          const data = yield* Effect.try({
            try: () =>
              JSON.parse(responseText) as { result?: { data?: unknown } },
            catch: (error) =>
              new ApiError({
                message: `Failed to parse API response: ${responseText.substring(0, 200)}`,
                cause: error,
              }),
          });

          if (data.result?.data !== undefined && data.result.data !== null) {
            return SuperJSON.deserialize<T>(
              data.result.data as Parameters<typeof SuperJSON.deserialize>[0],
            );
          }

          return yield* Effect.fail(
            new ApiError({
              message: "Invalid response format from API",
            }),
          );
        });

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

          const repository = yield* callTrpcMutation<Repository>(
            "repository.upsert",
            { name, rootPath, organizationId: organizationId ?? null },
          ).pipe(
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

          const repository = yield* callTrpcQuery<Repository | null>(
            "repository.get",
            { rootPath, organizationId: organizationId ?? null },
          ).pipe(
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

          yield* callTrpcMutation<{ success: boolean }>(
            "repository.upsertFile",
            { repositoryId, file },
          ).pipe(
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

          yield* callTrpcMutation<{ success: boolean }>(
            "repository.deleteFile",
            { repositoryId, relativePath },
          ).pipe(
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

          const file = yield* callTrpcQuery<unknown | null>(
            "repository.getFileByPath",
            { repositoryId, relativePath },
          ).pipe(
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

          const hashMap = yield* callTrpcQuery<Record<string, string>>(
            "repository.getFileHashes",
            { repositoryId },
          ).pipe(
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

          const results = yield* callTrpcQuery<FileSearchResult[]>(
            "repository.searchFiles",
            { repositoryId, queryEmbedding, limit },
          ).pipe(
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

          const status = yield* callTrpcQuery<IndexingStatusInfo>(
            "repository.getStatus",
            { rootPath, organizationId: organizationId ?? null },
          ).pipe(
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

          return status;
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
