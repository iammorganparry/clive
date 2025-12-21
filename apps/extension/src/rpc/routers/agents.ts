import { Effect, Layer, Runtime } from "effect";
import { z } from "zod";
import * as vscode from "vscode";
import { createRouter } from "@clive/webview-rpc";
import { CypressTestAgent } from "../../services/ai-agent/agent.js";
import { PlanningAgent } from "../../services/ai-agent/planning-agent.js";
import { ConversationService as ConversationServiceEffect } from "../../services/conversation-service.js";
import { ConfigService as ConfigServiceEffect } from "../../services/config-service.js";
import { ApiKeyService } from "../../services/api-key-service.js";
import {
  VSCodeService,
  createSecretStorageLayer,
} from "../../services/vs-code.js";
import { createLoggerLayer } from "../../services/logger-service.js";
import type { RpcContext } from "../context.js";
import type { ProposedTest } from "../../services/ai-agent/types.js";

const { procedure } = createRouter<RpcContext>();
const runtime = Runtime.defaultRuntime;

/**
 * Helper to create the service layer from context
 */
function createServiceLayer(ctx: RpcContext) {
  return Layer.mergeAll(
    CypressTestAgent.Default,
    PlanningAgent.Default,
    ConversationServiceEffect.Default,
    ConfigServiceEffect.Default,
    ApiKeyService.Default,
    VSCodeService.Default,
    createSecretStorageLayer(ctx.context),
    createLoggerLayer(ctx.outputChannel, ctx.isDev),
  );
}

/**
 * Agents router - handles AI agent operations
 */
export const agentsRouter = {
  /**
   * Plan tests for multiple files
   */
  planTests: procedure
    .input(
      z.object({
        files: z.array(z.string()),
      }),
    )
    .mutation(
      ({ input, ctx }: { input: { files: string[] }; ctx: RpcContext }) =>
        Effect.gen(function* () {
          const requestId = `plan-${Date.now()}-${Math.random().toString(36).substring(7)}`;
          const startTime = Date.now();

          yield* Effect.logDebug(
            `[RpcRouter:${requestId}] ========== Starting test generation planning ==========`,
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
              tests: [] as ProposedTest[],
              error: "API key not configured",
            };
          }

          if (input.files.length === 0) {
            yield* Effect.logDebug(
              `[RpcRouter:${requestId}] ERROR: No files provided`,
            );
            return { tests: [] as ProposedTest[], error: "No files provided" };
          }

          yield* Effect.promise(() =>
            vscode.window.showInformationMessage(
              `Planning Cypress tests for ${input.files.length} file(s)...`,
            ),
          );

          const planningAgent = yield* PlanningAgent;
          const conversationService = yield* ConversationServiceEffect;
          const configService = yield* ConfigServiceEffect;
          const maxConcurrentFiles =
            yield* configService.getMaxConcurrentFiles();

          // Process all files in parallel using Effect.all
          const results = yield* Effect.all(
            input.files.map((filePath: string, _index: number) =>
              Effect.gen(function* () {
                // Get or create conversation for this file
                const conversation = yield* conversationService
                  .getOrCreateConversation(filePath)
                  .pipe(Effect.catchAll(() => Effect.succeed(null)));

                // Get conversation history if exists
                let conversationHistory: Array<{
                  role: "user" | "assistant" | "system";
                  content: string;
                }> = [];
                if (conversation) {
                  const messages = yield* conversationService
                    .getMessages(conversation.id)
                    .pipe(Effect.catchAll(() => Effect.succeed([])));
                  conversationHistory = messages.map((msg) => ({
                    role: msg.role as "user" | "assistant" | "system",
                    content: msg.content,
                  }));
                }

                // Plan test for this file
                const result = yield* planningAgent.planTestForFile(
                  filePath,
                  conversationHistory,
                  ctx.outputChannel,
                  () => {}, // Progress callback - handled by subscription for generateTest
                );

                // Save assistant response to conversation if we have one
                if (conversation && result.response) {
                  yield* conversationService
                    .addMessage(conversation.id, "assistant", result.response)
                    .pipe(Effect.catchAll(() => Effect.void));
                }

                return {
                  tests: result.tests,
                  conversationId: conversation?.id,
                  sourceFile: filePath,
                };
              }),
            ),
            { concurrency: maxConcurrentFiles },
          );

          // Aggregate all results
          const allTests = results.flatMap(
            (r: {
              tests: ProposedTest[];
              conversationId?: string;
              sourceFile: string;
            }) => r.tests,
          );

          yield* Effect.logDebug(
            `[RpcRouter:${requestId}] Aggregated ${allTests.length} test(s) from ${results.length} file(s)`,
          );

          const totalDuration = Date.now() - startTime;
          yield* Effect.logDebug(
            `[RpcRouter:${requestId}] ========== Test generation planning completed in ${totalDuration}ms ==========`,
          );

          return { tests: allTests };
        }).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
              yield* Effect.logDebug(
                `[RpcRouter] Planning failed: ${errorMessage}`,
              );
              yield* Effect.promise(() =>
                vscode.window.showErrorMessage(
                  `Failed to plan tests: ${errorMessage}`,
                ),
              );
              return { tests: [] as ProposedTest[], error: errorMessage };
            }),
          ),
          Effect.provide(createServiceLayer(ctx)),
        ),
    ),

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
        });
      }
      yield {
        type: "data" as const,
        data: {
          status: "starting",
          message: `Starting test generation for ${input.sourceFilePath}...`,
        },
      };

      // Create progress callback to stream updates
      const progressCallback = (message: string) => {
        if (onProgress) {
          onProgress({
            status: "generating",
            message,
          });
        }
      };

      const serviceLayer = Layer.mergeAll(
        CypressTestAgent.Default,
        ApiKeyService.Default,
        VSCodeService.Default,
        createSecretStorageLayer(ctx.context),
        createLoggerLayer(ctx.outputChannel, ctx.isDev),
      );

      const result = await Runtime.runPromise(runtime)(
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[RpcRouter] Creating test for file: ${input.sourceFilePath}`,
          );
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

          yield* Effect.promise(() =>
            vscode.window.showInformationMessage(
              `Creating Cypress test for ${input.sourceFilePath}...`,
            ),
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
            yield* Effect.promise(() =>
              vscode.window.showInformationMessage(
                `Cypress test generated successfully: ${testResult.testFilePath || input.sourceFilePath}`,
              ),
            );

            return {
              success: true as const,
              testFilePath: testResult.testFilePath,
              testContent: testResult.testContent,
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
        Effect.provide(createServiceLayer(ctx)),
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
      }).pipe(Effect.provide(createServiceLayer(ctx))),
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
