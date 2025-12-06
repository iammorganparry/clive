import * as vscode from "vscode";
import type { CypressDetector } from "./cypress-detector.js";
import type { GitService } from "./git-service.js";
import type { ReactFileFilter } from "./react-file-filter.js";
import type { CypressTestAgent } from "./ai-agent/agent.js";
import type { DiffContentProvider } from "./diff-content-provider.js";
import type { ConfigService } from "./config-service.js";
import { WebviewMessages, SecretKeys } from "../constants.js";

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
export class WebviewMessageHandler {
  constructor(private ctx: MessageHandlerContext) {}

  /**
   * Handle incoming message from webview
   */
  async handleMessage(message: {
    command: string;
    [key: string]: unknown;
  }): Promise<void> {
    switch (message.command) {
      case WebviewMessages.ready:
        await this.handleReady();
        break;
      case WebviewMessages.refreshStatus:
        await this.handleRefreshStatus();
        break;
      case WebviewMessages.openLoginPage:
        await this.handleOpenLoginPage(message.url as string | undefined);
        break;
      case WebviewMessages.openSignupPage:
        await this.handleOpenSignupPage(message.url as string | undefined);
        break;
      case WebviewMessages.checkSession:
        await this.handleCheckSession();
        break;
      case WebviewMessages.logout:
        await this.handleLogout();
        break;
      case WebviewMessages.log:
        this.handleLog(
          message.data as {
            level?: string;
            message: string;
            data?: unknown;
          },
        );
        break;
      case WebviewMessages.getBranchChanges:
        await this.handleGetBranchChanges();
        break;
      case WebviewMessages.createTestForFile:
        await this.handleCreateTestForFile(message.filePath as string);
        break;
      case WebviewMessages.planTestGeneration:
        await this.handlePlanTestGeneration((message.files as string[]) || []);
        break;
      case WebviewMessages.confirmTestPlan:
        await this.handleConfirmTestPlan(
          (message.acceptedIds as string[]) || [],
          (message.tests as Array<{
            id: string;
            sourceFile: string;
            targetTestPath: string;
            description: string;
            isUpdate: boolean;
          }>) || [],
        );
        break;
      case WebviewMessages.previewTestDiff:
        await this.handlePreviewTestDiff(
          (message.test as {
            id: string;
            targetTestPath: string;
            proposedContent: string;
            existingContent?: string;
            isUpdate: boolean;
          }) || undefined,
        );
        break;
      default:
        console.log(`Unknown command: ${message.command}`);
    }
  }

  private async handleReady(): Promise<void> {
    console.log("Clive webview is ready");
    await this.checkAndSendCypressStatus();
    await this.checkAndSendBranchChanges();
    await this.sendStoredAuthToken();
  }

  private async handleRefreshStatus(): Promise<void> {
    await this.checkAndSendCypressStatus();
  }

  private async handleOpenLoginPage(url?: string): Promise<void> {
    const callbackUrl = "vscode://clive.auth/callback";
    const loginUrl =
      url ||
      `http://localhost:3000/sign-in?callback_url=${encodeURIComponent(callbackUrl)}`;
    await vscode.env.openExternal(vscode.Uri.parse(loginUrl));
  }

  private async handleOpenSignupPage(url?: string): Promise<void> {
    const callbackUrl = "vscode://clive.auth/callback";
    const signupUrl =
      url ||
      `http://localhost:3000/sign-up?callback_url=${encodeURIComponent(callbackUrl)}`;
    await vscode.env.openExternal(vscode.Uri.parse(signupUrl));
  }

  private async handleCheckSession(): Promise<void> {
    await this.sendStoredAuthToken();
  }

  private async handleLogout(): Promise<void> {
    await this.ctx.context.secrets.delete(SecretKeys.authToken);
    await this.ctx.configService.clearApiKeys();
  }

  private handleLog(logData?: {
    level?: string;
    message: string;
    data?: unknown;
  }): void {
    if (!this.ctx.outputChannel || !logData) {
      return;
    }

    const level = logData.level || "info";
    const logMessage = logData.data
      ? `${logData.message}: ${JSON.stringify(logData.data, null, 2)}`
      : logData.message;
    this.ctx.outputChannel.appendLine(`[${level.toUpperCase()}] ${logMessage}`);
  }

  private async handleGetBranchChanges(): Promise<void> {
    await this.checkAndSendBranchChanges();
  }

  private async handleCreateTestForFile(filePath: string): Promise<void> {
    if (!(await this.ctx.testAgent.isConfigured())) {
      const action = await vscode.window.showErrorMessage(
        "Anthropic API key not configured. Please set 'clive.anthropicApiKey' in VS Code settings.",
        "Open Settings",
      );

      if (action === "Open Settings") {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "clive.anthropicApiKey",
        );
      }

      this.ctx.webviewView.webview.postMessage({
        command: WebviewMessages.testGenerationStatus,
        success: false,
        error: "API key not configured",
        filePath,
      });
      return;
    }

