import { Effect } from "effect";
import { ConfigService } from "./config-service.js";
import { TrpcClientService } from "./trpc-client-service.js";
import {
  wrapTrpcCall,
  type ApiError,
  type NetworkError,
  type AuthTokenMissingError,
} from "../utils/trpc-utils.js";

export interface Conversation {
  id: string;
  userId: string;
  sourceFile: string;
  status: "planning" | "confirmed" | "completed";
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls: string | null;
  createdAt: Date;
}

/**
 * Service for managing conversations with the backend API
 * Handles creating, fetching, and updating conversations and messages
 */
export class ConversationService extends Effect.Service<ConversationService>()(
  "ConversationService",
  {
    effect: Effect.gen(function* () {
      const _configService = yield* ConfigService;
      const trpcClientService = yield* TrpcClientService;

      return {
        /**
         * Create or get existing conversation for a source file
         */
        getOrCreateConversation: (sourceFile: string) =>
          Effect.gen(function* () {
            const client = yield* trpcClientService.getClient();

            // First try to get existing
            const existing = yield* wrapTrpcCall((c) =>
              c.conversation.getByFile.query({ sourceFile }),
            )(client).pipe(
              Effect.catchTag("ApiError", (error) => {
                if (error.status === 404) {
                  return Effect.succeed(null);
                }
                return Effect.fail(error);
              }),
            );

            if (existing) {
              return existing;
            }

            // Create new if not found
            return yield* wrapTrpcCall((c) =>
              c.conversation.create.mutate({ sourceFile }),
            )(client);
          }),

        /**
         * Get conversation by ID
         */
        getConversation: (id: string) =>
          Effect.gen(function* () {
            const client = yield* trpcClientService.getClient();
            return yield* wrapTrpcCall((c) =>
              c.conversation.getById.query({ id }),
            )(client);
          }),

        /**
         * Get all messages for a conversation
         */
        getMessages: (conversationId: string) =>
          Effect.gen(function* () {
            const client = yield* trpcClientService.getClient();
            return yield* wrapTrpcCall((c) =>
              c.conversation.getMessages.query({ conversationId }),
            )(client);
          }),

        /**
         * Add a message to a conversation
         */
        addMessage: (
          conversationId: string,
          role: "user" | "assistant" | "system",
          content: string,
          toolCalls?: unknown,
        ) =>
          Effect.gen(function* () {
            const client = yield* trpcClientService.getClient();
            return yield* wrapTrpcCall((c) =>
              c.conversation.addMessage.mutate({
                conversationId,
                role,
                content,
                toolCalls,
              }),
            )(client);
          }),

        /**
         * Update conversation status
         */
        updateStatus: (
          conversationId: string,
          status: "planning" | "confirmed" | "completed",
        ) =>
          Effect.gen(function* () {
            const client = yield* trpcClientService.getClient();
            return yield* wrapTrpcCall((c) =>
              c.conversation.updateStatus.mutate({
                id: conversationId,
                status,
              }),
            )(client);
          }),

        /**
         * List all conversations for the user
         */
        listConversations: () =>
          Effect.gen(function* () {
            const client = yield* trpcClientService.getClient();
            return yield* wrapTrpcCall((c) => c.conversation.list.query())(
              client,
            );
          }),
      };
    }),
    // No dependencies - allows test injection via Layer.provide()
  },
) {}

/**
 * Production layer with all dependencies composed.
 * Use this in production code; use ConversationService.Default in tests with mocked deps.
 */
/**
 * ConversationService depends on ConfigService which has context-specific deps.
 * Use ConversationService.Default directly - dependencies provided at composition site.
 */
export const ConversationServiceLive = ConversationService.Default;

export type { ApiError, NetworkError, AuthTokenMissingError };
