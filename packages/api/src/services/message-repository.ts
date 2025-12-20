import { Data, Effect } from "effect";
import { eq, desc } from "drizzle-orm";
import { db } from "@clive/db/client";
import { conversationMessage } from "@clive/db/schema";
import { randomUUID } from "node:crypto";

class MessageError extends Data.TaggedError("MessageError")<{
  message: string;
  cause?: unknown;
}> {}

class MessageNotFoundError extends Data.TaggedError("MessageNotFoundError")<{
  messageId: string;
}> {}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls: string | null;
  createdAt: Date;
}

export class MessageRepository extends Effect.Service<MessageRepository>()(
  "MessageRepository",
  {
    effect: Effect.succeed({
      /**
       * Create a new message
       */
      create: (
        conversationId: string,
        role: "user" | "assistant" | "system",
        content: string,
        toolCalls?: unknown,
      ) =>
        Effect.gen(function* () {
          const id = randomUUID();
          const toolCallsJson = toolCalls ? JSON.stringify(toolCalls) : null;

          yield* Effect.tryPromise({
            try: () =>
              db.insert(conversationMessage).values({
                id,
                conversationId,
                role,
                content,
                toolCalls: toolCallsJson,
                createdAt: new Date(),
              }),
            catch: (error) =>
              new MessageError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          return {
            id,
            conversationId,
            role,
            content,
            toolCalls: toolCallsJson,
            createdAt: new Date(),
          } satisfies Message;
        }),

      /**
       * Find message by ID
       */
      findById: (id: string) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              db.query.conversationMessage.findFirst({
                where: eq(conversationMessage.id, id),
              }),
            catch: (error) =>
              new MessageError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          if (!result) {
            return yield* Effect.fail(
              new MessageNotFoundError({ messageId: id }),
            );
          }

          return {
            id: result.id,
            conversationId: result.conversationId,
            role: result.role as "user" | "assistant" | "system",
            content: result.content,
            toolCalls: result.toolCalls,
            createdAt: result.createdAt,
          } satisfies Message;
        }),

      /**
       * Find all messages for a conversation
       */
      findByConversation: (conversationId: string) =>
        Effect.gen(function* () {
          const results = yield* Effect.tryPromise({
            try: () =>
              db.query.conversationMessage.findMany({
                where: eq(conversationMessage.conversationId, conversationId),
                orderBy: desc(conversationMessage.createdAt),
              }),
            catch: (error) =>
              new MessageError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          return results.map(
            (result) =>
              ({
                id: result.id,
                conversationId: result.conversationId,
                role: result.role as "user" | "assistant" | "system",
                content: result.content,
                toolCalls: result.toolCalls,
                createdAt: result.createdAt,
              }) satisfies Message,
          );
        }),
    }),
    dependencies: [],
  },
) {}

export const MessageRepositoryDefault = MessageRepository.Default;

export type { MessageError, MessageNotFoundError };
