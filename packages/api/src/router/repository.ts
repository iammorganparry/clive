import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { Effect, Runtime } from "effect";
import { z } from "zod/v4";
import { RepositoryRepository } from "../services/index.js";
import { protectedProcedure } from "../trpc.js";

const runtime = Runtime.defaultRuntime;

export const repositoryRouter = {
  /**
   * Upsert a repository (create or update)
   *
   * @contract repository.upsert
   * @see contracts/system.md#repository.upsert
   */
  upsert: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        rootPath: z.string(),
        organizationId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return Effect.gen(function* () {
        const repo = yield* RepositoryRepository;
        return yield* repo.upsert(
          ctx.userId,
          input.name,
          input.rootPath,
          input.organizationId,
        );
      }).pipe(
        Effect.catchTag("RepositoryError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(RepositoryRepository.Default),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Get repository by root path
   *
   * @contract repository.get
   * @see contracts/system.md#repository.get
   */
  get: protectedProcedure
    .input(
      z.object({
        rootPath: z.string(),
        organizationId: z.string().nullable().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return Effect.gen(function* () {
        const repo = yield* RepositoryRepository;
        return yield* repo.get(
          ctx.userId,
          input.rootPath,
          input.organizationId,
        );
      }).pipe(
        Effect.catchTag("RepositoryError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(RepositoryRepository.Default),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Get indexing status for a repository
   *
   * @contract repository.getStatus
   * @see contracts/system.md#repository.getStatus
   */
  getStatus: protectedProcedure
    .input(
      z.object({
        rootPath: z.string(),
        organizationId: z.string().nullable().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return Effect.gen(function* () {
        const repo = yield* RepositoryRepository;
        return yield* repo.getStatus(
          ctx.userId,
          input.rootPath,
          input.organizationId,
        );
      }).pipe(
        Effect.catchTag("RepositoryError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(RepositoryRepository.Default),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Upsert a file with embedding
   *
   * @contract repository.upsertFile
   * @see contracts/system.md#repository.upsertFile
   */
  upsertFile: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string(),
        file: z.object({
          relativePath: z.string(),
          content: z.string(),
          embedding: z.array(z.number()),
          fileType: z.string(),
          contentHash: z.string(),
        }),
      }),
    )
    .mutation(async ({ input }) => {
      return Effect.gen(function* () {
        const repo = yield* RepositoryRepository;
        yield* repo.upsertFile(input.repositoryId, input.file);
        return { success: true };
      }).pipe(
        Effect.catchTag("RepositoryError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(RepositoryRepository.Default),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Delete a file from the index
   *
   * @contract repository.deleteFile
   * @see contracts/system.md#repository.deleteFile
   */
  deleteFile: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string(),
        relativePath: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      return Effect.gen(function* () {
        const repo = yield* RepositoryRepository;
        yield* repo.deleteFile(input.repositoryId, input.relativePath);
        return { success: true };
      }).pipe(
        Effect.catchTag("RepositoryError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(RepositoryRepository.Default),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Delete multiple files from the index (bulk)
   *
   * @contract repository.deleteFiles
   * @see contracts/system.md#repository.deleteFiles
   */
  deleteFiles: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string(),
        relativePaths: z.array(z.string()),
      }),
    )
    .mutation(async ({ input }) => {
      return Effect.gen(function* () {
        const repo = yield* RepositoryRepository;
        yield* repo.deleteFiles(input.repositoryId, input.relativePaths);
        return { success: true, deletedCount: input.relativePaths.length };
      }).pipe(
        Effect.catchTag("RepositoryError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(RepositoryRepository.Default),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Get file by path
   *
   * @contract repository.getFileByPath
   * @see contracts/system.md#repository.getFileByPath
   */
  getFileByPath: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string(),
        relativePath: z.string(),
      }),
    )
    .query(async ({ input }) => {
      return Effect.gen(function* () {
        const repo = yield* RepositoryRepository;
        return yield* repo.getFileByPath(
          input.repositoryId,
          input.relativePath,
        );
      }).pipe(
        Effect.catchTag("RepositoryError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(RepositoryRepository.Default),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Get all file hashes for a repository (for incremental sync)
   *
   * @contract repository.getFileHashes
   * @see contracts/system.md#repository.getFileHashes
   */
  getFileHashes: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string(),
      }),
    )
    .query(async ({ input }) => {
      return Effect.gen(function* () {
        const repo = yield* RepositoryRepository;
        return yield* repo.getFileHashes(input.repositoryId);
      }).pipe(
        Effect.catchTag("RepositoryError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(RepositoryRepository.Default),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Semantic search using vector embeddings
   *
   * @contract repository.searchFiles
   * @see contracts/system.md#repository.searchFiles
   */
  searchFiles: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string(),
        queryEmbedding: z.array(z.number()),
        limit: z.number().optional().default(10),
      }),
    )
    .query(async ({ input }) => {
      return Effect.gen(function* () {
        const repo = yield* RepositoryRepository;
        return yield* repo.searchFiles(
          input.repositoryId,
          input.queryEmbedding,
          input.limit,
        );
      }).pipe(
        Effect.catchTag("RepositoryError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(RepositoryRepository.Default),
        Runtime.runPromise(runtime),
      );
    }),
} satisfies TRPCRouterRecord;