    this.ctx.webviewView.webview.postMessage({
      command: WebviewMessages.testGenerationProgress,
      filePath,
      status: "starting",
      message: `Starting test generation for ${filePath}...`,
    });

    vscode.window.showInformationMessage(
      `Creating Cypress test for ${filePath}...`,
    );

    try {
      const result = await this.ctx.testAgent.generateTest(
        {
          sourceFilePath: filePath,
          options: {
            updateExisting: false,
          },
        },
        this.ctx.outputChannel,
      );

      if (result.success) {
        vscode.window.showInformationMessage(
          `Cypress test generated successfully: ${result.testFilePath || filePath}`,
        );

        this.ctx.webviewView.webview.postMessage({
          command: WebviewMessages.testGenerationStatus,
          success: true,
          filePath,
          testFilePath: result.testFilePath,
          testContent: result.testContent,
        });
      } else {
        vscode.window.showErrorMessage(
          `Failed to generate test: ${result.error || "Unknown error"}`,
        );

        this.ctx.webviewView.webview.postMessage({
          command: WebviewMessages.testGenerationStatus,
          success: false,
          error: result.error || "Unknown error",
          filePath,
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      vscode.window.showErrorMessage(`Failed to create test: ${errorMessage}`);

      this.ctx.webviewView.webview.postMessage({
        command: WebviewMessages.testGenerationStatus,
        success: false,
        error: errorMessage,
        filePath,
      });
    }
  }

  private async handlePlanTestGeneration(files: string[]): Promise<void> {
    if (!(await this.ctx.testAgent.isConfigured())) {
      const action = await vscode.window.showErrorMessage(
        "Anthropic API key not configured. Please set 'clive.anthropicApiKey' in VS Code settings.",
        "Open Settings",
      );

      if (action === "Open Settings") {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "clive.anthropicApiKey",
        );
      }

      this.ctx.webviewView.webview.postMessage({
        command: WebviewMessages.testGenerationPlan,
        tests: [],
        error: "API key not configured",
      });
      return;
    }

    if (files.length === 0) {
      this.ctx.webviewView.webview.postMessage({
        command: WebviewMessages.testGenerationPlan,
        tests: [],
        error: "No files provided",
      });
      return;
    }

    vscode.window.showInformationMessage(
      `Planning Cypress tests for ${files.length} file(s)...`,
    );

    try {
      const plan = await this.ctx.testAgent.planTests(
        files,
        this.ctx.outputChannel,
      );

      this.ctx.webviewView.webview.postMessage({
        command: WebviewMessages.testGenerationPlan,
        tests: plan.tests,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      vscode.window.showErrorMessage(`Failed to plan tests: ${errorMessage}`);

      this.ctx.webviewView.webview.postMessage({
        command: WebviewMessages.testGenerationPlan,
        tests: [],
        error: errorMessage,
      });
    }
  }

  private async handleConfirmTestPlan(
    acceptedIds: string[],
    proposedTests: Array<{
      id: string;
      sourceFile: string;
      targetTestPath: string;
      description: string;
      isUpdate: boolean;
    }>,
  ): Promise<void> {
    if (acceptedIds.length === 0) {
      return;
    }

    const testsToExecute = proposedTests.filter((test) =>
      acceptedIds.includes(test.id),
    );

    vscode.window.showInformationMessage(
      `Generating ${testsToExecute.length} Cypress test(s)...`,
    );

    for (const test of testsToExecute) {
      this.ctx.webviewView.webview.postMessage({
        command: WebviewMessages.testExecutionUpdate,
        id: test.id,
        executionStatus: "in_progress",
      });

      try {
        const result = await this.ctx.testAgent.executeTest(
          {
            sourceFile: test.sourceFile,
            targetTestPath: test.targetTestPath,
            description: test.description,
            isUpdate: test.isUpdate,
          },
          this.ctx.outputChannel,
        );

        if (result.success) {
          this.ctx.webviewView.webview.postMessage({
            command: WebviewMessages.testExecutionUpdate,
            id: test.id,
            executionStatus: "completed",
            testFilePath: result.testFilePath,
            message: result.testContent,
          });
        } else {
          this.ctx.webviewView.webview.postMessage({
            command: WebviewMessages.testExecutionUpdate,
            id: test.id,
            executionStatus: "error",
            error: result.error || "Unknown error",
          });
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        this.ctx.webviewView.webview.postMessage({
          command: WebviewMessages.testExecutionUpdate,
          id: test.id,
          executionStatus: "error",
          error: errorMessage,
        });
      }
    }
  }

  private async handlePreviewTestDiff(
    test:
      | {
          id: string;
          targetTestPath: string;
          proposedContent: string;
          existingContent?: string;
          isUpdate: boolean;
        }
      | undefined,
  ): Promise<void> {
    if (!test) {
      return;
    }

    try {
      const proposedUri = this.ctx.diffProvider.storeContent(
        test.id,
        test.proposedContent,
        "proposed",
      );

      let originalUri: vscode.Uri;
      if (test.isUpdate && test.existingContent) {
        originalUri = this.ctx.diffProvider.storeContent(
          test.id,
          test.existingContent,
          "existing",
        );
      } else {
        originalUri = this.ctx.diffProvider.storeContent(test.id, "", "empty");
      }

      await vscode.commands.executeCommand(
        "vscode.diff",
        originalUri,
        proposedUri,
        `${test.targetTestPath} (Preview)`,
        {
          viewColumn: vscode.ViewColumn.Active,
        },
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      vscode.window.showErrorMessage(
        `Failed to preview test diff: ${errorMessage}`,
      );
    }
  }

  private async checkAndSendCypressStatus(): Promise<void> {
    const status = await this.ctx.cypressDetector.checkStatus();
    if (status) {
      this.ctx.webviewView.webview.postMessage({
        command: WebviewMessages.cypressStatus,
        status,
      });
    } else {
      this.ctx.webviewView.webview.postMessage({
        command: WebviewMessages.cypressStatus,
        status: {
          overallStatus: "not_installed" as const,
          packages: [],
          workspaceRoot: "",
        },
        error: "No workspace folder found",
      });
    }
  }

  private async checkAndSendBranchChanges(): Promise<void> {
    try {
      const branchChanges = await this.ctx.gitService.getBranchChanges();
      if (!branchChanges) {
        this.ctx.webviewView.webview.postMessage({
          command: WebviewMessages.branchChangesStatus,
          changes: null,
          error: "No workspace folder found or not a git repository",
        });
        return;
      }

      const eligibleFiles = await this.ctx.reactFileFilter.filterEligibleFiles(
        branchChanges.files,
      );

      this.ctx.webviewView.webview.postMessage({
        command: WebviewMessages.branchChangesStatus,
        changes: {
          branchName: branchChanges.branchName,
          baseBranch: branchChanges.baseBranch,
          files: eligibleFiles,
          workspaceRoot: branchChanges.workspaceRoot,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.ctx.webviewView.webview.postMessage({
        command: WebviewMessages.branchChangesStatus,
        changes: null,
        error: errorMessage,
      });
    }
  }

  private async sendStoredAuthToken(): Promise<void> {
    const token = await this.ctx.context.secrets.get(SecretKeys.authToken);
    if (token) {
      this.ctx.webviewView.webview.postMessage({
        command: WebviewMessages.authToken,
        token,
      });
    }
  }

  /**
   * Send theme information to webview
   */
  sendThemeInfo(): void {
    const colorTheme = vscode.window.activeColorTheme;
    const colorScheme =
      colorTheme.kind === vscode.ColorThemeKind.Dark ||
      colorTheme.kind === vscode.ColorThemeKind.HighContrast
        ? "dark"
        : "light";

    this.ctx.webviewView.webview.postMessage({
      command: WebviewMessages.themeInfo,
      colorScheme,
    });
  }

  /**
   * Handle OAuth callback
   */
  async handleOAuthCallback(uri: vscode.Uri): Promise<void> {
    const params = new URLSearchParams(uri.query);
    const token = params.get("token");
    const error = params.get("error");
    const errorMessage = params.get("message");

    if (error) {
      this.ctx.webviewView.webview.postMessage({
        command: WebviewMessages.oauthCallback,
        error: errorMessage || error,
      });
      return;
    }

    if (token) {
      // Store auth token in SecretStorage
      await this.ctx.context.secrets.store(SecretKeys.authToken, token);

      // Fetch API keys from backend and store them
      await this.fetchAndStoreApiKeys(token);

      this.ctx.webviewView.webview.postMessage({
        command: WebviewMessages.authToken,
        token,
      });
    } else {
      this.ctx.webviewView.webview.postMessage({
        command: WebviewMessages.oauthCallback,
        error: "No token received",
      });
    }
  }

  /**
   * Fetch API keys from backend and store them in SecretStorage
   */
  private async fetchAndStoreApiKeys(authToken: string): Promise<void> {
    try {
      const backendUrl = "http://localhost:3000";
      // tRPC query format: POST to /api/trpc/[procedure] with JSON input
      const response = await fetch(`${backendUrl}/api/trpc/config.getApiKeys`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch API keys: ${response.statusText}`);
      }

      const data = await response.json();
      // tRPC response format: { result: { data: { json: {...} } } }
      const apiKeys = data.result?.data?.json;

      if (apiKeys?.anthropicApiKey) {
        await this.ctx.configService.storeApiKeys({
          anthropicApiKey: apiKeys.anthropicApiKey,
        });

        this.ctx.webviewView.webview.postMessage({
          command: WebviewMessages.configUpdated,
        });

        this.ctx.outputChannel.appendLine(
          "API keys fetched and stored successfully",
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.ctx.outputChannel.appendLine(
        `Failed to fetch API keys: ${errorMessage}`,
      );
      // Don't throw - allow auth to proceed even if config fetch fails
    }
  }
}
