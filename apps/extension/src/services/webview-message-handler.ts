import * as vscode from "vscode";
import type { CypressDetector } from "./cypress-detector.js";
import type { GitService } from "./git-service.js";
import type { ReactFileFilter } from "./react-file-filter.js";
import { CypressTestAgent } from "./ai-agent/agent.js";
import type { DiffContentProvider } from "./diff-content-provider.js";
import { WebviewMessages } from "../constants.js";
import { Effect, Match } from "effect";
import { ReactFileFilter as ReactFileFilterService } from "./react-file-filter.js";
import { ConfigService as ConfigServiceEffect } from "./config-service.js";
import type { ConfigService } from "./config-service.js";

export interface MessageHandlerContext {
  webviewView: vscode.WebviewView;
  context: vscode.ExtensionContext;
  outputChannel: vscode.OutputChannel;
  cypressDetector: CypressDetector;
  gitService: GitService;
  reactFileFilter: ReactFileFilter;
  diffProvider: DiffContentProvider;
  configService: ConfigService;
}

/**
 * Handles all webview message routing and processing
 */
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

            const result = yield* testAgent.generateTest(
              {
                sourceFilePath: filePath,
                options: {
                  updateExisting: false,
                },
              },
              ctx.outputChannel,
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
            yield* Effect.logDebug(
              `[WebviewMessageHandler] Planning test generation for ${files.length} file(s)`,
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
                command: WebviewMessages.testGenerationPlan,
                tests: [],
                error: "API key not configured",
              });
              return;
            }

            if (files.length === 0) {
              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.testGenerationPlan,
                tests: [],
                error: "No files provided",
              });
              return;
            }

            // Send initial progress update
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

            yield* Effect.logDebug(
              "[WebviewMessageHandler] Calling planTests agent...",
            );

            // Send progress update before calling agent
            ctx.webviewView.webview.postMessage({
              command: WebviewMessages.testGenerationProgress,
              filePath: files[0] || "",
              status: "analyzing",
              message: `Analyzing ${files.length} file(s) with AI model...`,
            });

            const plan = yield* testAgent.planTests(files, ctx.outputChannel);

            // Send progress update after planning completes
            ctx.webviewView.webview.postMessage({
              command: WebviewMessages.testGenerationProgress,
              filePath: files[0] || "",
              status: "generating_content",
              message: `Generating test content for ${plan.tests.length} test(s)...`,
            });

            yield* Effect.logDebug(
              `[WebviewMessageHandler] Planning completed: ${plan.tests.length} test(s) proposed`,
            );

            ctx.webviewView.webview.postMessage({
              command: WebviewMessages.testGenerationPlan,
              tests: plan.tests,
            });
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
              );

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
                  executionStatus: "error",
                  error: result.error || "Unknown error",
                });
              }
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
            yield* Match.value(message.command).pipe(
              Match.when(WebviewMessages.ready, () => service.handleReady(ctx)),
              Match.when(WebviewMessages.refreshStatus, () =>
                service.handleRefreshStatus(ctx),
              ),
              Match.when(WebviewMessages.openLoginPage, () =>
                service.handleOpenLoginPage(message.url as string | undefined),
              ),
              Match.when(WebviewMessages.openSignupPage, () =>
                service.handleOpenSignupPage(message.url as string | undefined),
              ),
              Match.when(WebviewMessages.checkSession, () =>
                service.handleCheckSession(ctx),
              ),
              Match.when(WebviewMessages.logout, () =>
                service.handleLogout(ctx),
              ),
              Match.when(WebviewMessages.storeAuthToken, () =>
                service.handleStoreAuthToken(ctx, message.token as string),
              ),
              Match.when(WebviewMessages.authTokenReceived, () =>
                service.handleAuthTokenReceived(),
              ),
              Match.when(WebviewMessages.log, () =>
                service.handleLog(
                  ctx,
                  message.data as {
                    level?: string;
                    message: string;
                    data?: unknown;
                  },
                ),
              ),
              Match.when(WebviewMessages.getBranchChanges, () =>
                service.handleGetBranchChanges(ctx),
              ),
              Match.when(WebviewMessages.createTestForFile, () =>
                service.handleCreateTestForFile(
                  ctx,
                  message.filePath as string,
                ),
              ),
              Match.when(WebviewMessages.planTestGeneration, () =>
                service.handlePlanTestGeneration(
                  ctx,
                  message.files as string[],
                ),
              ),
              Match.when(WebviewMessages.confirmTestPlan, () =>
                service.handleConfirmTestPlan(
                  ctx,
                  message.acceptedIds as string[],
                  message.tests as Array<{
                    id: string;
                    sourceFile: string;
                    targetTestPath: string;
                    description: string;
                    isUpdate: boolean;
                  }>,
                ),
              ),
              Match.when(WebviewMessages.previewTestDiff, () =>
                service.handlePreviewTestDiff(
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
                ),
              ),
              Match.when(WebviewMessages.fetchConfig, () =>
                service.handleFetchConfig(),
              ),
              Match.when(WebviewMessages.configUpdated, () =>
                service.handleConfigUpdated(),
              ),
              Match.orElse(() =>
                Effect.die(`Unknown command: ${message.command}`),
              ),
            );
          }),
      };
    }),
    dependencies: [ReactFileFilterService.Default, ConfigServiceEffect.Default],
  },
) {}
