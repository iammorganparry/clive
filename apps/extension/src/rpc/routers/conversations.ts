import { Effect, Runtime } from "effect";
import { z } from "zod";
import { createRouter } from "@clive/webview-rpc";
import { PlanningAgent } from "../../services/ai-agent/planning-agent.js";
import { ConversationService as ConversationServiceEffect } from "../../services/conversation-service.js";
import { ErrorCode, getErrorMessage } from "../../lib/error-messages.js";
import { createAgentServiceLayer } from "../../services/layer-factory.js";
import type { RpcContext } from "../context.js";
import type { Message } from "../../services/conversation-service.js";

const { procedure } = createRouter<RpcContext>();
const runtime = Runtime.defaultRuntime;

/**
 * Get the agent layer - uses override if provided, otherwise creates default.
 * Returns a function that can be used with Effect.provide in a pipe.
 */
const provideAgentLayer = (ctx: RpcContext) => {
  const layer = ctx.agentLayer ?? createAgentServiceLayer(ctx.layerContext);
  return <A, E>(effect: Effect.Effect<A, E, unknown>) =>
    effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>;
};

/**
 * Get the agent layer directly for use in subscriptions
 */
const getAgentLayer = (ctx: RpcContext) =>
  ctx.agentLayer ?? createAgentServiceLayer(ctx.layerContext);

/**
 * Conversations router - handles chat/conversation operations
 */
