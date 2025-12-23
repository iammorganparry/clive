import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { Effect, Runtime } from "effect";
import { z } from "zod/v4";
import {
  KnowledgeBaseRepository,
  KnowledgeBaseRepositoryDefault,
} from "../services/index.js";
import { protectedProcedure } from "../trpc.js";

const runtime = Runtime.defaultRuntime;

const categorySchema = z.enum([
  "framework",
  "patterns",
  "mocks",
  "fixtures",
  "selectors",
  "routes",
  "assertions",
  "hooks",
  "utilities",
  "coverage",
  "gaps",
  "improvements",
]);

export const knowledgeBaseRouter = {
  /**
   * Upsert a knowledge base entry
   */
  upsert: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string(),
        category: categorySchema,
        title: z.string(),
        content: z.string(),
        examples: z.array(z.string()).nullable().optional(),
        sourceFiles: z.array(z.string()).nullable().optional(),
        embedding: z.array(z.number()),
        contentHash: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      return Effect.gen(function* () {
        const repo = yield* KnowledgeBaseRepository;
        yield* repo.upsert({
          repositoryId: input.repositoryId,
          category: input.category,
          title: input.title,
          content: input.content,
          examples: input.examples ?? null,
          sourceFiles: input.sourceFiles ?? null,
          embedding: input.embedding,
          contentHash: input.contentHash,
        });
        return { success: true };
      }).pipe(
        Effect.catchTag("KnowledgeBaseError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(KnowledgeBaseRepositoryDefault),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Semantic search for knowledge base entries
   */
  search: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string(),
        queryEmbedding: z.array(z.number()),
        category: categorySchema.optional(),
        limit: z.number().default(5),
      }),
    )
    .query(async ({ input }) => {
      return Effect.gen(function* () {
        const repo = yield* KnowledgeBaseRepository;
        return yield* repo.search(input.repositoryId, input.queryEmbedding, {
          category: input.category,
          limit: input.limit,
        });
      }).pipe(
        Effect.catchTag("KnowledgeBaseError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(KnowledgeBaseRepositoryDefault),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Get all entries for a category
   */
  getByCategory: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string(),
        category: categorySchema,
      }),
    )
    .query(async ({ input }) => {
      return Effect.gen(function* () {
        const repo = yield* KnowledgeBaseRepository;
        return yield* repo.getByCategory(input.repositoryId, input.category);
      }).pipe(
        Effect.catchTag("KnowledgeBaseError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(KnowledgeBaseRepositoryDefault),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Get knowledge base status for a repository
   */
  getStatus: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string(),
      }),
    )
    .query(async ({ input }) => {
      return Effect.gen(function* () {
        const repo = yield* KnowledgeBaseRepository;
        return yield* repo.getStatus(input.repositoryId);
      }).pipe(
        Effect.catchTag("KnowledgeBaseError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(KnowledgeBaseRepositoryDefault),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Delete all knowledge base entries for a repository
   */
  deleteAll: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      return Effect.gen(function* () {
        const repo = yield* KnowledgeBaseRepository;
        yield* repo.deleteAll(input.repositoryId);
        return { success: true };
      }).pipe(
        Effect.catchTag("KnowledgeBaseError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(KnowledgeBaseRepositoryDefault),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Delete a specific knowledge base entry
   */
  delete: protectedProcedure
    .input(
      z.object({
        entryId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      return Effect.gen(function* () {
        const repo = yield* KnowledgeBaseRepository;
        yield* repo.deleteEntry(input.entryId);
        return { success: true };
      }).pipe(
        Effect.catchTag("KnowledgeBaseError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(KnowledgeBaseRepositoryDefault),
        Runtime.runPromise(runtime),
      );
    }),
} satisfies TRPCRouterRecord;
