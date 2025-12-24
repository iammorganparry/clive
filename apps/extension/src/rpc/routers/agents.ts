import { Effect, Runtime } from "effect";
import { z } from "zod";
import * as vscode from "vscode";
import { createRouter } from "@clive/webview-rpc";
import { CypressTestAgent } from "../../services/ai-agent/agent.js";
import { TestingAgent } from "../../services/ai-agent/testing-agent.js";
import { ConversationService } from "../../services/conversation-service.js";
import { createAgentServiceLayer } from "../../services/layer-factory.js";
import type { RpcContext } from "../context.js";
import type { ProposedTest } from "../../services/ai-agent/types.js";

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
   * Plan and execute tests with human-in-the-loop approval
   * Subscription that yields proposals and waits for approval before writing files
   */
  planTests: procedure
    .input(
      z.object({
        files: z.array(z.string()),
      }),
    )
    .subscription(async function* ({
      input,
      ctx,
      signal,
      onProgress,
      waitForApproval,
      subscriptionId,
    }: {
      input: { files: string[] };
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

          const testAgent = yield* CypressTestAgent;
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
              proposals: [] as ProposedTest[],
              executions: [],
              error: "API key not configured",
            };
          }

          if (input.files.length === 0) {
            yield* Effect.logDebug(
              `[RpcRouter:${requestId}] ERROR: No files provided`,
            );
            return {
              proposals: [] as ProposedTest[],
              executions: [],
              error: "No files provided",
            };
          }

          vscode.window.showInformationMessage(
            `Planning Cypress tests for ${input.files.length} file(s)...`,
          );

          const testingAgent = yield* TestingAgent;

          // Progress callback that yields to client
          const progressCallback = (status: string, message: string) => {
            if (onProgress) {
              // Check if this is a special event type (JSON)
              if (
                status === "proposal" ||
                status === "plan_file_created" ||
                status === "content_streamed"
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

          // Use planAndExecuteTests with HITL
          const result = yield* testingAgent.planAndExecuteTests(input.files, {
            outputChannel: ctx.outputChannel,
            progressCallback,
            waitForApproval: waitForApproval
              ? async (toolCallId: string) => {
                  return await waitForApproval(toolCallId);
                }
              : undefined,
            signal,
          });

          // Persist conversation to database
          const conversationService = yield* ConversationService;
          const sourceFile = input.files[0];

          // Get or create conversation for this file
          const conversation = yield* conversationService
            .getOrCreateConversation(sourceFile)
            .pipe(Effect.catchAll(() => Effect.succeed(null)));

          if (conversation && result.response) {
            // Build context object with full data
            const context = {
              proposals: result.proposals,
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
              `[RpcRouter:${requestId}] Persisted conversation for ${sourceFile}`,
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
                proposals: [] as ProposedTest[],
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
        proposals: result.proposals || [],
        executions: result.executions || [],
      };
    }),

  /**
   * Generate test for a single file (subscription with progress updates)
   */
  generateTest: procedure
    .input(
      z.object({
        sourceFilePath: z.string(),
      }),
    )
    .subscription(async function* ({
      input,
      ctx,
      signal,
      onProgress,
    }: {
      input: { sourceFilePath: string };
      ctx: RpcContext;
      signal: AbortSignal;
      onProgress?: (data: unknown) => void;
    }) {
      // Send initial progress
      if (onProgress) {
        onProgress({
          status: "starting",
          message: `Starting test generation for ${input.sourceFilePath}...`,
          filePath: input.sourceFilePath,
        });
      }
      yield {
        type: "data" as const,
        data: {
          status: "starting",
          message: `Starting test generation for ${input.sourceFilePath}...`,
          filePath: input.sourceFilePath,
        },
      };

      // Create progress callback to stream updates
      const progressCallback = (message: string) => {
        if (onProgress) {
          onProgress({
            status: "generating",
            message,
            filePath: input.sourceFilePath,
          });
        }
      };

      const serviceLayer = getAgentLayer(ctx);

      const result = await Runtime.runPromise(runtime)(
        Effect.gen(function* () {
          const testAgent = yield* CypressTestAgent;
          const isConfigured = yield* testAgent.isConfigured();

          if (!isConfigured) {
            yield* Effect.promise(() =>
              vscode.window.showErrorMessage(
                "AI Gateway token not available. Please log in to authenticate.",
              ),
            );
            return {
              success: false as const,
              error: "Authentication required. Please log in.",
            };
          }

          // Fire-and-forget informational notification
          vscode.window.showInformationMessage(
            `Creating Cypress test for ${input.sourceFilePath}...`,
          );

          const testResult = yield* testAgent.generateTest(
            {
              sourceFilePath: input.sourceFilePath,
              options: {
                updateExisting: false,
              },
            },
            ctx.outputChannel,
            ctx.isDev,
            signal,
            progressCallback,
          );

          if (testResult.success) {
            // Fire-and-forget success notification
            vscode.window.showInformationMessage(
              `Cypress test generated successfully: ${testResult.testFilePath || input.sourceFilePath}`,
            );

            return {
              success: true as const,
              testFilePath: testResult.testFilePath,
              testContent: testResult.testContent,
              filePath: input.sourceFilePath,
            };
          } else {
            yield* Effect.promise(() =>
              vscode.window.showErrorMessage(
                `Failed to generate test: ${testResult.error || "Unknown error"}`,
              ),
            );

            return {
              success: false as const,
              error: testResult.error || "Unknown error",
              filePath: input.sourceFilePath,
            };
          }
        }).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
              yield* Effect.logDebug(
                `[RpcRouter] Test generation failed: ${errorMessage}`,
              );
              yield* Effect.promise(() =>
                vscode.window.showErrorMessage(
                  `Failed to generate test: ${errorMessage}`,
                ),
              );
              return {
                success: false as const,
                error: errorMessage,
                filePath: input.sourceFilePath,
              };
            }),
          ),
          Effect.provide(serviceLayer),
        ),
      );

      // Return final result
      return result;
    }),

  /**
   * Execute confirmed test plan
   */
  executeTest: procedure
    .input(
      z.object({
        test: z.object({
          id: z.string(),
          sourceFile: z.string(),
          targetTestPath: z.string(),
          description: z.string(),
          isUpdate: z.boolean(),
          testType: z.enum(["unit", "integration", "e2e"]).default("e2e"),
          framework: z.string().default("cypress"),
        }),
      }),
    )
    .mutation(({ input, ctx }) =>
      Effect.gen(function* () {
        const testAgent = yield* CypressTestAgent;
        const abortController = new AbortController();

        const result = yield* testAgent.executeTest(
          {
            sourceFile: input.test.sourceFile,
            targetTestPath: input.test.targetTestPath,
            description: input.test.description,
            isUpdate: input.test.isUpdate,
            testType: input.test.testType ?? "e2e",
            framework: input.test.framework ?? "cypress",
          },
          ctx.outputChannel,
          ctx.isDev,
          abortController.signal,
        );

        if (result.success) {
          return {
            id: input.test.id,
            executionStatus: "completed" as const,
            testFilePath: result.testFilePath,
            message: result.testContent,
          };
        } else {
          return {
            id: input.test.id,
            executionStatus: result.error?.includes("cancelled")
              ? ("pending" as const)
              : ("error" as const),
            error: result.error || "Unknown error",
          };
        }
      }).pipe(
        Effect.catchAll((error: unknown) =>
          Effect.succeed({
            id: input.test.id,
            executionStatus: "error" as const,
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        ),
        provideAgentLayer(ctx),
      ),
    ),

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
};