export const conversationsRouter = {
  /**
   * Start a conversation for a source file
   */
  start: procedure
    .input(
      z.object({
        sourceFile: z.string(),
      }),
    )
    .mutation(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[ConversationsRouter] Starting conversation for: ${input.sourceFile}`,
        );
        const conversationService = yield* ConversationServiceEffect;

        // Get or create conversation
        const conversation = yield* conversationService
          .getOrCreateConversation(input.sourceFile)
          .pipe(
            Effect.catchTag("ApiError", (error) =>
              Effect.gen(function* () {
                yield* Effect.logDebug(
                  `[ConversationsRouter] Failed to start conversation: ${error.message}`,
                );
                return yield* Effect.fail(error);
              }),
            ),
            Effect.catchTag("NetworkError", (error) =>
              Effect.gen(function* () {
                yield* Effect.logDebug(
                  `[ConversationsRouter] Network error starting conversation: ${error.message}`,
                );
                return yield* Effect.fail(
                  new Error(getErrorMessage(ErrorCode.NETWORK)),
                );
              }),
            ),
            Effect.catchTag("AuthTokenMissingError", (error) =>
              Effect.gen(function* () {
                yield* Effect.logDebug(
                  `[ConversationsRouter] Auth error starting conversation: ${error.message}`,
                );
                return yield* Effect.fail(
                  new Error(getErrorMessage(ErrorCode.AUTH_REQUIRED)),
                );
              }),
            ),
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                const errorMessage =
                  error instanceof Error ? error.message : "Unknown error";
                yield* Effect.logDebug(
                  `[ConversationsRouter] Failed to start conversation: ${errorMessage}`,
                );
                return yield* Effect.fail(
                  new Error(getErrorMessage(ErrorCode.SERVER_ERROR)),
                );
              }),
            ),
          );

        // Load existing messages
        const messages = yield* conversationService
          .getMessages(conversation.id)
          .pipe(
            Effect.catchTag("ApiError", (_error) =>
              Effect.sync(() => {
                return [] as Message[];
              }),
            ),
            Effect.catchAll(() => Effect.succeed([] as Message[])),
          );

        return {
          conversationId: conversation.id,
          sourceFile: conversation.sourceFile,
          messages: messages.map((msg: Message) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            createdAt: msg.createdAt.toISOString(),
          })),
        };
      }).pipe(provideAgentLayer(ctx)),
    ),

  /**
   * Send a chat message and stream the response
   */
  sendMessage: procedure
    .input(
      z.object({
        conversationId: z.string(),
        sourceFile: z.string(),
        message: z.string(),
      }),
    )
    .subscription(async function* ({
      input,
      ctx,
      signal: _signal,
      onProgress,
    }: {
      input: {
        conversationId: string;
        sourceFile: string;
        message: string;
      };
      ctx: RpcContext;
      signal: AbortSignal;
      onProgress?: (data: unknown) => void;
    }) {
      const serviceLayer = getAgentLayer(ctx);

      const result = await Runtime.runPromise(runtime)(
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[ConversationsRouter] Sending chat message to conversation: ${input.conversationId}`,
          );
          const conversationService = yield* ConversationServiceEffect;
          const planningAgent = yield* PlanningAgent;

          // Add user message to conversation
          yield* conversationService
            .addMessage(input.conversationId, "user", input.message)
            .pipe(
              Effect.catchTag("ApiError", (error) =>
                Effect.gen(function* () {
                  yield* Effect.logDebug(
                    `[ConversationsRouter] Failed to save user message: ${error.message}`,
                  );
                  return yield* Effect.fail(error);
                }),
              ),
              Effect.catchTag("NetworkError", (error) =>
                Effect.gen(function* () {
                  yield* Effect.logDebug(
                    `[ConversationsRouter] Network error saving message: ${error.message}`,
                  );
                  return yield* Effect.fail(
                    new Error(getErrorMessage(ErrorCode.NETWORK)),
                  );
                }),
              ),
              Effect.catchAll((error) =>
                Effect.gen(function* () {
                  yield* Effect.logDebug(
                    `[ConversationsRouter] Failed to save user message: ${error instanceof Error ? error.message : "Unknown error"}`,
                  );
                  // Continue even if saving fails - don't block the conversation
                }),
              ),
            );

          // Get conversation history
          const history = yield* conversationService
            .getMessages(input.conversationId)
            .pipe(
              Effect.catchTag("ApiError", (_error) =>
                Effect.sync(() => {
                  return [] as Message[];
                }),
              ),
              Effect.catchAll(() => Effect.succeed([] as Message[])),
            );

          // Convert to planning agent format
          const conversationHistory = history.map((msg: Message) => ({
            role: msg.role as "user" | "assistant" | "system",
            content: msg.content,
          }));

          // Call planning agent with history using new API
          const result = yield* planningAgent
            .planTest(input.sourceFile, {
              conversationHistory,
              outputChannel: ctx.outputChannel,
            })
            .pipe(
              Effect.catchAll((error) =>
                Effect.gen(function* () {
                  const errorMessage =
                    error instanceof Error ? error.message : "Unknown error";
                  yield* Effect.logDebug(
                    `[ConversationsRouter] Planning agent error: ${errorMessage}`,
                  );
                  return yield* Effect.fail(
                    new Error(
                      `Failed to process your message: ${errorMessage}`,
                    ),
                  );
                }),
              ),
            );

          // Save assistant response
          const assistantResponse =
            (result as { response?: string }).response || "";
          if (assistantResponse) {
            yield* conversationService
              .addMessage(input.conversationId, "assistant", assistantResponse)
              .pipe(
                Effect.catchAll((error) =>
                  Effect.gen(function* () {
                    yield* Effect.logDebug(
                      `[ConversationsRouter] Failed to save assistant message: ${error instanceof Error ? error.message : "Unknown error"}`,
                    );
                  }),
                ),
              );
          }

          return {
            content: assistantResponse,
            response: assistantResponse,
            tests: (result as { tests?: unknown[] }).tests || [],
          };
        }).pipe(
          Effect.provide(serviceLayer),
          Effect.mapError((error) =>
            error instanceof Error ? error : new Error(String(error)),
          ),
        ),
      );

      // Stream the response
      if (onProgress) {
        onProgress({
          type: "message",
          content: result.content,
        });
      }
      yield {
        type: "data" as const,
        data: {
          type: "message",
          content: result.content,
        },
      };

      // If there are tests, also send them
      if (result.tests && result.tests.length > 0) {
        if (onProgress) {
          onProgress({
            type: "tests",
            tests: result.tests,
          });
        }
        yield {
          type: "data" as const,
          data: {
            type: "tests",
            tests: result.tests,
          },
        };
      }

      // Return final result
      return result;
    }),

  /**
   * Get conversation history
   */
  getHistory: procedure
    .input(
      z.object({
        sourceFile: z.string(),
      }),
    )
    .query(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[ConversationsRouter] Loading conversation for: ${input.sourceFile}`,
        );
        const conversationService = yield* ConversationServiceEffect;

        const conversation = yield* conversationService
          .getOrCreateConversation(input.sourceFile)
          .pipe(
            Effect.catchTag("ApiError", (_error) =>
              Effect.sync(() => {
                return null;
              }),
            ),
            Effect.catchTag("NetworkError", (_error) =>
              Effect.sync(() => {
                return null;
              }),
            ),
            Effect.catchAll(() => Effect.succeed(null)),
          );

        if (!conversation) {
          return {
            conversationId: null,
            messages: [],
          };
        }

        const messages = yield* conversationService
          .getMessages(conversation.id)
          .pipe(
            Effect.catchTag("ApiError", (_error) =>
              Effect.sync(() => {
                return [] as Message[];
              }),
            ),
            Effect.catchAll(() => Effect.succeed([] as Message[])),
          );

        return {
          conversationId: conversation.id,
          messages: messages.map((msg: Message) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            createdAt: msg.createdAt.toISOString(),
          })),
        };
      }).pipe(provideAgentLayer(ctx)),
    ),
};
