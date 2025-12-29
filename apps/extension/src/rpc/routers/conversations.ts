import { Effect, Runtime } from "effect";
import { z } from "zod";
import { createRouter } from "@clive/webview-rpc";
import { TestingAgent } from "../../services/ai-agent/testing-agent.js";
import { ConversationService as ConversationServiceEffect } from "../../services/conversation-service.js";
import { ErrorCode, getErrorMessage } from "../../lib/error-messages.js";
import { createAgentServiceLayer } from "../../services/layer-factory.js";
import { APPROVAL } from "../../services/ai-agent/hitl-utils.js";
import type { RpcContext } from "../context.js";
import type {
  Message,
  Conversation,
} from "../../services/conversation-service.js";

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
 * Global approval state for conversations
 * Maps conversationId + toolCallId to approval promise resolvers
 */
const conversationApprovals = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

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
                return yield* Effect.fail(
                  new Error(getErrorMessage(ErrorCode.SERVER_ERROR)),
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
          );

        // Load existing messages
        const messages = yield* conversationService
          .getMessages(conversation.id)
          .pipe(Effect.catchAll(() => Effect.succeed([] as Message[])));

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
          const testingAgent = yield* TestingAgent;

          // Add user message to conversation
          yield* conversationService
            .addMessage(input.conversationId, "user", input.message)
            .pipe(
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
            .pipe(Effect.catchAll(() => Effect.succeed([] as Message[])));

          // Convert to planning agent format
          const conversationHistory = history.map((msg: Message) => ({
            role: msg.role as "user" | "assistant" | "system",
            content: msg.content,
          }));

          // Call unified agent - proposals auto-approve, no blocking needed
          const result = yield* testingAgent
            .planAndExecuteTests(input.sourceFile, {
              conversationHistory,
              outputChannel: ctx.outputChannel,
              progressCallback: (status, message) => {
                // Forward progress to frontend
                if (onProgress) {
                  // Parse JSON events that need special handling
                  if (
                    status === "tool-call" ||
                    status === "tool-result" ||
                    status === "content_streamed" ||
                    status === "proposal" ||
                    status === "reasoning"
                  ) {
                    try {
                      const eventData = JSON.parse(message);
                      // Forward parsed event directly - it already has the correct structure
                      onProgress(eventData);
                      return;
                    } catch {
                      // Not valid JSON, continue to default handling
                    }
                  }

                  // For generic progress events, wrap with type prefix
                  onProgress({ type: "progress", status, message });
                }
              },
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
   * Handle approval/rejection for conversation proposals
   */
  approveProposal: procedure
    .input(
      z.object({
        conversationId: z.string(),
        toolCallId: z.string(),
        approved: z.boolean(),
      }),
    )
    .mutation(({ input }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[ConversationsRouter] Proposal ${input.approved ? "approved" : "rejected"}: ${input.toolCallId}`,
        );

        const approvalKey = `${input.conversationId}-${input.toolCallId}`;
        const approvalPromise = conversationApprovals.get(approvalKey);

        if (approvalPromise) {
          if (input.approved) {
            approvalPromise.resolve(APPROVAL.YES);
          } else {
            approvalPromise.resolve(APPROVAL.NO);
          }
          conversationApprovals.delete(approvalKey);
        } else {
          yield* Effect.logDebug(
            `[ConversationsRouter] No pending approval found for: ${approvalKey}`,
          );
        }

        return { success: true };
      }),
    ),

  /**
   * Check if conversation exists for a source file
   */
  hasConversation: procedure
    .input(z.object({ sourceFile: z.string() }))
    .query(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[ConversationsRouter] Checking conversation for: ${input.sourceFile}`,
        );
        const conversationService = yield* ConversationServiceEffect;

        // getConversationByFile returns null when no conversation exists (not an error)
        const conversation = yield* conversationService.getConversationByFile(
          input.sourceFile,
        );

        if (!conversation) {
          return { exists: false, messageCount: 0, status: null };
        }

        // Get messages - empty array is valid for new conversations
        const messages = yield* conversationService.getMessages(
          conversation.id,
        );

        return {
          exists: true,
          messageCount: messages.length,
          status: conversation.status,
        };
      }).pipe(provideAgentLayer(ctx)),
    ),

  /**
   * Batch check if conversations exist for multiple source files
   */
  hasConversationsBatch: procedure
    .input(z.object({ sourceFiles: z.array(z.string()) }))
    .query(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[ConversationsRouter] Batch checking conversations for ${input.sourceFiles.length} files`,
        );
        const conversationService = yield* ConversationServiceEffect;
        const results: Record<
          string,
          { exists: boolean; messageCount: number; status: string | null }
        > = {};

        for (const sourceFile of input.sourceFiles) {
          const conversation =
            yield* conversationService.getConversationByFile(sourceFile);

          if (!conversation) {
            results[sourceFile] = {
              exists: false,
              messageCount: 0,
              status: null,
            };
          } else {
            const messages = yield* conversationService.getMessages(
              conversation.id,
            );
            results[sourceFile] = {
              exists: true,
              messageCount: messages.length,
              status: conversation.status,
            };
          }
        }

        return results;
      }).pipe(provideAgentLayer(ctx)),
    ),

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
            Effect.catchTag("ApiError", () => Effect.succeed(null)),
            Effect.catchTag("AuthTokenMissingError", () =>
              Effect.succeed(null),
            ),
          );

        if (!conversation) {
          return {
            conversationId: null,
            messages: [],
          };
        }

        const messages = yield* conversationService
          .getMessages(conversation.id)
          .pipe(Effect.catchAll(() => Effect.succeed([] as Message[])));

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

  /**
   * Start or resume a branch conversation
   */
  startBranch: procedure
    .input(
      z.object({
        branchName: z.string(),
        baseBranch: z.string().default("main"),
        sourceFiles: z.array(z.string()),
        conversationType: z.enum(["branch", "uncommitted"]).default("branch"),
        commitHash: z.string().optional(), // For uncommitted conversations
      }),
    )
    .mutation(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[ConversationsRouter] Starting branch conversation: ${input.branchName}, type: ${input.conversationType}`,
        );
        const conversationService = yield* ConversationServiceEffect;

        // Get or create conversation
        const conversation: Conversation = yield* conversationService
          .getOrCreateBranchConversation(
            input.branchName,
            input.baseBranch,
            input.sourceFiles,
            input.conversationType,
            input.commitHash,
          )
          .pipe(
            Effect.catchTag("ApiError", (error) =>
              Effect.gen(function* () {
                yield* Effect.logDebug(
                  `[ConversationsRouter] Failed to start branch conversation: ${error.message}`,
                );
                return yield* Effect.fail(
                  new Error(getErrorMessage(ErrorCode.SERVER_ERROR)),
                );
              }),
            ),
            Effect.catchTag("AuthTokenMissingError", (error) =>
              Effect.gen(function* () {
                yield* Effect.logDebug(
                  `[ConversationsRouter] Auth error starting branch conversation: ${error.message}`,
                );
                return yield* Effect.fail(
                  new Error(getErrorMessage(ErrorCode.AUTH_REQUIRED)),
                );
              }),
            ),
          );

        // Load existing messages
        const messages = yield* conversationService
          .getMessages(conversation.id)
          .pipe(Effect.catchAll(() => Effect.succeed([] as Message[])));

        return {
          conversationId: conversation.id,
          branchName: conversation.branchName,
          baseBranch: conversation.baseBranch,
          sourceFiles: conversation.sourceFiles
            ? JSON.parse(conversation.sourceFiles)
            : [],
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
   * Check if conversation exists for a branch
   */
  hasBranchConversation: procedure
    .input(
      z.object({
        branchName: z.string(),
        baseBranch: z.string().default("main"),
        conversationType: z.enum(["branch", "uncommitted"]),
        commitHash: z.string().optional(), // For uncommitted
      }),
    )
    .query(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[ConversationsRouter] Checking branch conversation: ${input.branchName}, type: ${input.conversationType}`,
        );
        const conversationService = yield* ConversationServiceEffect;

        // getConversationByBranch returns null when no conversation exists (not an error)
        const conversation = yield* conversationService.getConversationByBranch(
          input.branchName,
          input.baseBranch,
          input.conversationType,
          input.commitHash,
        );

        if (!conversation) {
          return { exists: false, messageCount: 0, status: null };
        }

        // Get messages - empty array is valid for new conversations
        const messages = yield* conversationService.getMessages(
          conversation.id,
        );

        return {
          exists: true,
          messageCount: messages.length,
          status: conversation.status,
        };
      }).pipe(provideAgentLayer(ctx)),
    ),

  /**
   * Get branch conversation history
   */
  getBranchHistory: procedure
    .input(
      z.object({
        branchName: z.string(),
        baseBranch: z.string().default("main"),
        conversationType: z.enum(["branch", "uncommitted"]).default("branch"),
        commitHash: z.string().optional(), // For uncommitted conversations
      }),
    )
    .query(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[ConversationsRouter] Loading branch conversation: ${input.branchName}, type: ${input.conversationType}`,
        );
        const conversationService = yield* ConversationServiceEffect;

        const conversation = yield* conversationService.getConversationByBranch(
          input.branchName,
          input.baseBranch,
          input.conversationType,
          input.commitHash,
        );

        if (!conversation) {
          return {
            conversationId: null,
            messages: [],
          };
        }

        const messages = yield* conversationService
          .getMessages(conversation.id)
          .pipe(Effect.catchAll(() => Effect.succeed([] as Message[])));

        return {
          conversationId: conversation.id,
          messages: messages.map((msg: Message) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            toolCalls: msg.toolCalls,
            createdAt: msg.createdAt.toISOString(),
          })),
        };
      }).pipe(provideAgentLayer(ctx)),
    ),
};
