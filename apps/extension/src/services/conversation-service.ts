import { Data, Effect, Layer } from "effect";
import { ConfigService } from "./config-service.js";
import { parseTrpcError } from "../lib/error-messages.js";

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
       * Helper to make tRPC API calls
       * tRPC HTTP API uses format: /api/trpc/[procedure]?input=... for queries
       * and POST with JSON body for mutations
       */
      const callTrpcQuery = <T>(procedure: string, input: unknown) =>
        Effect.gen(function* () {
          const authToken = yield* getAuthToken();
          const backendUrl = "http://localhost:3000";

          const response = yield* Effect.tryPromise({
            try: async () => {
              const inputStr = encodeURIComponent(JSON.stringify(input));
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
            const errorText = yield* Effect.promise(() => response.text());
            const userMessage = parseTrpcError(errorText, response.status);
            return yield* Effect.fail(
              new ApiError({
                message: userMessage,
                status: response.status,
                cause: errorText,
              }),
            );
          }

          const data = (yield* Effect.promise(() => response.json())) as {
            result?: { data?: T };
          };
          if (data.result?.data !== undefined) {
            return data.result.data;
          }

          return yield* Effect.fail(
            new ApiError({
              message: "Invalid response format from API",
            }),
          );
        });

      const callTrpcMutation = <T>(procedure: string, input: unknown) =>
        Effect.gen(function* () {
          const authToken = yield* getAuthToken();
          const backendUrl = "http://localhost:3000";

          const response = yield* Effect.tryPromise({
            try: async () => {
              const url = `${backendUrl}/api/trpc/${procedure}`;
              const body = JSON.stringify(input);

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
            const errorText = yield* Effect.promise(() => response.text());
            const userMessage = parseTrpcError(errorText, response.status);
            return yield* Effect.fail(
              new ApiError({
                message: userMessage,
                status: response.status,
                cause: errorText,
              }),
            );
          }

          const data = (yield* Effect.promise(() => response.json())) as {
            result?: { data?: T };
          };
          if (data.result?.data !== undefined) {
            return data.result.data;
          }

          return yield* Effect.fail(
            new ApiError({
              message: "Invalid response format from API",
            }),
          );
        });

      return {
        /**
         * Create or get existing conversation for a source file
         */
        getOrCreateConversation: (sourceFile: string) =>
          Effect.gen(function* () {
            // First try to get existing
            const existing = yield* callTrpcQuery<Conversation | null>(
              "conversation.getByFile",
              { sourceFile },
            ).pipe(
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
            return yield* callTrpcMutation<Conversation>(
              "conversation.create",
              { sourceFile },
            );
          }),

        /**
         * Get conversation by ID
         */
        getConversation: (id: string) =>
          callTrpcQuery<Conversation>("conversation.getById", { id }),

        /**
         * Get all messages for a conversation
         */
        getMessages: (conversationId: string) =>
          callTrpcQuery<Message[]>("conversation.getMessages", {
            conversationId,
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
          callTrpcMutation<Message>("conversation.addMessage", {
            conversationId,
            role,
            content,
            toolCalls,
          }),

        /**
         * Update conversation status
         */
        updateStatus: (
          conversationId: string,
          status: "planning" | "confirmed" | "completed",
        ) =>
          callTrpcMutation<Conversation>("conversation.updateStatus", {
            id: conversationId,
            status,
          }),

        /**
         * List all conversations for the user
         */
        listConversations: () =>
          callTrpcQuery<Conversation[]>("conversation.list", {}),
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
