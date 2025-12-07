import * as vscode from "vscode";
import type { CypressDetector } from "./cypress-detector.js";
import type { GitService } from "./git-service.js";
import type { ReactFileFilter } from "./react-file-filter.js";
import type { CypressTestAgent } from "./ai-agent/agent.js";
import type { DiffContentProvider } from "./diff-content-provider.js";
import { WebviewMessages, SecretKeys } from "../constants.js";
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
  testAgent: CypressTestAgent;
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

        handleLogout: (ctx: MessageHandlerContext) =>
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              ctx.context.secrets.delete(SecretKeys.authToken),
            );
            const configService = yield* ConfigServiceEffect;
            yield* configService.storeAiApiKey("");
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
            const isConfigured = yield* Effect.promise(() =>
              ctx.testAgent.isConfigured(),
            );

            if (!isConfigured) {
              const action = yield* Effect.promise(() =>
                vscode.window.showErrorMessage(
                  "Anthropic API key not configured. Please set 'clive.anthropicApiKey' in VS Code settings.",
                  "Open Settings",
                ),
              );

              if (action === "Open Settings") {
                yield* Effect.promise(() =>
                  vscode.commands.executeCommand(
                    "workbench.action.openSettings",
                    "clive.anthropicApiKey",
                  ),
                );
              }

              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.testGenerationStatus,
                success: false,
                error: "API key not configured",
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

            const result = yield* Effect.tryPromise({
              try: () =>
                ctx.testAgent.generateTest(
                  {
                    sourceFilePath: filePath,
                    options: {
                      updateExisting: false,
                    },
                  },
                  ctx.outputChannel,
                ),
              catch: (error) =>
                new Error(
                  error instanceof Error ? error.message : "Unknown error",
                ),
            });

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
            const isConfigured = yield* Effect.promise(() =>
              ctx.testAgent.isConfigured(),
            );

            if (!isConfigured) {
              const action = yield* Effect.promise(() =>
                vscode.window.showErrorMessage(
                  "Anthropic API key not configured. Please set 'clive.anthropicApiKey' in VS Code settings.",
                  "Open Settings",
                ),
              );

              if (action === "Open Settings") {
                yield* Effect.promise(() =>
                  vscode.commands.executeCommand(
                    "workbench.action.openSettings",
                    "clive.anthropicApiKey",
                  ),
                );
              }

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

            yield* Effect.promise(() =>
              vscode.window.showInformationMessage(
                `Planning Cypress tests for ${files.length} file(s)...`,
              ),
            );

            const plan = yield* Effect.tryPromise({
              try: () => ctx.testAgent.planTests(files, ctx.outputChannel),
              catch: (error) =>
                new Error(
                  error instanceof Error ? error.message : "Unknown error",
                ),
            });

            ctx.webviewView.webview.postMessage({
              command: WebviewMessages.testGenerationPlan,
              tests: plan.tests,
            });
          }).pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                const errorMessage =
                  error instanceof Error ? error.message : "Unknown error";
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

              const result = yield* Effect.tryPromise({
                try: () =>
                  ctx.testAgent.executeTest(
                    {
                      sourceFile: test.sourceFile,
                      targetTestPath: test.targetTestPath,
                      description: test.description,
                      isUpdate: test.isUpdate,
                    },
                    ctx.outputChannel,
                  ),
                catch: (error) =>
                  new Error(
                    error instanceof Error ? error.message : "Unknown error",
                  ),
              });

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
            const token = yield* Effect.promise(() =>
              ctx.context.secrets.get(SecretKeys.authToken),
            );
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
              yield* Effect.promise(() =>
                ctx.context.secrets.store(SecretKeys.authToken, token),
              );

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
            const configService = yield* ConfigServiceEffect;

            const apiKeys = yield* Effect.tryPromise({
              try: async () => {
                const backendUrl = "http://localhost:3000";
                const response = await fetch(
                  `${backendUrl}/api/trpc/config.getApiKeys`,
                  {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${authToken}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({}),
                  },
                );

                if (!response.ok) {
                  throw new Error(
                    `Failed to fetch API keys: ${response.statusText}`,
                  );
                }

                const data = await response.json();
                return data.result?.data?.json;
              },
              catch: (error) =>
                new Error(
                  error instanceof Error ? error.message : "Unknown error",
                ),
            });

            if (apiKeys?.anthropicApiKey) {
              yield* configService.storeAiApiKey(apiKeys.anthropicApiKey);

              ctx.webviewView.webview.postMessage({
                command: WebviewMessages.configUpdated,
              });

              ctx.outputChannel.appendLine(
                "API keys fetched and stored successfully",
              );
            }
          }).pipe(
            Effect.catchAll((error) =>
              Effect.sync(() => {
                const errorMessage =
                  error instanceof Error ? error.message : "Unknown error";
                ctx.outputChannel.appendLine(
                  `Failed to fetch API keys: ${errorMessage}`,
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
