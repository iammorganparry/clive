import { Effect } from "effect";
import * as vscode from "vscode";
import { WebviewMessages } from "../constants.js";
import { ErrorCode, getErrorMessage } from "../lib/error-messages.js";
import { CypressTestAgent } from "./ai-agent/agent.js";
import { PlanningAgent } from "./ai-agent/planning-agent.js";
import { ApiKeyService as ApiKeyServiceEffect } from "./api-key-service.js";
import type { ConfigService } from "./config-service.js";
import { ConfigService as ConfigServiceEffect } from "./config-service.js";
import {
  type Conversation,
  ConversationService as ConversationServiceEffect,
  type Message,
} from "./conversation-service.js";
import type { CypressDetector } from "./cypress-detector.js";
import type { DiffContentProvider } from "./diff-content-provider.js";
import type { GitService } from "./git-service.js";
import type { ReactFileFilter } from "./react-file-filter.js";
import { ReactFileFilter as ReactFileFilterService } from "./react-file-filter.js";

export interface MessageHandlerContext {
  webviewView: vscode.WebviewView;
  context: vscode.ExtensionContext;
  outputChannel: vscode.OutputChannel;
  isDev: boolean;
  cypressDetector: CypressDetector;
  gitService: GitService;
  reactFileFilter: ReactFileFilter;
  diffProvider: DiffContentProvider;
  configService: ConfigService;
}

/**
 * Handles all webview message routing and processing
 */
// Track active AbortControllers for canceling test generation
const activeAbortControllers = new Map<string, AbortController>();

