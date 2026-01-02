import { createRouter, type RpcSubscriptionMessage } from "@clive/webview-rpc";
import { Effect, Runtime } from "effect";
import * as vscode from "vscode";
import { z } from "zod";
import { TestingAgent } from "../../services/ai-agent/testing-agent.js";
import { ConversationService } from "../../services/conversation-service.js";
import { createAgentServiceLayer } from "../../services/layer-factory.js";
import { APPROVAL } from "../../services/ai-agent/hitl-utils.js";
import { handleSubscriptionMessage } from "../handler.js";
import type { RpcContext } from "../context.js";
import {
  acceptEditAsync,
  rejectEditAsync,
  getPendingEditServiceInstance,
} from "../../services/pending-edit-service.js";

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
 * Agents router - handles AI agent operations
 */
export const agentsRouter = {
  /**
   * Plan and execute tests
   * Subscription that yields proposals (auto-approved) and can write test files
   */
  planTests: procedure
    .input(
      z.object({
        files: z.array(z.string()),
        branchName: z.string(),
        baseBranch: z.string().default("main"),
        conversationType: z.enum(["branch", "uncommitted"]).default("branch"),
        commitHash: z.string().optional(), // For uncommitted conversations
        mode: z.enum(["plan", "act"]).optional().default("plan"), // Agent mode: plan or act
        planFilePath: z.string().optional(), // Path to approved test plan file (for act mode context)
        conversationHistory: z
          .array(
            z.object({
              role: z.enum(["user", "assistant", "system"]),
              content: z.string(),
            }),
          )
          .optional(),
      }),
    )
    .subscription(async function* ({
      input,
      ctx,
      signal,
      onProgress,
      subscriptionId,
    }: {
      input: {
        files: string[];
        branchName: string;
        baseBranch: string;
        conversationType: "branch" | "uncommitted";
        commitHash?: string;
        mode?: "plan" | "act";
        planFilePath?: string;
        conversationHistory?: Array<{
          role: "user" | "assistant" | "system";
          content: string;
        }>;
      };
      ctx: RpcContext;
      signal: AbortSignal;
      onProgress?: (data: unknown) => void;
      waitForApproval?: (toolCallId: string) => Promise<unknown>;
      subscriptionId?: string;
    }) {
      const serviceLayer = getAgentLayer(ctx);

      const result = await Runtime.runPromise(runtime)(
        Effect.gen(function* () {
          const requestId = `plan-${Date.now()}-${Math.random().toString(36).substring(7)}`;
          const startTime = Date.now();

          yield* Effect.logDebug(
            `[RpcRouter:${requestId}] ========== Starting test generation with HITL ==========`,
          );
          yield* Effect.logDebug(
            `[RpcRouter:${requestId}] Files to process: ${input.files.length}`,
          );

          const testAgent = yield* TestingAgent;
          const isConfigured = yield* testAgent.isConfigured();

          if (!isConfigured) {
            yield* Effect.logDebug(
              `[RpcRouter:${requestId}] ERROR: Not configured, aborting`,
            );
            yield* Effect.promise(() =>
              vscode.window.showErrorMessage(
                "AI Gateway token not available. Please log in to authenticate.",
              ),
            );
            return {
              executions: [],
              error: "API key not configured",
            };
          }

          if (input.files.length === 0) {
            yield* Effect.logDebug(
              `[RpcRouter:${requestId}] ERROR: No files provided`,
            );
            return {
              executions: [],
              error: "No files provided",
            };
          }

          vscode.window.showInformationMessage(
            `Planning Cypress tests for ${input.files.length} file(s)...`,
          );

          // Create conversation BEFORE running agent so it exists when proposals stream
          const conversationService = yield* ConversationService;

          // Get or create branch conversation
          const conversation = yield* conversationService
            .getOrCreateBranchConversation(
              input.branchName,
              input.baseBranch,
              input.files,
              input.conversationType,
              input.commitHash,
            )
            .pipe(Effect.catchAll(() => Effect.succeed(null)));

          const testingAgent = yield* TestingAgent;

          // Progress callback that yields to client
          const progressCallback = (status: string, message: string) => {
            if (onProgress) {
              // Check if this is a special event type (JSON)
              if (
                status === "proposal" ||
                status === "plan_file_created" ||
                status === "content_streamed" ||
                status === "tool-call" ||
                status === "tool-result" ||
                status === "tool-output-streaming" ||
                status === "tool-approval-requested" ||
                status === "usage" ||
                status === "reasoning" ||
                status === "plan-content-streaming" ||
                status === "file-created" ||
                status === "file-output-streaming"
              ) {
                try {
                  const eventData = JSON.parse(message);
                  onProgress({
                    ...eventData,
                    subscriptionId: subscriptionId || "",
                  });
                } catch {
                  // Not JSON, send as regular progress
                  onProgress({ type: "progress", status, message });
                }
              } else {
                onProgress({ type: "progress", status, message });
              }
            }
          };

          // Use planAndExecuteTests - proposals auto-approve
          // File edits are non-blocking and registered with PendingEditService
          const result = yield* testingAgent.planAndExecuteTests(input.files, {
            mode: input.mode || "plan",
            planFilePath: input.planFilePath, // Pass plan file path for act mode context
            conversationHistory: input.conversationHistory,
            outputChannel: ctx.outputChannel,
            progressCallback,
            signal,
          });

          // Persist conversation messages to database

          if (conversation && result.response) {
            // Build context object with full data
            const context = {
              executions: result.executions,
              timestamp: new Date().toISOString(),
            };

            // Save assistant message with context in toolCalls
            yield* conversationService
              .addMessage(
                conversation.id,
                "assistant",
                result.response,
                context,
              )
              .pipe(Effect.catchAll(() => Effect.void));

            // Update conversation status
            const hasExecutions =
              result.executions && result.executions.length > 0;
            yield* conversationService
              .updateStatus(
                conversation.id,
                hasExecutions ? "completed" : "planning",
              )
              .pipe(Effect.catchAll(() => Effect.void));

            yield* Effect.logDebug(
              `[RpcRouter:${requestId}] Persisted conversation for branch ${input.branchName}`,
            );
          }

          const totalDuration = Date.now() - startTime;
          yield* Effect.logDebug(
            `[RpcRouter:${requestId}] ========== Completed in ${totalDuration}ms ==========`,
          );

          return result;
        }).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
              const isCancellation = errorMessage.includes("cancelled");

              yield* Effect.logDebug(
                isCancellation
                  ? `[RpcRouter] Planning cancelled by user`
                  : `[RpcRouter] Planning failed: ${errorMessage}`,
              );

              // Don't show error message for user-initiated cancellations
              if (!isCancellation) {
                yield* Effect.promise(() =>
                  vscode.window.showErrorMessage(
                    `Failed to plan tests: ${errorMessage}`,
                  ),
                );
              }

              return {
                executions: [],
                error: isCancellation ? "Cancelled by user" : errorMessage,
              };
            }),
          ),
          Effect.provide(serviceLayer),
        ),
      );

      // Yield proposals as they come in (handled by progressCallback)
      // Final result is returned below

      return {
        executions: result.executions || [],
        taskCompleted: "taskCompleted" in result ? result.taskCompleted : false,
      };
    }),

  /**
   * Cancel a running test
   */
  cancelTest: procedure
    .input(
      z.object({
        testId: z.string(),
      }),
    )
    .mutation(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[AgentsRouter] Cancelling test: ${input.testId}`,
        );

        // Note: AbortController tracking would need to be managed at a higher level
        // For now, we'll return a success response indicating cancellation was requested
        const isFilePath =
          input.testId.includes("/") || input.testId.includes("\\");

        return {
          testId: input.testId,
          isFilePath,
          cancelled: true,
        };
      }).pipe(provideAgentLayer(ctx)),
    ),

  /**
   * Preview test diff
   */
  previewDiff: procedure
    .input(
      z.object({
        test: z.object({
          id: z.string(),
          targetTestPath: z.string(),
          proposedContent: z.string(),
          existingContent: z.string().optional(),
          isUpdate: z.boolean(),
        }),
      }),
    )
    .mutation(({ input, ctx }) =>
      Effect.tryPromise({
        try: () => {
          const proposedUri = ctx.diffProvider.storeContent(
            input.test.id,
            input.test.proposedContent,
            "proposed",
          );

          let originalUri: vscode.Uri;
          if (input.test.isUpdate && input.test.existingContent) {
            originalUri = ctx.diffProvider.storeContent(
              input.test.id,
              input.test.existingContent,
              "existing",
            );
          } else {
            originalUri = ctx.diffProvider.storeContent(
              input.test.id,
              "",
              "empty",
            );
          }

          return vscode.commands.executeCommand(
            "vscode.diff",
            originalUri,
            proposedUri,
            `${input.test.targetTestPath} (Preview)`,
            {
              viewColumn: vscode.ViewColumn.Active,
            },
          );
        },
        catch: (error) =>
          new Error(error instanceof Error ? error.message : "Unknown error"),
      }).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            yield* Effect.promise(() =>
              vscode.window.showErrorMessage(
                `Failed to preview test diff: ${errorMessage}`,
              ),
            );
            return yield* Effect.fail(new Error(errorMessage));
          }),
        ),
      ),
    ),

  /**
   * Approve or reject a tool call
   * Used by the frontend to respond to HITL approval requests
   */
  approveToolCall: procedure
    .input(
      z.object({
        subscriptionId: z.string(),
        toolCallId: z.string(),
        approved: z.boolean(),
      }),
    )
    .mutation(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[AgentsRouter] Tool call ${input.approved ? "approved" : "rejected"}: ${input.toolCallId}`,
        );

        // Create subscription message to resolve the pending approval
        const message: RpcSubscriptionMessage = {
          subscriptionId: input.subscriptionId,
          type: "approval",
          toolCallId: input.toolCallId,
          data: input.approved ? APPROVAL.YES : APPROVAL.NO,
        };

        // Send the approval message to resolve the pending promise
        const handled = handleSubscriptionMessage(message, ctx);

        if (!handled) {
          yield* Effect.logDebug(
            `[AgentsRouter] No pending approval found for subscription: ${input.subscriptionId}, toolCallId: ${input.toolCallId}`,
          );
        }

        return { success: handled };
      }),
    ),

  /**
   * Accept a pending file edit (keep current changes)
   * Used by the webview to accept AI-generated file changes
   */
  acceptEdit: procedure
    .input(
      z.object({
        filePath: z.string(),
      }),
    )
    .mutation(({ input }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[AgentsRouter] Accepting edit for: ${input.filePath}`,
        );

        const accepted = yield* Effect.tryPromise({
          try: () => acceptEditAsync(input.filePath),
          catch: (error) =>
            new Error(
              `Failed to accept edit: ${error instanceof Error ? error.message : "Unknown error"}`,
            ),
        });

        if (accepted) {
          // Fire-and-forget notification (don't await - it hangs until dismissed)
          vscode.window.showInformationMessage(
            `Changes accepted for ${vscode.workspace.asRelativePath(input.filePath)}`,
          );
        }

        return { success: accepted };
      }),
    ),

  /**
   * Reject a pending file edit (revert to original)
   * Used by the webview to reject AI-generated file changes
   */
  rejectEdit: procedure
    .input(
      z.object({
        filePath: z.string(),
      }),
    )
    .mutation(({ input }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[AgentsRouter] Rejecting edit for: ${input.filePath}`,
        );

        const rejected = yield* Effect.tryPromise({
          try: () => rejectEditAsync(input.filePath),
          catch: (error) =>
            new Error(
              `Failed to reject edit: ${error instanceof Error ? error.message : "Unknown error"}`,
            ),
        });

        if (rejected) {
          // Fire-and-forget notification (don't await - it hangs until dismissed)
          vscode.window.showInformationMessage(
            `Changes reverted for ${vscode.workspace.asRelativePath(input.filePath)}`,
          );
        }

        return { success: rejected };
      }),
    ),

  /**
   * Get list of files with pending edits
   * Used by the webview to show pending edit status
   */
  getPendingEdits: procedure.input(z.void()).query(() =>
    Effect.gen(function* () {
      try {
        const service = getPendingEditServiceInstance();
        const paths = yield* service.getPendingEditPaths();
        return { paths };
      } catch {
        // Service not initialized yet
        return { paths: [] };
      }
    }),
  ),
};
