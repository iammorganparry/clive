import { knowledgeBase } from "@clive/db/schema";
import { eq, sql, desc, count, and } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { Data, Effect } from "effect";
import { DrizzleDB, DrizzleDBLive } from "./drizzle-db.js";

export class KnowledgeBaseError extends Data.TaggedError("KnowledgeBaseError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * Type for knowledge base category enum values
 * Inferred from the schema column type
 */
export type KnowledgeBaseCategoryType = InferSelectModel<
  typeof knowledgeBase
>["category"];

/**
 * Knowledge base entry
 */
export interface KnowledgeBaseEntry {
  id: string;
  repositoryId: string;
  category: string;
  title: string;
  content: string;
  examples: string[] | null;
  sourceFiles: string[] | null;
  embedding: number[];
  contentHash: string;
  updatedAt: Date;
}

/**
 * Knowledge base search result
 */
export interface KnowledgeBaseSearchResult {
  id: string;
  category: string;
  title: string;
  content: string;
  examples: string[] | null;
  sourceFiles: string[] | null;
  similarity: number;
}

/**
 * Knowledge base status
 */
export interface KnowledgeBaseStatus {
  hasKnowledge: boolean;
  lastUpdatedAt: Date | null;
  categories: string[];
  entryCount: number;
}

/**
 * Repository for managing testing knowledge base entries
 */
export class KnowledgeBaseRepository extends Effect.Service<KnowledgeBaseRepository>()(
  "KnowledgeBaseRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDB;

      /**
       * Upsert a knowledge base entry
       */
      const upsert = (entry: {
        repositoryId: string;
        category: KnowledgeBaseCategoryType;
        title: string;
        content: string;
        examples?: string[] | null;
        sourceFiles?: string[] | null;
        embedding: number[];
        contentHash: string;
      }) =>
        Effect.gen(function* () {
          const entryId = `${entry.repositoryId}-${entry.category}-${entry.contentHash.substring(0, 8)}`;

          yield* Effect.tryPromise({
            try: async () => {
              await db
                .insert(knowledgeBase)
                .values({
                  id: entryId,
                  repositoryId: entry.repositoryId,
                  category: entry.category,
                  title: entry.title,
                  content: entry.content,
                  examples: entry.examples
                    ? JSON.stringify(entry.examples)
                    : null,
                  sourceFiles: entry.sourceFiles
                    ? JSON.stringify(entry.sourceFiles)
                    : null,
                  embedding: entry.embedding,
                  contentHash: entry.contentHash,
                  updatedAt: new Date(),
                })
                .onConflictDoUpdate({
                  target: knowledgeBase.id,
                  set: {
                    title: entry.title,
                    content: entry.content,
                    examples: entry.examples
                      ? JSON.stringify(entry.examples)
                      : null,
                    sourceFiles: entry.sourceFiles
                      ? JSON.stringify(entry.sourceFiles)
                      : null,
                    embedding: entry.embedding,
                    contentHash: entry.contentHash,
                    updatedAt: new Date(),
                  },
                });
            },
            catch: (error) =>
              new KnowledgeBaseError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });
        });

      /**
       * Semantic search for knowledge base entries
       */
      const search = (
        repositoryId: string,
        queryEmbedding: number[],
        options?: {
          category?: KnowledgeBaseCategoryType;
          limit?: number;
        },
      ) =>
        Effect.gen(function* () {
          const limit = options?.limit ?? 5;

          const results = yield* Effect.tryPromise({
            try: async () => {
              const conditions = [eq(knowledgeBase.repositoryId, repositoryId)];
              if (options?.category) {
                conditions.push(eq(knowledgeBase.category, options.category));
              }

              return await db
                .select({
                  id: knowledgeBase.id,
                  category: knowledgeBase.category,
                  title: knowledgeBase.title,
                  content: knowledgeBase.content,
                  examples: knowledgeBase.examples,
                  sourceFiles: knowledgeBase.sourceFiles,
                  similarity: sql<number>`1 - (${knowledgeBase.embedding} <=> ${queryEmbedding}::vector)`,
                })
                .from(knowledgeBase)
                .where(and(...conditions))
                .orderBy(
                  sql`${knowledgeBase.embedding} <=> ${queryEmbedding}::vector`,
                )
                .limit(limit);
            },
            catch: (error) =>
              new KnowledgeBaseError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          return results.map((result) => ({
            id: result.id,
            category: result.category,
            title: result.title,
            content: result.content,
            examples: result.examples
              ? (JSON.parse(result.examples) as string[])
              : null,
            sourceFiles: result.sourceFiles
              ? (JSON.parse(result.sourceFiles) as string[])
              : null,
            similarity: result.similarity,
          })) satisfies KnowledgeBaseSearchResult[];
        });

      /**
       * Get all entries for a category
       */
      const getByCategory = (
        repositoryId: string,
        category: KnowledgeBaseCategoryType,
      ) =>
        Effect.gen(function* () {
          const results = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .select()
                .from(knowledgeBase)
                .where(
                  and(
                    eq(knowledgeBase.repositoryId, repositoryId),
                    eq(knowledgeBase.category, category),
                  ),
                )
                .orderBy(desc(knowledgeBase.updatedAt));
            },
            catch: (error) =>
              new KnowledgeBaseError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          return results.map((result) => ({
            id: result.id,
            repositoryId: result.repositoryId,
            category: result.category,
            title: result.title,
            content: result.content,
            examples: result.examples
              ? (JSON.parse(result.examples) as string[])
              : null,
            sourceFiles: result.sourceFiles
              ? (JSON.parse(result.sourceFiles) as string[])
              : null,
            embedding: result.embedding as number[],
            contentHash: result.contentHash,
            updatedAt: result.updatedAt,
          })) satisfies KnowledgeBaseEntry[];
        });

      /**
       * Get knowledge base status for a repository
       */
      const getStatus = (repositoryId: string) =>
        Effect.gen(function* () {
          const results = yield* Effect.tryPromise({
            try: async () => {
              const [entryCountResult] = await db
                .select({ count: count() })
                .from(knowledgeBase)
                .where(eq(knowledgeBase.repositoryId, repositoryId));

              const [lastUpdatedResult] = await db
                .select({
                  updatedAt: knowledgeBase.updatedAt,
                })
                .from(knowledgeBase)
                .where(eq(knowledgeBase.repositoryId, repositoryId))
                .orderBy(desc(knowledgeBase.updatedAt))
                .limit(1);

              const categoriesResult = await db
                .selectDistinct({
                  category: knowledgeBase.category,
                })
                .from(knowledgeBase)
                .where(eq(knowledgeBase.repositoryId, repositoryId));

              return {
                entryCount: entryCountResult?.count ?? 0,
                lastUpdatedAt: lastUpdatedResult?.updatedAt ?? null,
                categories: categoriesResult.map((r) => r.category),
              };
            },
            catch: (error) =>
              new KnowledgeBaseError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          return {
            hasKnowledge: results.entryCount > 0,
            lastUpdatedAt: results.lastUpdatedAt,
            categories: results.categories,
            entryCount: results.entryCount,
          } satisfies KnowledgeBaseStatus;
        });

      /**
       * Delete all knowledge base entries for a repository
       */
      const deleteAll = (repositoryId: string) =>
        Effect.gen(function* () {
          yield* Effect.tryPromise({
            try: async () => {
              await db
                .delete(knowledgeBase)
                .where(eq(knowledgeBase.repositoryId, repositoryId));
            },
            catch: (error) =>
              new KnowledgeBaseError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });
        });

      /**
       * Delete a specific knowledge base entry
       */
      const deleteEntry = (entryId: string) =>
        Effect.gen(function* () {
          yield* Effect.tryPromise({
            try: async () => {
              await db
                .delete(knowledgeBase)
                .where(eq(knowledgeBase.id, entryId));
            },
            catch: (error) =>
              new KnowledgeBaseError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });
        });

      return {
        upsert,
        search,
        getByCategory,
        getStatus,
        deleteAll,
        deleteEntry,
      };
    }),
    dependencies: [DrizzleDBLive],
  },
) {}

/**
 * Default layer - dependencies provided at composition site
 */
export const KnowledgeBaseRepositoryDefault = KnowledgeBaseRepository.Default;