export class WebviewMessageHandler extends Effect.Service<WebviewMessageHandler>()(
  "WebviewMessageHandler",
  {
    effect: Effect.gen(function* () {
      return {
        handleReady: (ctx: MessageHandlerContext) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              "[WebviewMessageHandler] Handling ready message",
            );
            const service = yield* WebviewMessageHandler;
            yield* service.checkAndSendCypressStatus(ctx);
            yield* service.checkAndSendBranchChanges(ctx);
            yield* service.sendStoredAuthToken(ctx);
          }),

        handleRefreshStatus: (ctx: MessageHandlerContext) =>
          Effect.gen(function* () {
            const service = yield* WebviewMessageHandler;
            yield* service.checkAndSendCypressStatus(ctx);
          }),

        handleOpenLoginPage: (url?: string) =>
          Effect.gen(function* () {
            const callbackUrl = "vscode://clive.auth/callback";
            const loginUrl =
              url ||
              `http://localhost:3000/sign-in?callback_url=${encodeURIComponent(callbackUrl)}`;
            yield* Effect.promise(() =>
              vscode.env.openExternal(vscode.Uri.parse(loginUrl)),
            );
          }),

        handleOpenSignupPage: (url?: string) =>
          Effect.gen(function* () {
            const callbackUrl = "vscode://clive.auth/callback";
            const signupUrl =
              url ||
              `http://localhost:3000/sign-up?callback_url=${encodeURIComponent(callbackUrl)}`;
            yield* Effect.promise(() =>
              vscode.env.openExternal(vscode.Uri.parse(signupUrl)),
            );
          }),

        handleCheckSession: (ctx: MessageHandlerContext) =>
          Effect.gen(function* () {
            const service = yield* WebviewMessageHandler;
            yield* service.sendStoredAuthToken(ctx);
          }),

        handleLogout: (_ctx: MessageHandlerContext) =>
          Effect.gen(function* () {
            const configService = yield* ConfigServiceEffect;
            yield* configService.deleteAuthToken();
            // OIDC gateway tokens are fetched on-demand, no need to clear them
          }),

        handleStoreAuthToken: (ctx: MessageHandlerContext, token: string) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              "[WebviewMessageHandler] Storing auth token",
            );
            const configService = yield* ConfigServiceEffect;
            yield* configService.storeAuthToken(token);
          }).pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                const errorMessage =
                  error instanceof Error ? error.message : "Unknown error";
                yield* Effect.logDebug(
                  `[WebviewMessageHandler] Failed to store auth token in secret storage: ${errorMessage}`,
                );
                yield* Effect.sync(() => {
                  ctx.outputChannel.appendLine(
                    `Failed to store auth token in secret storage: ${errorMessage}`,
                  );
                });
              }),
            ),
          ),

        handleAuthTokenReceived: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              "[WebviewMessageHandler] Auth token received acknowledgment",
            );
          }),

        handleLog: (
          ctx: MessageHandlerContext,
          logData?: {
            level?: string;
            message: string;
            data?: unknown;
          },
        ) =>
          Effect.sync(() => {
            if (!ctx.outputChannel || !logData) {
              return;
            }

            const level = logData.level || "info";
            const logMessage = logData.data
              ? `${logData.message}: ${JSON.stringify(logData.data, null, 2)}`
              : logData.message;
            ctx.outputChannel.appendLine(
              `[${level.toUpperCase()}] ${logMessage}`,
            );
          }),

        handleGetBranchChanges: (ctx: MessageHandlerContext) =>
          Effect.gen(function* () {
            const service = yield* WebviewMessageHandler;
            yield* service.checkAndSendBranchChanges(ctx);
          }),

        handleCreateTestForFile: (
          ctx: MessageHandlerContext,
          filePath: string,
        ) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              `[WebviewMessageHandler] Creating test for file: ${filePath}`,
            );
            const testAgent = yield* CypressTestAgent;
            const isConfigured = yield* testAgent.isConfigured();

            if (!isConfigured) {
              yield* Effect.promise(() =>
                vscode.window.showErrorMessage(
                  "AI Gateway token not available. Please log in to authenticate.",
                ),
              );

              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.testGenerationStatus,
                success: false,
                error: "Authentication required. Please log in.",
                filePath,
              });
              return;
            }

            // Create AbortController for this file
            const abortController = new AbortController();
            activeAbortControllers.set(filePath, abortController);

            ctx.webviewView.webview.postMessage({
              command: WebviewMessages.testGenerationProgress,
              filePath,
              status: "starting",
              message: `Starting test generation for ${filePath}...`,
            });

            yield* Effect.promise(() =>
              vscode.window.showInformationMessage(
                `Creating Cypress test for ${filePath}...`,
              ),
            );

            // Create progress callback to stream updates
            const progressCallback = (message: string) => {
              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.testGenerationProgress,
                filePath,
                message,
              });
            };

            const result = yield* testAgent
              .generateTest(
                {
                  sourceFilePath: filePath,
                  options: {
                    updateExisting: false,
                  },
                },
                ctx.outputChannel,
                ctx.isDev,
                abortController.signal,
                progressCallback,
              )
              .pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    // Clean up AbortController
                    activeAbortControllers.delete(filePath);
                  }),
                ),
              );

            if (result.success) {
              yield* Effect.promise(() =>
                vscode.window.showInformationMessage(
                  `Cypress test generated successfully: ${result.testFilePath || filePath}`,
                ),
              );

              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.testGenerationStatus,
                success: true,
                filePath,
                testFilePath: result.testFilePath,
                testContent: result.testContent,
              });
            } else {
              yield* Effect.promise(() =>
                vscode.window.showErrorMessage(
                  `Failed to generate test: ${result.error || "Unknown error"}`,
                ),
              );

              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.testGenerationStatus,
                success: false,
                error: result.error || "Unknown error",
                filePath,
              });
            }
          }),

        handlePlanTestGeneration: (
          ctx: MessageHandlerContext,
          files: string[],
        ) =>
          Effect.gen(function* () {
            const requestId = `plan-${Date.now()}-${Math.random().toString(36).substring(7)}`;
            const startTime = Date.now();

            yield* Effect.logDebug(
              `[WebviewMessageHandler:${requestId}] ========== Starting test generation planning ==========`,
            );
            yield* Effect.logDebug(
              `[WebviewMessageHandler:${requestId}] Files to process: ${files.length}`,
            );
            for (let idx = 0; idx < files.length; idx++) {
              yield* Effect.logDebug(
                `[WebviewMessageHandler:${requestId}]   ${idx + 1}. ${files[idx]}`,
              );
            }

            const configCheckStartTime = Date.now();
            const testAgent = yield* CypressTestAgent;
            const isConfigured = yield* testAgent.isConfigured();
            const configCheckDuration = Date.now() - configCheckStartTime;
            yield* Effect.logDebug(
              `[WebviewMessageHandler:${requestId}] Configuration check completed in ${configCheckDuration}ms: ${isConfigured ? "configured" : "not configured"}`,
            );

            if (!isConfigured) {
              yield* Effect.logDebug(
                `[WebviewMessageHandler:${requestId}] ERROR: Not configured, aborting`,
              );
              yield* Effect.promise(() =>
                vscode.window.showErrorMessage(
                  "AI Gateway token not available. Please log in to authenticate.",
                ),
              );

              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.testGenerationPlan,
                tests: [],
                error: "API key not configured",
              });
              return;
            }

            if (files.length === 0) {
              yield* Effect.logDebug(
                `[WebviewMessageHandler:${requestId}] ERROR: No files provided`,
              );
              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.testGenerationPlan,
                tests: [],
                error: "No files provided",
              });
              return;
            }

            // Send initial progress update
            yield* Effect.logDebug(
              `[WebviewMessageHandler:${requestId}] Sending initial progress update: planning ${files.length} file(s) in parallel`,
            );
            ctx.webviewView.webview.postMessage({
              command: WebviewMessages.testGenerationProgress,
              filePath: files[0] || "",
              status: "planning",
              message: `Planning tests for ${files.length} file(s)...`,
            });

            yield* Effect.promise(() =>
              vscode.window.showInformationMessage(
                `Planning Cypress tests for ${files.length} file(s)...`,
              ),
            );

            // Process each file in parallel
            yield* Effect.logDebug(
              `[WebviewMessageHandler:${requestId}] Processing ${files.length} file(s) in parallel...`,
            );
            const planningAgent = yield* PlanningAgent;
            const conversationService = yield* ConversationServiceEffect;

            // Create progress callbacks for each file
            const progressCallbacks = files.map((filePath) => {
              return (_status: string, message: string) => {
                ctx.webviewView.webview.postMessage({
                  command: WebviewMessages.testGenerationProgress,
                  filePath,
                  status: status as
                    | "planning"
                    | "analyzing"
                    | "generating_content"
                    | "starting",
                  message: `${filePath.split("/").pop()}: ${message}`,
                });
              };
            });

            // Get max concurrent files from config
            const configService = yield* ConfigServiceEffect;
            const maxConcurrentFiles =
              yield* configService.getMaxConcurrentFiles();

            // Process all files in parallel using Effect.all
            const agentStartTime = Date.now();
            const results = yield* Effect.all(
              files.map((filePath, index) =>
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
                    progressCallbacks[index],
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
            const agentDuration = Date.now() - agentStartTime;
            yield* Effect.logDebug(
              `[WebviewMessageHandler:${requestId}] All planning completed in ${agentDuration}ms`,
            );

            // Aggregate all results
            const allTests = results.flatMap((r) => r.tests);
            const firstResult = results[0];
            yield* Effect.logDebug(
              `[WebviewMessageHandler:${requestId}] Aggregated ${allTests.length} test(s) from ${results.length} file(s)`,
            );

            yield* Effect.logDebug(
              `[WebviewMessageHandler:${requestId}] Sending test generation plan to webview`,
            );
            ctx.webviewView.webview.postMessage({
              command: WebviewMessages.testGenerationPlan,
              tests: allTests,
              conversationId: firstResult?.conversationId,
              sourceFile: firstResult?.sourceFile || files[0] || "",
            });

            const totalDuration = Date.now() - startTime;
            yield* Effect.logDebug(
              `[WebviewMessageHandler:${requestId}] ========== Test generation planning completed in ${totalDuration}ms ==========`,
            );
          }).pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                const errorMessage =
                  error instanceof Error ? error.message : "Unknown error";
                yield* Effect.logDebug(
                  `[WebviewMessageHandler] Planning failed: ${errorMessage}`,
                );
                yield* Effect.promise(() =>
                  vscode.window.showErrorMessage(
                    `Failed to plan tests: ${errorMessage}`,
                  ),
                );

                ctx.webviewView.webview.postMessage({
                  command: WebviewMessages.testGenerationPlan,
                  tests: [],
                  error: errorMessage,
                });
              }),
            ),
          ),

        handleConfirmTestPlan: (
          ctx: MessageHandlerContext,
          acceptedIds: string[],
          proposedTests: Array<{
            id: string;
            sourceFile: string;
            targetTestPath: string;
            description: string;
            isUpdate: boolean;
          }>,
        ) =>
          Effect.gen(function* () {
            if (acceptedIds.length === 0) {
              return;
            }

            const testsToExecute = proposedTests.filter((test) =>
              acceptedIds.includes(test.id),
            );

            yield* Effect.promise(() =>
              vscode.window.showInformationMessage(
                `Generating ${testsToExecute.length} Cypress test(s)...`,
              ),
            );

            for (const test of testsToExecute) {
              // Create AbortController for this test
              const abortController = new AbortController();
              activeAbortControllers.set(test.id, abortController);

              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.testExecutionUpdate,
                id: test.id,
                executionStatus: "in_progress",
              });

              const testAgent = yield* CypressTestAgent;
              const result = yield* testAgent.executeTest(
                {
                  sourceFile: test.sourceFile,
                  targetTestPath: test.targetTestPath,
                  description: test.description,
                  isUpdate: test.isUpdate,
                },
                ctx.outputChannel,
                ctx.isDev,
                abortController.signal,
              );

              // Clean up AbortController
              activeAbortControllers.delete(test.id);

              if (result.success) {
                ctx.webviewView.webview.postMessage({
                  command: WebviewMessages.testExecutionUpdate,
                  id: test.id,
                  executionStatus: "completed",
                  testFilePath: result.testFilePath,
                  message: result.testContent,
                });
              } else {
                ctx.webviewView.webview.postMessage({
                  command: WebviewMessages.testExecutionUpdate,
                  id: test.id,
                  executionStatus: result.error?.includes("cancelled")
                    ? "pending"
                    : "error",
                  error: result.error || "Unknown error",
                });
              }
            }
          }),

        handleCancelTest: (ctx: MessageHandlerContext, testId: string) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              `[WebviewMessageHandler] Cancelling test: ${testId}`,
            );

            const abortController = activeAbortControllers.get(testId);
            if (abortController) {
              // Abort the ongoing operation
              abortController.abort();
              activeAbortControllers.delete(testId);

              // Determine if it's a file path (contains path separator) or test ID
              const isFilePath = testId.includes("/") || testId.includes("\\");

              if (isFilePath) {
                // Single file flow - send testGenerationStatus
                ctx.webviewView.webview.postMessage({
                  command: WebviewMessages.testGenerationStatus,
                  success: false,
                  error: "Test generation cancelled",
                  filePath: testId,
                });

                yield* Effect.logDebug(
                  `[WebviewMessageHandler] File ${testId} cancelled successfully`,
                );
              } else {
                // Multi-file flow - send testExecutionUpdate
                ctx.webviewView.webview.postMessage({
                  command: WebviewMessages.testExecutionUpdate,
                  id: testId,
                  executionStatus: "pending",
                });

                yield* Effect.logDebug(
                  `[WebviewMessageHandler] Test ${testId} cancelled successfully`,
                );
              }
            } else {
              // Test is pending, just update status
              // Try to determine if it's a file path or test ID
              const isFilePath = testId.includes("/") || testId.includes("\\");

              if (isFilePath) {
                ctx.webviewView.webview.postMessage({
                  command: WebviewMessages.testGenerationStatus,
                  success: false,
                  error: "Test generation cancelled",
                  filePath: testId,
                });
              } else {
                ctx.webviewView.webview.postMessage({
                  command: WebviewMessages.testExecutionUpdate,
                  id: testId,
                  executionStatus: "pending",
                });
              }

              yield* Effect.logDebug(
                `[WebviewMessageHandler] Test ${testId} was pending, status updated`,
              );
            }
          }),

        handlePreviewTestDiff: (
          ctx: MessageHandlerContext,
          test:
            | {
                id: string;
                targetTestPath: string;
                proposedContent: string;
                existingContent?: string;
                isUpdate: boolean;
              }
            | undefined,
        ) =>
          Effect.gen(function* () {
            if (!test) {
              return;
            }

            yield* Effect.tryPromise({
              try: () => {
                const proposedUri = ctx.diffProvider.storeContent(
                  test.id,
                  test.proposedContent,
                  "proposed",
                );

                let originalUri: vscode.Uri;
                if (test.isUpdate && test.existingContent) {
                  originalUri = ctx.diffProvider.storeContent(
                    test.id,
                    test.existingContent,
                    "existing",
                  );
                } else {
                  originalUri = ctx.diffProvider.storeContent(
                    test.id,
                    "",
                    "empty",
                  );
                }

                return vscode.commands.executeCommand(
                  "vscode.diff",
                  originalUri,
                  proposedUri,
                  `${test.targetTestPath} (Preview)`,
                  {
                    viewColumn: vscode.ViewColumn.Active,
                  },
                );
              },
              catch: (error) =>
                new Error(
                  error instanceof Error ? error.message : "Unknown error",
                ),
            });
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
              }),
            ),
          ),

        handleFetchConfig: () => Effect.void,

        handleConfigUpdated: () => Effect.void,

        handleGetApiKeys: (ctx: MessageHandlerContext) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              "[WebviewMessageHandler] Getting API keys status",
            );
            const apiKeyService = yield* ApiKeyServiceEffect;
            const statuses = yield* apiKeyService.getApiKeysStatus();
            ctx.webviewView.webview.postMessage({
              command: WebviewMessages.apiKeysStatus,
              statuses,
            });
          }).pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                const errorMessage =
                  error instanceof Error ? error.message : "Unknown error";
                yield* Effect.logDebug(
                  `[WebviewMessageHandler] Failed to get API keys: ${errorMessage}`,
                );
                ctx.webviewView.webview.postMessage({
                  command: WebviewMessages.apiKeysStatus,
                  statuses: [],
                  error: errorMessage,
                });
              }),
            ),
          ),

        handleSaveApiKey: (
          ctx: MessageHandlerContext,
          provider: string,
          key: string,
        ) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              `[WebviewMessageHandler] Saving API key for provider: ${provider}`,
            );
            const apiKeyService = yield* ApiKeyServiceEffect;
            yield* apiKeyService.setApiKey(provider as "anthropic", key);
            // Refresh and send updated status
            const statuses = yield* apiKeyService.getApiKeysStatus();
            ctx.webviewView.webview.postMessage({
              command: WebviewMessages.apiKeysStatus,
              statuses,
            });
          }).pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                const errorMessage =
                  error instanceof Error ? error.message : "Unknown error";
                yield* Effect.logDebug(
                  `[WebviewMessageHandler] Failed to save API key: ${errorMessage}`,
                );
                yield* Effect.promise(() =>
                  vscode.window.showErrorMessage(
                    `Failed to save API key: ${errorMessage}`,
                  ),
                );
                ctx.webviewView.webview.postMessage({
                  command: WebviewMessages.apiKeysStatus,
                  statuses: [],
                  error: errorMessage,
                });
              }),
            ),
          ),

        handleDeleteApiKey: (ctx: MessageHandlerContext, provider: string) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              `[WebviewMessageHandler] Deleting API key for provider: ${provider}`,
            );
            const apiKeyService = yield* ApiKeyServiceEffect;
            yield* apiKeyService.deleteApiKey(provider as "anthropic");
            // Refresh and send updated status
            const statuses = yield* apiKeyService.getApiKeysStatus();
            ctx.webviewView.webview.postMessage({
              command: WebviewMessages.apiKeysStatus,
              statuses,
            });
          }).pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                const errorMessage =
                  error instanceof Error ? error.message : "Unknown error";
                yield* Effect.logDebug(
                  `[WebviewMessageHandler] Failed to delete API key: ${errorMessage}`,
                );
                yield* Effect.promise(() =>
                  vscode.window.showErrorMessage(
                    `Failed to delete API key: ${errorMessage}`,
                  ),
                );
                ctx.webviewView.webview.postMessage({
                  command: WebviewMessages.apiKeysStatus,
                  statuses: [],
                  error: errorMessage,
                });
              }),
            ),
          ),

        handleStartConversation: (
          ctx: MessageHandlerContext,
          sourceFile: string,
        ) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              `[WebviewMessageHandler] Starting conversation for: ${sourceFile}`,
            );
            const conversationService = yield* ConversationServiceEffect;

            // Get or create conversation
            const conversation = yield* conversationService
              .getOrCreateConversation(sourceFile)
              .pipe(
                Effect.catchTag("ApiError", (error) =>
                  Effect.gen(function* () {
                    yield* Effect.logDebug(
                      `[WebviewMessageHandler] Failed to start conversation: ${error.message}`,
                    );
                    ctx.webviewView.webview.postMessage({
                      command: WebviewMessages.chatError,
                      message: error.message,
                    });
                    return yield* Effect.fail(error);
                  }),
                ),
                Effect.catchTag("NetworkError", (error) =>
                  Effect.gen(function* () {
                    yield* Effect.logDebug(
                      `[WebviewMessageHandler] Network error starting conversation: ${error.message}`,
                    );
                    ctx.webviewView.webview.postMessage({
                      command: WebviewMessages.chatError,
                      message: getErrorMessage(ErrorCode.NETWORK),
                    });
                    return yield* Effect.fail(error);
                  }),
                ),
                Effect.catchTag("AuthTokenMissingError", (error) =>
                  Effect.gen(function* () {
                    yield* Effect.logDebug(
                      `[WebviewMessageHandler] Auth error starting conversation: ${error.message}`,
                    );
                    ctx.webviewView.webview.postMessage({
                      command: WebviewMessages.chatError,
                      message: getErrorMessage(ErrorCode.AUTH_REQUIRED),
                    });
                    return yield* Effect.fail(error);
                  }),
                ),
                Effect.catchAll((error) =>
                  Effect.gen(function* () {
                    const errorMessage =
                      error instanceof Error ? error.message : "Unknown error";
                    yield* Effect.logDebug(
                      `[WebviewMessageHandler] Failed to start conversation: ${errorMessage}`,
                    );
                    ctx.webviewView.webview.postMessage({
                      command: WebviewMessages.chatError,
                      message: getErrorMessage(ErrorCode.SERVER_ERROR),
                    });
                    return yield* Effect.fail(error);
                  }),
                ),
              );

            // Load existing messages
            const messages = yield* conversationService
              .getMessages(conversation.id)
              .pipe(
                Effect.catchTag("ApiError", (error) =>
                  Effect.sync(() => {
                    ctx.webviewView.webview.postMessage({
                      command: WebviewMessages.chatError,
                      message: error.message,
                    });
                    return [] as Message[];
                  }),
                ),
                Effect.catchAll(() => Effect.succeed([] as Message[])),
              );

            ctx.webviewView.webview.postMessage({
              command: WebviewMessages.startConversation,
              conversationId: conversation.id,
              sourceFile: conversation.sourceFile,
              messages: messages.map((msg: Message) => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                createdAt: msg.createdAt.toISOString(),
              })),
            });
          }),

        handleSendChatMessage: (
          ctx: MessageHandlerContext,
          conversationId: string,
          sourceFile: string,
          message: string,
        ) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              `[WebviewMessageHandler] Sending chat message to conversation: ${conversationId}`,
            );
            const conversationService = yield* ConversationServiceEffect;
            const planningAgent = yield* PlanningAgent;

            // Add user message to conversation
            yield* conversationService
              .addMessage(conversationId, "user", message)
              .pipe(
                Effect.catchTag("ApiError", (error) =>
                  Effect.gen(function* () {
                    yield* Effect.logDebug(
                      `[WebviewMessageHandler] Failed to save user message: ${error.message}`,
                    );
                    ctx.webviewView.webview.postMessage({
                      command: WebviewMessages.chatError,
                      message: error.message,
                    });
                    return yield* Effect.fail(error);
                  }),
                ),
                Effect.catchTag("NetworkError", (error) =>
                  Effect.gen(function* () {
                    yield* Effect.logDebug(
                      `[WebviewMessageHandler] Network error saving message: ${error.message}`,
                    );
                    ctx.webviewView.webview.postMessage({
                      command: WebviewMessages.chatError,
                      message: getErrorMessage(ErrorCode.NETWORK),
                    });
                    return yield* Effect.fail(error);
                  }),
                ),
                Effect.catchAll((error) =>
                  Effect.gen(function* () {
                    yield* Effect.logDebug(
                      `[WebviewMessageHandler] Failed to save user message: ${error instanceof Error ? error.message : "Unknown error"}`,
                    );
                    // Continue even if saving fails - don't block the conversation
                  }),
                ),
              );

            // Get conversation history
            const history = yield* conversationService
              .getMessages(conversationId)
              .pipe(
                Effect.catchTag("ApiError", (error) =>
                  Effect.sync(() => {
                    ctx.webviewView.webview.postMessage({
                      command: WebviewMessages.chatError,
                      message: error.message,
                    });
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

            // Call planning agent with history
            const result = yield* planningAgent
              .planTestForFile(
                sourceFile,
                conversationHistory,
                ctx.outputChannel,
              )
              .pipe(
                Effect.catchAll((error) =>
                  Effect.gen(function* () {
                    const errorMessage =
                      error instanceof Error ? error.message : "Unknown error";
                    yield* Effect.logDebug(
                      `[WebviewMessageHandler] Planning agent error: ${errorMessage}`,
                    );
                    ctx.webviewView.webview.postMessage({
                      command: WebviewMessages.chatError,
                      message: `Failed to process your message: ${errorMessage}`,
                    });
                    return yield* Effect.fail(error);
                  }),
                ),
              );

            // Save assistant response
            const assistantResponse =
              (result as { response?: string }).response || "";
            if (assistantResponse) {
              yield* conversationService
                .addMessage(conversationId, "assistant", assistantResponse)
                .pipe(
                  Effect.catchAll((error) =>
                    Effect.gen(function* () {
                      yield* Effect.logDebug(
                        `[WebviewMessageHandler] Failed to save assistant message: ${error instanceof Error ? error.message : "Unknown error"}`,
                      );
                    }),
                  ),
                );
            }

            // Send response to webview
            ctx.webviewView.webview.postMessage({
              command: WebviewMessages.chatMessageReceived,
              content: assistantResponse,
              response: assistantResponse,
              tests: (result as { tests?: unknown[] }).tests || [],
            });

            // If there are tests, also send the plan
            if ((result as { tests?: unknown[] }).tests?.length) {
              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.testGenerationPlan,
                tests: (result as { tests?: unknown[] }).tests,
                conversationId,
                sourceFile,
              });
            }
          }),

        handleLoadConversation: (
          ctx: MessageHandlerContext,
          sourceFile: string,
        ) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              `[WebviewMessageHandler] Loading conversation for: ${sourceFile}`,
            );
            const conversationService = yield* ConversationServiceEffect;

            const conversation = yield* conversationService
              .getOrCreateConversation(sourceFile)
              .pipe(
                Effect.catchTag("ApiError", (error) =>
                  Effect.sync(() => {
                    ctx.webviewView.webview.postMessage({
                      command: WebviewMessages.chatError,
                      message: error.message,
                    });
                    return null as Conversation | null;
                  }),
                ),
                Effect.catchTag("NetworkError", (_error) =>
                  Effect.sync(() => {
                    ctx.webviewView.webview.postMessage({
                      command: WebviewMessages.chatError,
                      message: getErrorMessage(ErrorCode.NETWORK),
                    });
                    return null as Conversation | null;
                  }),
                ),
                Effect.catchAll(() =>
                  Effect.succeed(null as Conversation | null),
                ),
              );

            if (!conversation) {
              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.conversationHistory,
                messages: [],
              });
              return;
            }

            const messages = yield* conversationService
              .getMessages(conversation.id)
              .pipe(
                Effect.catchTag("ApiError", (error) =>
                  Effect.sync(() => {
                    ctx.webviewView.webview.postMessage({
                      command: WebviewMessages.chatError,
                      message: error.message,
                    });
                    return [] as Message[];
                  }),
                ),
                Effect.catchAll(() => Effect.succeed([] as Message[])),
              );

            ctx.webviewView.webview.postMessage({
              command: WebviewMessages.conversationHistory,
              conversationId: conversation.id,
              messages: messages.map((msg: Message) => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                createdAt: msg.createdAt.toISOString(),
              })),
            });
          }),

        checkAndSendCypressStatus: (ctx: MessageHandlerContext) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              "[WebviewMessageHandler] Checking Cypress status",
            );
            const status = yield* Effect.tryPromise({
              try: () => ctx.cypressDetector.checkStatus(),
              catch: (error) =>
                new Error(
                  error instanceof Error ? error.message : "Unknown error",
                ),
            });

            if (status) {
              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.cypressStatus,
                status,
              });
            } else {
              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.cypressStatus,
                status: {
                  overallStatus: "not_installed" as const,
                  packages: [],
                  workspaceRoot: "",
                },
                error: "No workspace folder found",
              });
            }
          }),

        checkAndSendBranchChanges: (ctx: MessageHandlerContext) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              "[WebviewMessageHandler] Checking branch changes",
            );
            const branchChanges = yield* ctx.gitService.getBranchChanges();

            if (!branchChanges) {
              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.branchChangesStatus,
                changes: null,
                error: "No workspace folder found or not a git repository",
              });
              return;
            }

            const reactFileFilter = yield* ReactFileFilterService;
            const eligibleFiles = yield* reactFileFilter.filterEligibleFiles(
              branchChanges.files,
            );

            ctx.webviewView.webview.postMessage({
              command: WebviewMessages.branchChangesStatus,
              changes: {
                branchName: branchChanges.branchName,
                baseBranch: branchChanges.baseBranch,
                files: eligibleFiles,
                workspaceRoot: branchChanges.workspaceRoot,
              },
            });
          }).pipe(
            Effect.catchAll((error) =>
              Effect.sync(() => {
                const errorMessage =
                  error instanceof Error ? error.message : "Unknown error";
                ctx.webviewView.webview.postMessage({
                  command: WebviewMessages.branchChangesStatus,
                  changes: null,
                  error: errorMessage,
                });
              }),
            ),
          ),

        sendStoredAuthToken: (ctx: MessageHandlerContext) =>
          Effect.gen(function* () {
            const configService = yield* ConfigServiceEffect;
            const token = yield* configService.getAuthToken();
            if (token) {
              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.authToken,
                token,
              });
            }
          }),

        sendThemeInfo: (ctx: MessageHandlerContext) =>
          Effect.sync(() => {
            const colorTheme = vscode.window.activeColorTheme;
            const colorScheme =
              colorTheme.kind === vscode.ColorThemeKind.Dark ||
              colorTheme.kind === vscode.ColorThemeKind.HighContrast
                ? "dark"
                : "light";

            ctx.webviewView.webview.postMessage({
              command: WebviewMessages.themeInfo,
              colorScheme,
            });
          }),

        handleOAuthCallback: (ctx: MessageHandlerContext, uri: vscode.Uri) =>
          Effect.gen(function* () {
            const service = yield* WebviewMessageHandler;
            const params = new URLSearchParams(uri.query);
            const token = params.get("token");
            const error = params.get("error");
            const errorMessage = params.get("message");

            if (error) {
              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.oauthCallback,
                error: errorMessage || error,
              });
              return;
            }

            if (token) {
              const configService = yield* ConfigServiceEffect;
              yield* configService.storeAuthToken(token);

              yield* service.fetchAndStoreApiKeys(ctx, token);

              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.authToken,
                token,
              });
            } else {
              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.oauthCallback,
                error: "No token received",
              });
            }
          }),

        fetchAndStoreApiKeys: (ctx: MessageHandlerContext, authToken: string) =>
          Effect.gen(function* () {
            // Fetch OIDC gateway token from app
            const gatewayToken = yield* Effect.tryPromise({
              try: async () => {
                const backendUrl = "http://localhost:3000";
                const response = await fetch(`${backendUrl}/api/ai/token`, {
                  method: "GET",
                  headers: {
                    Authorization: `Bearer ${authToken}`,
                    "Content-Type": "application/json",
                  },
                });

                if (!response.ok) {
                  const errorText = await response.text();
                  throw new Error(
                    `Failed to fetch gateway token: ${response.status} ${response.statusText} - ${errorText}`,
                  );
                }

                const data = await response.json();
                if (!data.token) {
                  throw new Error("No token in gateway token response");
                }

                return data.token as string;
              },
              catch: (error) =>
                new Error(
                  error instanceof Error ? error.message : "Unknown error",
                ),
            });

            // OIDC tokens are fetched on-demand and expire in 12 hours
            // No need to store them, but we can verify the token was fetched
            if (gatewayToken) {
              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.configUpdated,
              });

              ctx.outputChannel.appendLine(
                "AI Gateway token fetched successfully",
              );
            }
          }).pipe(
            Effect.catchAll((error) =>
              Effect.sync(() => {
                const errorMessage =
                  error instanceof Error ? error.message : "Unknown error";
                ctx.outputChannel.appendLine(
                  `Failed to fetch gateway token: ${errorMessage}`,
                );
              }),
            ),
          ),

        handleMessage: (
          ctx: MessageHandlerContext,
          message: {
            command: string;
            [key: string]: unknown;
          },
        ) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              `[WebviewMessageHandler] Handling message: ${message.command}`,
            );
            const service = yield* WebviewMessageHandler;

            // Use switch statement to avoid Match's 20 case limit
            switch (message.command) {
              case WebviewMessages.ready:
                yield* service.handleReady(ctx);
                break;
              case WebviewMessages.refreshStatus:
                yield* service.handleRefreshStatus(ctx);
                break;
              case WebviewMessages.openLoginPage:
                yield* service.handleOpenLoginPage(
                  message.url as string | undefined,
                );
                break;
              case WebviewMessages.openSignupPage:
                yield* service.handleOpenSignupPage(
                  message.url as string | undefined,
                );
                break;
              case WebviewMessages.checkSession:
                yield* service.handleCheckSession(ctx);
                break;
              case WebviewMessages.logout:
                yield* service.handleLogout(ctx);
                break;
              case WebviewMessages.storeAuthToken:
                yield* service.handleStoreAuthToken(
                  ctx,
                  message.token as string,
                );
                break;
              case WebviewMessages.authTokenReceived:
                yield* service.handleAuthTokenReceived();
                break;
              case WebviewMessages.log:
                yield* service.handleLog(
                  ctx,
                  message.data as {
                    level?: string;
                    message: string;
                    data?: unknown;
                  },
                );
                break;
              case WebviewMessages.getBranchChanges:
                yield* service.handleGetBranchChanges(ctx);
                break;
              case WebviewMessages.createTestForFile:
                yield* service.handleCreateTestForFile(
                  ctx,
                  message.filePath as string,
                );
                break;
              case WebviewMessages.planTestGeneration:
                yield* service.handlePlanTestGeneration(
                  ctx,
                  message.files as string[],
                );
                break;
              case WebviewMessages.confirmTestPlan:
                yield* service.handleConfirmTestPlan(
                  ctx,
                  message.acceptedIds as string[],
                  message.tests as Array<{
                    id: string;
                    sourceFile: string;
                    targetTestPath: string;
                    description: string;
                    isUpdate: boolean;
                  }>,
                );
                break;
              case WebviewMessages.previewTestDiff:
                yield* service.handlePreviewTestDiff(
                  ctx,
                  message.test as
                    | {
                        id: string;
                        targetTestPath: string;
                        proposedContent: string;
                        existingContent?: string;
                        isUpdate: boolean;
                      }
                    | undefined,
                );
                break;
              case WebviewMessages.cancelTest:
                yield* service.handleCancelTest(ctx, message.id as string);
                break;
              case WebviewMessages.fetchConfig:
                yield* service.handleFetchConfig();
                break;
              case WebviewMessages.configUpdated:
                yield* service.handleConfigUpdated();
                break;
              case WebviewMessages.getApiKeys:
                yield* service.handleGetApiKeys(ctx);
                break;
              case WebviewMessages.saveApiKey:
                yield* service.handleSaveApiKey(
                  ctx,
                  message.provider as string,
                  message.key as string,
                );
                break;
              case WebviewMessages.deleteApiKey:
                yield* service.handleDeleteApiKey(
                  ctx,
                  message.provider as string,
                );
                break;
              case WebviewMessages.startConversation:
                yield* service.handleStartConversation(
                  ctx,
                  message.sourceFile as string,
                );
                break;
              case WebviewMessages.sendChatMessage:
                yield* service.handleSendChatMessage(
                  ctx,
                  message.conversationId as string,
                  message.sourceFile as string,
                  message.message as string,
                );
                break;
              case WebviewMessages.loadConversation:
                yield* service.handleLoadConversation(
                  ctx,
                  message.sourceFile as string,
                );
                break;
              default:
                yield* Effect.die(`Unknown command: ${message.command}`);
            }
          }),
      };
    }),
    dependencies: [
      ReactFileFilterService.Default,
      ConfigServiceEffect.Default,
      ApiKeyServiceEffect.Default,
      ConversationServiceEffect.Default,
      PlanningAgent.Default,
    ],
  },
) {}
