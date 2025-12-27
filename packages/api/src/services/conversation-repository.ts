import { randomUUID } from "node:crypto";
import { conversation, type conversationTypeEnum } from "@clive/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Data, Effect } from "effect";
import { DrizzleDB, DrizzleDBLive } from "./drizzle-db.js";

type ConversationType = (typeof conversationTypeEnum.enumValues)[number];

class ConversationError extends Data.TaggedError("ConversationError")<{
  message: string;
  cause?: unknown;
}> {}

class ConversationNotFoundError extends Data.TaggedError(
  "ConversationNotFoundError",
)<{
  conversationId: string;
}> {}

export interface Conversation {
  id: string;
  userId: string;
  sourceFile: string | null;
  branchName: string | null;
  baseBranch: string | null;
  sourceFiles: string | null; // JSON array of file paths
  conversationType: "branch" | "uncommitted" | "file";
  commitHash: string | null; // HEAD commit hash for uncommitted conversations
  status: "planning" | "confirmed" | "completed";
  createdAt: Date;
  updatedAt: Date;
}

export class ConversationRepository extends Effect.Service<ConversationRepository>()(
  "ConversationRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDB;

      /**
       * Create a new conversation
       */
      const create = (userId: string, sourceFile: string) =>
        Effect.gen(function* () {
          const id = randomUUID();
          const now = new Date();

          yield* Effect.tryPromise({
            try: () =>
              db.insert(conversation).values({
                id,
                userId,
                sourceFile,
                conversationType: "file",
                commitHash: null,
                status: "planning",
                createdAt: now,
                updatedAt: now,
              }),
            catch: (error) =>
              new ConversationError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          return {
            id,
            userId,
            sourceFile,
            branchName: null,
            baseBranch: null,
            sourceFiles: null,
            conversationType: "file",
            commitHash: null,
            status: "planning" as const,
            createdAt: now,
            updatedAt: now,
          } satisfies Conversation;
        });

      /**
       * Find conversation by ID
       */
      const findById = (id: string) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              db.query.conversation.findFirst({
                where: eq(conversation.id, id),
              }),
            catch: (error) =>
              new ConversationError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          if (!result) {
            return yield* Effect.fail(
              new ConversationNotFoundError({ conversationId: id }),
            );
          }

          return {
            id: result.id,
            userId: result.userId,
            sourceFile: result.sourceFile ?? null,
            branchName: result.branchName ?? null,
            baseBranch: result.baseBranch ?? null,
            sourceFiles: result.sourceFiles ?? null,
            conversationType: result.conversationType as ConversationType,
            commitHash: result.commitHash ?? null,
            status: result.status as "planning" | "confirmed" | "completed",
            createdAt: result.createdAt,
            updatedAt: result.updatedAt,
          } satisfies Conversation;
        });

      /**
       * Find conversation by user ID and source file
       */
      const findByUserAndFile = (userId: string, sourceFile: string) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              db.query.conversation.findFirst({
                where: and(
                  eq(conversation.userId, userId),
                  eq(conversation.sourceFile, sourceFile),
                ),
                orderBy: desc(conversation.createdAt),
              }),
            catch: (error) =>
              new ConversationError({
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
            sourceFile: result.sourceFile ?? null,
            branchName: result.branchName ?? null,
            baseBranch: result.baseBranch ?? null,
            sourceFiles: result.sourceFiles ?? null,
            conversationType: result.conversationType as ConversationType,
            commitHash: result.commitHash ?? null,
            status: result.status as "planning" | "confirmed" | "completed",
            createdAt: result.createdAt,
            updatedAt: result.updatedAt,
          } satisfies Conversation;
        });

      /**
       * Find conversation by user ID, branch name, and base branch
       */
      const findByUserAndBranch = (
        userId: string,
        branchName: string,
        baseBranch: string,
        conversationType: "branch" | "uncommitted",
        commitHash?: string, // Optional - only for uncommitted
      ) =>
        Effect.gen(function* () {
          // Build WHERE conditions
          const conditions = [
            eq(conversation.userId, userId),
            eq(conversation.branchName, branchName),
            eq(conversation.baseBranch, baseBranch),
            eq(conversation.conversationType, conversationType),
          ];

          // For uncommitted, must match commit hash
          if (conversationType === "uncommitted" && commitHash) {
            conditions.push(eq(conversation.commitHash, commitHash));
          }

          // For branch, commit hash must be null
          if (conversationType === "branch") {
            conditions.push(isNull(conversation.commitHash));
          }

          const result = yield* Effect.tryPromise({
            try: () =>
              db.query.conversation.findFirst({
                where: and(...conditions),
                orderBy: desc(conversation.createdAt),
              }),
            catch: (error) =>
              new ConversationError({
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
            sourceFile: result.sourceFile ?? null,
            branchName: result.branchName ?? null,
            baseBranch: result.baseBranch ?? null,
            sourceFiles: result.sourceFiles ?? null,
            conversationType: result.conversationType as ConversationType,
            commitHash: result.commitHash ?? null,
            status: result.status as "planning" | "confirmed" | "completed",
            createdAt: result.createdAt,
            updatedAt: result.updatedAt,
          } satisfies Conversation;
        });

      /**
       * Create a new conversation for a branch
       */
      const createForBranch = (
        userId: string,
        branchName: string,
        baseBranch: string,
        sourceFiles: string[], // Array of file paths
        conversationType: "branch" | "uncommitted",
        commitHash?: string, // Optional - only for uncommitted
      ) =>
        Effect.gen(function* () {
          const id = randomUUID();
          const now = new Date();

          yield* Effect.tryPromise({
            try: () =>
              db.insert(conversation).values({
                id,
                userId,
                branchName,
                baseBranch,
                sourceFiles: JSON.stringify(sourceFiles),
                conversationType,
                commitHash:
                  conversationType === "uncommitted" ? commitHash : null,
                status: "planning",
                createdAt: now,
                updatedAt: now,
              }),
            catch: (error) =>
              new ConversationError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          return {
            id,
            userId,
            sourceFile: null,
            branchName,
            baseBranch,
            sourceFiles: JSON.stringify(sourceFiles),
            conversationType,
            commitHash:
              conversationType === "uncommitted" ? commitHash ?? null : null,
            status: "planning" as const,
            createdAt: now,
            updatedAt: now,
          } satisfies Conversation;
        });

      /**
       * Update conversation status
       */
      const updateStatus = (
        id: string,
        status: "planning" | "confirmed" | "completed",
      ) =>
        Effect.gen(function* () {
          yield* Effect.tryPromise({
            try: () =>
              db
                .update(conversation)
                .set({ status, updatedAt: new Date() })
                .where(eq(conversation.id, id)),
            catch: (error) =>
              new ConversationError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          // Re-fetch the updated conversation - call findById directly
          return yield* findById(id);
        });

      /**
       * List conversations for a user
       */
      const list = (userId: string) =>
        Effect.gen(function* () {
          const results = yield* Effect.tryPromise({
            try: () =>
              db.query.conversation.findMany({
                where: eq(conversation.userId, userId),
                orderBy: desc(conversation.updatedAt),
              }),
            catch: (error) =>
              new ConversationError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          return results.map(
            (result) =>
              ({
                id: result.id,
                userId: result.userId,
                sourceFile: result.sourceFile ?? null,
                branchName: result.branchName ?? null,
                baseBranch: result.baseBranch ?? null,
                sourceFiles: result.sourceFiles ?? null,
                conversationType: result.conversationType as ConversationType,
                commitHash: result.commitHash ?? null,
                status: result.status as "planning" | "confirmed" | "completed",
                createdAt: result.createdAt,
                updatedAt: result.updatedAt,
              }) satisfies Conversation,
          );
        });

      /**
       * Delete a conversation
       */
      const deleteConversation = (id: string) =>
        Effect.gen(function* () {
          yield* Effect.tryPromise({
            try: () => db.delete(conversation).where(eq(conversation.id, id)),
            catch: (error) =>
              new ConversationError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });
        });

      return {
        create,
        findById,
        findByUserAndFile,
        findByUserAndBranch,
        createForBranch,
        updateStatus,
        list,
        delete: deleteConversation,
      };
    }),
    dependencies: [DrizzleDBLive],
  },
) {}

export const ConversationRepositoryDefault = ConversationRepository.Default;

export type { ConversationError, ConversationNotFoundError };
