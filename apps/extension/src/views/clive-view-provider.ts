import * as vscode from "vscode";
import { CypressDetector } from "../services/cypress-detector.js";
import { GitService } from "../services/git-service.js";
import { ReactFileFilter } from "../services/react-file-filter.js";
import { CypressTestAgent } from "../services/ai-agent/agent.js";
import { Views, WebviewMessages } from "../constants.js";

// Custom JWT authentication - token stored in VS Code persistent state

export class CliveViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = Views.mainView;

  private _webviewView?: vscode.WebviewView;
  private _context?: vscode.ExtensionContext;
  private _outputChannel?: vscode.OutputChannel;
  private cypressDetector: CypressDetector;
  private gitService: GitService;
  private reactFileFilter: ReactFileFilter;
  private testAgent: CypressTestAgent;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this.cypressDetector = new CypressDetector();
    this.gitService = new GitService();
    this.reactFileFilter = new ReactFileFilter();
    this.testAgent = new CypressTestAgent();
  }

  public setContext(context: vscode.ExtensionContext): void {
    this._context = context;
  }

  public setOutputChannel(outputChannel: vscode.OutputChannel): void {
    this._outputChannel = outputChannel;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Send initial theme info
    this.sendThemeInfo();

    // Listen for theme changes
    const themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme(
      () => {
        this.sendThemeInfo();
      },
    );

    // Clean up on dispose
    webviewView.onDidDispose(() => {
      themeChangeDisposable.dispose();
    });

    // Set up message handling
    webviewView.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case WebviewMessages.ready:
            console.log("Clive webview is ready");
            // Check Cypress status when webview is ready
            this.checkAndSendCypressStatus();
            // Check branch changes when webview is ready
            this.checkAndSendBranchChanges();
            // Send stored auth token if available
            this.sendStoredAuthToken();
            break;
          case WebviewMessages.refreshStatus:
            this.checkAndSendCypressStatus();
            break;
          case WebviewMessages.openLoginPage:
            this.handleOpenLoginPage(message.url as string | undefined);
            break;
          case WebviewMessages.openSignupPage:
            this.handleOpenSignupPage(message.url as string | undefined);
            break;
          case WebviewMessages.checkSession:
            this.sendStoredAuthToken();
            break;
          case WebviewMessages.logout:
            this.handleLogout();
            break;
          case WebviewMessages.log:
            if (this._outputChannel && message.data) {
              const logData = message.data as {
                level?: string;
                message: string;
                data?: unknown;
              };
              const level = logData.level || "info";
              const logMessage = logData.data
                ? `${logData.message}: ${JSON.stringify(logData.data, null, 2)}`
                : logData.message;
              this._outputChannel.appendLine(
                `[${level.toUpperCase()}] ${logMessage}`,
              );
            }
            break;
          case WebviewMessages.getBranchChanges:
            this.checkAndSendBranchChanges();
            break;
          case WebviewMessages.createTestForFile:
            this.handleCreateTestForFile(message.filePath as string);
            break;
          case WebviewMessages.planTestGeneration:
            this.handlePlanTestGeneration((message.files as string[]) || []);
            break;
          case WebviewMessages.confirmTestPlan:
            this.handleConfirmTestPlan(
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
          default:
            console.log(`Unknown command: ${message.command}`);
        }
      },
      null,
      [],
    );

    // Handle visibility changes
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        console.log("Clive view became visible");
        // Check Cypress status when view becomes visible
        this.checkAndSendCypressStatus();
        // Check branch changes when view becomes visible
        this.checkAndSendBranchChanges();
      }
    });

    // Watch for file changes to re-check status
    const watcher = vscode.workspace.createFileSystemWatcher("**/package.json");
    watcher.onDidChange(() => {
      if (webviewView.visible) {
        this.checkAndSendCypressStatus();
      }
    });
    watcher.onDidCreate(() => {
      if (webviewView.visible) {
        this.checkAndSendCypressStatus();
      }
    });
    watcher.onDidDelete(() => {
      if (webviewView.visible) {
        this.checkAndSendCypressStatus();
      }
    });

    // Watch for cypress config file changes
    const configWatcher = vscode.workspace.createFileSystemWatcher(
      "**/cypress.config.{ts,js,mjs}",
    );
    configWatcher.onDidChange(() => {
      if (webviewView.visible) {
        this.checkAndSendCypressStatus();
      }
    });
    configWatcher.onDidCreate(() => {
      if (webviewView.visible) {
        this.checkAndSendCypressStatus();
      }
    });
  }

  /**
   * Check Cypress status and send to webview
   */
  private async checkAndSendCypressStatus(): Promise<void> {
    if (!this._webviewView) {
      return;
    }

    const status = await this.cypressDetector.checkStatus();
    if (status) {
      this._webviewView.webview.postMessage({
        command: WebviewMessages.cypressStatus,
        status,
      });
    } else {
      this._webviewView.webview.postMessage({
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

  /**
   * Send theme information to webview
   */
  private sendThemeInfo(): void {
    if (!this._webviewView) {
      return;
    }

    const colorTheme = vscode.window.activeColorTheme;
    const colorScheme =
      colorTheme.kind === vscode.ColorThemeKind.Dark ||
      colorTheme.kind === vscode.ColorThemeKind.HighContrast
        ? "dark"
        : "light";

    this._webviewView.webview.postMessage({
      command: WebviewMessages.themeInfo,
      colorScheme,
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    // Get URIs for built webview assets
    const webviewUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "webview.js"),
    );
    const webviewCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "webview.css"),
    );

    // Generate nonce for CSP
    const nonce = getNonce();

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; connect-src http://localhost:3000;">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Clive</title>
				<link href="${webviewCssUri}" rel="stylesheet">
				<style>
					html {
						margin: 0;
						padding: 0;
						width: 100%;
						height: 100%;
					}
					body {
						margin: 0;
						padding: 0;
						width: 100%;
						height: 100%;
						overflow: hidden;
					}
					#root {
						width: 100%;
						height: 100%;
					}
				</style>
			</head>
			<body>
				<div id="root">
					<div style="padding: 20px; color: red;">Loading...</div>
				</div>
				<script nonce="${nonce}">
					console.log("Webview HTML loaded");
					console.log("Script source:", "${webviewUri.toString()}");
					console.log("CSS source:", "${webviewCssUri.toString()}");
					
					// Add error handler for script loading
					window.addEventListener("error", (event) => {
						console.error("Script error:", event.error);
						console.error("Error details:", {
							message: event.message,
							filename: event.filename,
							lineno: event.lineno,
							colno: event.colno
						});
					});
					
					// Check if script loaded after a delay
					setTimeout(() => {
						if (document.getElementById("root")?.innerHTML.includes("Loading...")) {
							console.error("React did not mount! Script may have failed to load.");
							console.error("Check Network tab for webview.js loading errors.");
						}
					}, 2000);
				</script>
				<script nonce="${nonce}" src="${webviewUri}" onerror="console.error('Failed to load webview.js script!')"></script>
			</body>
			</html>`;
  }

  /**
   * Handle OAuth callback from URI handler
   * This is called when the VS Code deep link is opened after OAuth completes
   */
  public async handleOAuthCallback(uri: vscode.Uri): Promise<void> {
    if (!this._webviewView || !this._context) {
      return;
    }

    const params = new URLSearchParams(uri.query);
    const token = params.get("token");
    const error = params.get("error");
    const errorMessage = params.get("message");

    if (error) {
      // Authentication failed
      this._webviewView.webview.postMessage({
        command: WebviewMessages.oauthCallback,
        error: errorMessage || error,
      });
      return;
    }

    if (token) {
      // Authentication successful - save token to persistent state
      await this._context.globalState.update("auth_token", token);

      // Send token to webview
      this._webviewView.webview.postMessage({
        command: WebviewMessages.authToken,
        token,
      });
    } else {
      // Unknown state
      this._webviewView.webview.postMessage({
        command: WebviewMessages.oauthCallback,
        error: "No token received",
      });
    }
  }

  /**
   * Send stored auth token to webview
   */
  private sendStoredAuthToken(): void {
    if (!this._webviewView || !this._context) {
      return;
    }

    const token = this._context.globalState.get<string>("auth_token");
    if (token) {
      this._webviewView.webview.postMessage({
        command: WebviewMessages.authToken,
        token,
      });
    }
  }

  /**
   * Handle logout request from webview
   */
  private handleLogout(): void {
    if (!this._context) {
      return;
    }

    // Remove token from persistent state
    this._context.globalState.update("auth_token", undefined);
  }

  /**
   * Handle open login page request from webview
   */
  private async handleOpenLoginPage(url?: string): Promise<void> {
    const callbackUrl = "vscode://clive.auth/callback";
    const loginUrl =
      url ||
      `http://localhost:3000/sign-in?callback_url=${encodeURIComponent(callbackUrl)}`;
    await vscode.env.openExternal(vscode.Uri.parse(loginUrl));
  }

  /**
   * Handle open signup page request from webview
   */
  private async handleOpenSignupPage(url?: string): Promise<void> {
    const callbackUrl = "vscode://clive.auth/callback";
    const signupUrl =
      url ||
      `http://localhost:3000/sign-up?callback_url=${encodeURIComponent(callbackUrl)}`;
    await vscode.env.openExternal(vscode.Uri.parse(signupUrl));
  }

  /**
   * Check branch changes and send to webview
   */
  private async checkAndSendBranchChanges(): Promise<void> {
    if (!this._webviewView) {
      return;
    }

    try {
      const branchChanges = await this.gitService.getBranchChanges();
      if (!branchChanges) {
        this._webviewView.webview.postMessage({
          command: WebviewMessages.branchChangesStatus,
          changes: null,
          error: "No workspace folder found or not a git repository",
        });
        return;
      }

      // Filter to only eligible React files
      const eligibleFiles = await this.reactFileFilter.filterEligibleFiles(
        branchChanges.files,
      );

      this._webviewView.webview.postMessage({
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
      this._webviewView.webview.postMessage({
        command: WebviewMessages.branchChangesStatus,
        changes: null,
        error: errorMessage,
      });
    }
  }

  /**
   * Handle create test request for a specific file
   */
  private async handleCreateTestForFile(filePath: string): Promise<void> {
    if (!this._webviewView) {
      return;
    }

    // Check if agent is configured
    if (!this.testAgent.isConfigured()) {
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

      this._webviewView.webview.postMessage({
        command: WebviewMessages.testGenerationStatus,
        success: false,
        error: "API key not configured",
        filePath,
      });
      return;
    }

    // Send progress update
    this._webviewView.webview.postMessage({
      command: WebviewMessages.testGenerationProgress,
      filePath,
      status: "starting",
      message: `Starting test generation for ${filePath}...`,
    });

    vscode.window.showInformationMessage(
      `Creating Cypress test for ${filePath}...`,
    );

    try {
      const result = await this.testAgent.generateTest(
        {
          sourceFilePath: filePath,
          options: {
            updateExisting: false,
          },
        },
        this._outputChannel,
      );

      if (result.success) {
        vscode.window.showInformationMessage(
          `Cypress test generated successfully: ${result.testFilePath || filePath}`,
        );

        this._webviewView.webview.postMessage({
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

        this._webviewView.webview.postMessage({
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

      this._webviewView.webview.postMessage({
        command: WebviewMessages.testGenerationStatus,
        success: false,
        error: errorMessage,
        filePath,
      });
    }
  }

  /**
   * Handle plan test generation request
   * Analyzes files and sends proposed test plan to webview
   */
  private async handlePlanTestGeneration(files: string[]): Promise<void> {
    if (!this._webviewView) {
      return;
    }

    // Check if agent is configured
    if (!this.testAgent.isConfigured()) {
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

      this._webviewView.webview.postMessage({
        command: WebviewMessages.testGenerationPlan,
        tests: [],
        error: "API key not configured",
      });
      return;
    }

    if (files.length === 0) {
      this._webviewView.webview.postMessage({
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
      const plan = await this.testAgent.planTests(files, this._outputChannel);

      this._webviewView.webview.postMessage({
        command: WebviewMessages.testGenerationPlan,
        tests: plan.tests,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      vscode.window.showErrorMessage(`Failed to plan tests: ${errorMessage}`);

      this._webviewView.webview.postMessage({
        command: WebviewMessages.testGenerationPlan,
        tests: [],
        error: errorMessage,
      });
    }
  }

  /**
   * Handle confirm test plan request
   * Executes accepted tests sequentially with status updates
   */
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
    if (!this._webviewView) {
      return;
    }

    if (acceptedIds.length === 0) {
      return;
    }

    // Filter to only accepted tests
    const testsToExecute = proposedTests.filter((test) =>
      acceptedIds.includes(test.id),
    );

    vscode.window.showInformationMessage(
      `Generating ${testsToExecute.length} Cypress test(s)...`,
    );

    // Execute tests sequentially with status updates
    for (const test of testsToExecute) {
      // Send in-progress status
      this._webviewView.webview.postMessage({
        command: WebviewMessages.testExecutionUpdate,
        id: test.id,
        executionStatus: "in_progress",
      });

      try {
        const result = await this.testAgent.executeTest(
          {
            sourceFile: test.sourceFile,
            targetTestPath: test.targetTestPath,
            description: test.description,
            isUpdate: test.isUpdate,
          },
          this._outputChannel,
        );

        if (result.success) {
          // Send completed status
          this._webviewView.webview.postMessage({
            command: WebviewMessages.testExecutionUpdate,
            id: test.id,
            executionStatus: "completed",
            testFilePath: result.testFilePath,
            message: result.testContent,
          });
        } else {
          // Send error status
          this._webviewView.webview.postMessage({
            command: WebviewMessages.testExecutionUpdate,
            id: test.id,
            executionStatus: "error",
            error: result.error || "Unknown error",
          });
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        // Send error status
        this._webviewView.webview.postMessage({
          command: WebviewMessages.testExecutionUpdate,
          id: test.id,
          executionStatus: "error",
          error: errorMessage,
        });
      }
    }
  }
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
