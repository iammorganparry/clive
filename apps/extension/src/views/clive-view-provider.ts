import * as vscode from "vscode";
import { Console, Effect, Runtime, pipe } from "effect";
import { checkCypressStatus } from "../services/cypress-detector.js";
import { setupCypress } from "../services/cypress-setup.js";
import { Views, WebviewMessages } from "../constants.js";

const AUTH_BASE_URL = "http://localhost:3000/api/auth";
const SESSION_STORAGE_KEY = "clive.session";

interface Session {
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
  session: {
    id: string;
    expiresAt: Date;
  };
}

export class CliveViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = Views.mainView;

  private _webviewView?: vscode.WebviewView;
  private _context?: vscode.ExtensionContext;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public setContext(context: vscode.ExtensionContext): void {
    this._context = context;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
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
      }
    );

    // Clean up on dispose
    webviewView.onDidDispose(() => {
      themeChangeDisposable.dispose();
    });

    // Set up message handling using Effect
    webviewView.webview.onDidReceiveMessage(
      (message) => {
        pipe(
          Effect.sync(() => {
            switch (message.command) {
              case WebviewMessages.ready:
                Console.log("Clive webview is ready");
                // Check session and Cypress status when webview is ready
                this.checkAndSendSession();
                this.checkAndSendCypressStatus();
                break;
              case WebviewMessages.checkSession:
                this.checkAndSendSession();
                break;
              case WebviewMessages.login:
                this.handleEmailLogin(
                  message.email as string,
                  message.password as string
                );
                break;
              case WebviewMessages.logout:
                this.handleLogout();
                break;
              case WebviewMessages.startOAuth:
                this.handleStartOAuth();
                break;
              case WebviewMessages.setupCypress:
                this.handleSetupCypress(message.targetDirectory);
                break;
              case WebviewMessages.refreshStatus:
                this.checkAndSendCypressStatus();
                break;
              default:
                Console.log(`Unknown command: ${message.command}`);
            }
          }),
          Runtime.runPromise(Runtime.defaultRuntime)
        );
      },
      null,
      []
    );

    // Handle visibility changes
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        pipe(
          Effect.sync(() => {
            Console.log("Clive view became visible");
            // Check Cypress status when view becomes visible
            this.checkAndSendCypressStatus();
          }),
          Runtime.runPromise(Runtime.defaultRuntime)
        );
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
      "**/cypress.config.{ts,js,mjs}"
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

    const status = await checkCypressStatus();
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

  /**
   * Handle Cypress setup request from webview
   */
  private async handleSetupCypress(targetDirectory?: string): Promise<void> {
    if (!this._webviewView) {
      return;
    }

    // Determine target directory
    let targetDir: string;
    if (targetDirectory) {
      targetDir = targetDirectory;
    } else {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        this._webviewView.webview.postMessage({
          command: WebviewMessages.setupError,
          error: "No workspace folder found",
        });
        return;
      }
      targetDir = workspaceFolders[0].uri.fsPath;
    }

    // Send loading state
    this._webviewView.webview.postMessage({
      command: WebviewMessages.setupStart,
      targetDirectory: targetDir,
    });

    try {
      await setupCypress({ targetDirectory: targetDir });

      // Wait a bit for the command to start, then re-check status
      setTimeout(() => {
        this.checkAndSendCypressStatus();
      }, 2000);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this._webviewView.webview.postMessage({
        command: WebviewMessages.setupError,
        error: errorMessage,
      });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    // Get URIs for built webview assets
    const webviewUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "webview.js")
    );
    const webviewCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "webview.css")
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
			</head>
			<body>
				<div id="root"></div>
				<script nonce="${nonce}" src="${webviewUri}"></script>
			</body>
			</html>`;
  }

  /**
   * Handle OAuth callback from URI handler
   */
  public async handleOAuthCallback(uri: vscode.Uri): Promise<void> {
    if (!this._webviewView || !this._context) {
      return;
    }

    const params = new URLSearchParams(uri.query);
    const code = params.get("code");
    const state = params.get("state");

    if (!code) {
      this._webviewView.webview.postMessage({
        command: WebviewMessages.oauthCallback,
        error: "No authorization code received",
      });
      return;
    }

    try {
      // Exchange code for session
      const response = await fetch(`${AUTH_BASE_URL}/callback/github`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code, state }),
      });

      if (!response.ok) {
        throw new Error("Failed to exchange code for session");
      }

      // Get session from cookies or response
      const sessionResponse = await fetch(`${AUTH_BASE_URL}/get-session`, {
        method: "GET",
        credentials: "include",
      });

      if (sessionResponse.ok) {
        const sessionData = await sessionResponse.json();
        if (sessionData.session) {
          await this.storeSession(sessionData.session);
          this._webviewView.webview.postMessage({
            command: WebviewMessages.oauthCallback,
            session: sessionData.session,
          });
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "OAuth callback failed";
      this._webviewView.webview.postMessage({
        command: WebviewMessages.oauthCallback,
        error: errorMessage,
      });
    }
  }

  /**
   * Check session and send to webview
   */
  private async checkAndSendSession(): Promise<void> {
    if (!this._webviewView) {
      return;
    }

    const session = await this.getStoredSession();
    this._webviewView.webview.postMessage({
      command: WebviewMessages.sessionStatus,
      session: session || undefined,
    });
  }

  /**
   * Handle email/password login
   */
  private async handleEmailLogin(
    email: string,
    password: string
  ): Promise<void> {
    if (!this._webviewView) {
      return;
    }

    try {
      const response = await fetch(`${AUTH_BASE_URL}/sign-in/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Login failed");
      }

      const sessionData = await response.json();
      if (sessionData.session) {
        await this.storeSession(sessionData.session);
        this._webviewView.webview.postMessage({
          command: WebviewMessages.loginSuccess,
          session: sessionData.session,
        });
      } else {
        throw new Error("No session received");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Login failed";
      this._webviewView.webview.postMessage({
        command: WebviewMessages.loginError,
        error: errorMessage,
      });
    }
  }

  /**
   * Handle logout
   */
  private async handleLogout(): Promise<void> {
    if (!this._webviewView || !this._context) {
      return;
    }

    try {
      await fetch(`${AUTH_BASE_URL}/sign-out`, {
        method: "POST",
      });

      await this._context.secrets.delete(SESSION_STORAGE_KEY);
      this._webviewView.webview.postMessage({
        command: WebviewMessages.loginSuccess,
        session: undefined,
      });
    } catch (error) {
      // Even if logout fails, clear local session
      await this._context.secrets.delete(SESSION_STORAGE_KEY);
      this._webviewView.webview.postMessage({
        command: WebviewMessages.loginSuccess,
        session: undefined,
      });
    }
  }

  /**
   * Start GitHub OAuth flow
   */
  private async handleStartOAuth(): Promise<void> {
    if (!this._webviewView) {
      return;
    }

    try {
      // Get OAuth URL from Better Auth
      const callbackURL = "vscode://clive.auth/callback";
      const response = await fetch(`${AUTH_BASE_URL}/sign-in/social`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "github",
          callbackURL,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to start OAuth flow");
      }

      const data = await response.json();
      if (data.url) {
        // Open external browser for OAuth
        await vscode.env.openExternal(vscode.Uri.parse(data.url));
        // The callback will be handled by handleOAuthCallback
      } else {
        throw new Error("No OAuth URL received");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to start OAuth";
      this._webviewView.webview.postMessage({
        command: WebviewMessages.oauthCallback,
        error: errorMessage,
      });
    }
  }

  /**
   * Store session in VS Code secure storage
   */
  private async storeSession(session: Session): Promise<void> {
    if (!this._context) {
      return;
    }

    await this._context.secrets.store(
      SESSION_STORAGE_KEY,
      JSON.stringify(session)
    );
  }

  /**
   * Get stored session from VS Code secure storage
   */
  private async getStoredSession(): Promise<Session | null> {
    if (!this._context) {
      return null;
    }

    try {
      const sessionStr = await this._context.secrets.get(SESSION_STORAGE_KEY);
      if (!sessionStr) {
        return null;
      }

      const session = JSON.parse(sessionStr) as Session;
      // Check if session is expired
      if (new Date(session.session.expiresAt) < new Date()) {
        await this._context.secrets.delete(SESSION_STORAGE_KEY);
        return null;
      }

      return session;
    } catch {
      return null;
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
