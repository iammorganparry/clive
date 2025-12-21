import * as vscode from "vscode";
import { CypressDetector } from "../services/cypress-detector.js";
import type { DiffContentProvider } from "../services/diff-content-provider.js";
import { getWebviewHtml } from "./webview-html.js";
import { Views } from "../constants.js";
import { Effect, Layer } from "effect";
import { GitService as GitServiceEffect } from "../services/git-service.js";
import { VSCodeService } from "../services/vs-code.js";
import { handleRpcMessage, isRpcMessage } from "../rpc/handler.js";
import type { RpcContext } from "../rpc/context.js";

/**
 * Webview view provider for Clive extension
 * Coordinates webview lifecycle and delegates message handling
 */
export class CliveViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = Views.mainView;

  private _webviewView?: vscode.WebviewView;
  private _context?: vscode.ExtensionContext;
  private _outputChannel?: vscode.OutputChannel;
  private _isDev: boolean = false;
  private themeChangeDisposable?: vscode.Disposable;
  private fileWatchers: vscode.FileSystemWatcher[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly diffProvider: DiffContentProvider,
  ) {}

  public setContext(context: vscode.ExtensionContext): void {
    this._context = context;
  }

  public setOutputChannel(outputChannel: vscode.OutputChannel): void {
    this._outputChannel = outputChannel;
  }

  public setIsDev(isDev: boolean): void {
    this._isDev = isDev;
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

    webviewView.webview.html = getWebviewHtml(
      webviewView.webview,
      this._extensionUri,
    );

    // Listen for theme changes (theme is now handled via RPC system.ready)
    this.themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme(
      () => {
        // Theme changes are handled via RPC system.getTheme query
      },
    );

    // Set up RPC message handling
    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        // Only handle RPC messages
        if (isRpcMessage(message)) {
          const rpcContext = this.createRpcContext(webviewView);
          if (rpcContext) {
            const response = await handleRpcMessage(message, rpcContext);
            if (response) {
              webviewView.webview.postMessage(response);
            }
          }
        }
      },
      null,
      [],
    );

    // Handle visibility changes
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        console.log("Clive view became visible");
        // Status checks are now handled via RPC queries in the webview
      }
    });

    // Set up file watchers
    this.setupFileWatchers(webviewView);
  }

  /**
   * Handle OAuth callback from URI handler
   * OAuth callbacks are now handled via RPC auth.storeToken
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
      console.error("OAuth error:", errorMessage || error);
      return;
    }

    if (token) {
      const rpcContext = this.createRpcContext(this._webviewView);
      if (rpcContext) {
        // Store token via RPC
        const rpcMessage = {
          id: `oauth-${Date.now()}`,
          type: "mutation" as const,
          path: ["auth", "storeToken"],
          input: { token },
        };
        const response = await handleRpcMessage(rpcMessage, rpcContext);
        if (response?.success) {
          // Send token to webview
          this._webviewView.webview.postMessage({
            command: "auth-token",
            token,
          });
        }
      }
    }
  }

  /**
   * Create RPC context with required dependencies
   */
  private createRpcContext(webviewView: vscode.WebviewView): RpcContext | null {
    if (!this._context || !this._outputChannel) {
      return null;
    }

    // Create a proxy for GitService that matches the expected interface
    const gitServiceProxy = {
      getBranchChanges: () => {
        return Effect.gen(function* () {
          const gitService = yield* GitServiceEffect;
          return yield* gitService.getBranchChanges();
        }).pipe(
          Effect.provide(
            Layer.merge(GitServiceEffect.Default, VSCodeService.Default),
          ),
        );
      },
    } as unknown as import("../services/git-service.js").GitService;

    return {
      webviewView,
      context: this._context,
      outputChannel: this._outputChannel,
      isDev: this._isDev,
      cypressDetector: new CypressDetector(),
      gitService: gitServiceProxy,
      reactFileFilter:
        {} as import("../services/react-file-filter.js").ReactFileFilter,
      diffProvider: this.diffProvider,
      configService:
        {} as import("../services/config-service.js").ConfigService,
    };
  }

  /**
   * Set up file system watchers for status updates
   */
  private setupFileWatchers(_webviewView: vscode.WebviewView): void {
    // Watch for package.json changes (status is now handled via RPC queries)
    const packageWatcher =
      vscode.workspace.createFileSystemWatcher("**/package.json");
    packageWatcher.onDidChange(() => {
      // Status updates are handled via RPC queries in the webview
    });
    packageWatcher.onDidCreate(() => {
      // Status updates are handled via RPC queries in the webview
    });
    packageWatcher.onDidDelete(() => {
      // Status updates are handled via RPC queries in the webview
    });

    // Watch for Cypress config file changes
    const configWatcher = vscode.workspace.createFileSystemWatcher(
      "**/cypress.config.{ts,js,mjs}",
    );
    configWatcher.onDidChange(() => {
      // Status updates are handled via RPC queries in the webview
    });
    configWatcher.onDidCreate(() => {
      // Status updates are handled via RPC queries in the webview
    });

    this.fileWatchers.push(packageWatcher, configWatcher);
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.themeChangeDisposable?.dispose();
    for (const watcher of this.fileWatchers) {
      watcher.dispose();
    }
    this.fileWatchers = [];
  }
}
