import { randomUUID } from "node:crypto";
import { db } from "@clive/db/client";
import { conversation } from "@clive/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { Data, Effect } from "effect";

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
  sourceFile: string;
  status: "planning" | "confirmed" | "completed";
  createdAt: Date;
  updatedAt: Date;
}

export class ConversationRepository extends Effect.Service<ConversationRepository>()(
  "ConversationRepository",
  {
    effect: Effect.succeed({
      /**
       * Create a new conversation
       */
      create: (userId: string, sourceFile: string) =>
        Effect.gen(function* () {
          const id = randomUUID();
          const now = new Date();

          yield* Effect.tryPromise({
            try: () =>
              db.insert(conversation).values({
                id,
                userId,
                sourceFile,
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
            status: "planning" as const,
            createdAt: now,
            updatedAt: now,
          } satisfies Conversation;
        }),

      /**
       * Find conversation by ID
       */
      findById: (id: string) =>
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
            sourceFile: result.sourceFile,
            status: result.status as "planning" | "confirmed" | "completed",
            createdAt: result.createdAt,
            updatedAt: result.updatedAt,
          } satisfies Conversation;
        }),

      /**
       * Find conversation by user ID and source file
       */
      findByUserAndFile: (userId: string, sourceFile: string) =>
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
            sourceFile: result.sourceFile,
            status: result.status as "planning" | "confirmed" | "completed",
            createdAt: result.createdAt,
            updatedAt: result.updatedAt,
          } satisfies Conversation;
        }),

      /**
       * Update conversation status
       */
      updateStatus: (
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

          // Re-fetch the updated conversation
          const repo = yield* ConversationRepository;
          return yield* repo.findById(id);
        }),

      /**
       * List conversations for a user
       */
      list: (userId: string) =>
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
                sourceFile: result.sourceFile,
                status: result.status as "planning" | "confirmed" | "completed",
                createdAt: result.createdAt,
                updatedAt: result.updatedAt,
              }) satisfies Conversation,
          );
        }),

      /**
       * Delete a conversation
       */
      delete: (id: string) =>
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
        }),
    }),
    dependencies: [],
  },
) {}

export const ConversationRepositoryDefault = ConversationRepository.Default;

export type { ConversationError, ConversationNotFoundError };
