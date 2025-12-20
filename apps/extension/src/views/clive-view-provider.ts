import * as vscode from "vscode";
import { CypressDetector } from "../services/cypress-detector.js";
import { CypressTestAgent } from "../services/ai-agent/agent.js";
import type { DiffContentProvider } from "../services/diff-content-provider.js";
import { WebviewMessageHandler } from "../services/webview-message-handler.js";
import type { MessageHandlerContext } from "../services/webview-message-handler.js";
import type { ConfigService } from "../services/config-service.js";
import { getWebviewHtml } from "./webview-html.js";
import { Views, WebviewMessages } from "../constants.js";
import { Effect, Layer, Runtime } from "effect";
import { ReactFileFilter as ReactFileFilterService } from "../services/react-file-filter.js";
import { GitService as GitServiceEffect } from "../services/git-service.js";
import { ConfigService as ConfigServiceEffect } from "../services/config-service.js";
import { ApiKeyService } from "../services/api-key-service.js";
import {
  VSCodeService,
  createSecretStorageLayer,
} from "../services/vs-code.js";
import { PlanningAgent } from "../services/ai-agent/planning-agent.js";
import { createLoggerLayer } from "../services/logger-service.js";
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
  private messageHandlerContext?: MessageHandlerContext;
  private themeChangeDisposable?: vscode.Disposable;
  private fileWatchers: vscode.FileSystemWatcher[] = [];
  private readonly runtime = Runtime.defaultRuntime;

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

    // Initialize message handler context
    this.messageHandlerContext = this.createMessageHandlerContext(webviewView);

    // Send initial theme info
    if (this.messageHandlerContext) {
      this.executeHandlerEffect((handler) =>
        handler.sendThemeInfo(
          this.messageHandlerContext as MessageHandlerContext,
        ),
      ).catch((error) => {
        console.error("Failed to send theme info:", error);
      });
    }

    // Listen for theme changes
    this.themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme(
      () => {
        if (this.messageHandlerContext) {
          this.executeHandlerEffect((handler) =>
            handler.sendThemeInfo(
              this.messageHandlerContext as MessageHandlerContext,
            ),
          ).catch((error) => {
            console.error("Failed to send theme info:", error);
          });
        }
      },
    );

    // Set up message handling
    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        // Check if it's an RPC message first
        if (isRpcMessage(message)) {
          const rpcContext = this.createRpcContext(webviewView);
          if (rpcContext) {
            const response = await handleRpcMessage(message, rpcContext);
            if (response) {
              webviewView.webview.postMessage(response);
            }
          }
          return;
        }

        // Fall back to legacy message handler
        if (this.messageHandlerContext) {
          await this.executeHandlerEffect((handler) =>
            handler.handleMessage(
              this.messageHandlerContext as MessageHandlerContext,
              message,
            ),
          ).catch((error) => {
            console.error("Failed to handle message:", error);
          });
        }
      },
      null,
      [],
    );

    // Handle visibility changes
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this.messageHandlerContext) {
        console.log("Clive view became visible");
        // Trigger status checks via message handler
        this.executeHandlerEffect((handler) =>
          handler.handleMessage(
            this.messageHandlerContext as MessageHandlerContext,
            {
              command: WebviewMessages.refreshStatus,
            },
          ),
        ).catch((error) => {
          console.error("Failed to refresh status:", error);
        });
        this.executeHandlerEffect((handler) =>
          handler.handleMessage(
            this.messageHandlerContext as MessageHandlerContext,
            {
              command: WebviewMessages.getBranchChanges,
            },
          ),
        ).catch((error) => {
          console.error("Failed to get branch changes:", error);
        });
      }
    });

    // Set up file watchers
    this.setupFileWatchers(webviewView);
  }

  /**
   * Handle OAuth callback from URI handler
   */
  public async handleOAuthCallback(uri: vscode.Uri): Promise<void> {
    if (!this._webviewView || !this._context || !this.messageHandlerContext) {
      return;
    }

    await this.executeHandlerEffect((handler) =>
      handler.handleOAuthCallback(
        this.messageHandlerContext as MessageHandlerContext,
        uri,
      ),
    ).catch((error) => {
      console.error("Failed to handle OAuth callback:", error);
    });
  }

  /**
   * Create message handler context with required dependencies
   */
  private createMessageHandlerContext(
    webviewView: vscode.WebviewView,
  ): MessageHandlerContext {
    if (!this._context || !this._outputChannel) {
      throw new Error(
        "Context and output channel must be set before creating message handler",
      );
    }

    // Create a proxy for GitService that matches the expected interface
    // The handler expects gitService.getBranchChanges() to return an Effect
    // We need to provide VSCodeService as a dependency
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

    const context: MessageHandlerContext = {
      webviewView,
      context: this._context,
      outputChannel: this._outputChannel,
      isDev: this._isDev,
      cypressDetector: new CypressDetector(),
      gitService: gitServiceProxy,
      reactFileFilter:
        {} as import("../services/react-file-filter.js").ReactFileFilter,
      diffProvider: this.diffProvider,
      configService: {} as ConfigService,
    };

    return context;
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
   * Execute an Effect handler method with proper dependency provision
   */
  private executeHandlerEffect<T>(
    fn: (handler: {
      sendThemeInfo: (
        ctx: MessageHandlerContext,
      ) => Effect.Effect<void, unknown>;
      handleMessage: (
        ctx: MessageHandlerContext,
        message: { command: string; [key: string]: unknown },
      ) => Effect.Effect<void, unknown>;
      handleOAuthCallback: (
        ctx: MessageHandlerContext,
        uri: vscode.Uri,
      ) => Effect.Effect<void, unknown>;
      [key: string]: unknown;
    }) => Effect.Effect<T, unknown>,
  ): Promise<T> {
    return Runtime.runPromise(this.runtime)(
      Effect.gen(function* () {
        const handler = yield* WebviewMessageHandler;
        return yield* fn(
          handler as unknown as {
            sendThemeInfo: (
              ctx: MessageHandlerContext,
            ) => Effect.Effect<void, unknown>;
            handleMessage: (
              ctx: MessageHandlerContext,
              message: { command: string; [key: string]: unknown },
            ) => Effect.Effect<void, unknown>;
            handleOAuthCallback: (
              ctx: MessageHandlerContext,
              uri: vscode.Uri,
            ) => Effect.Effect<void, unknown>;
            [key: string]: unknown;
          },
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            WebviewMessageHandler.Default,
            ReactFileFilterService.Default,
            GitServiceEffect.Default,
            ConfigServiceEffect.Default,
            ApiKeyService.Default,
            CypressTestAgent.Default,
            PlanningAgent.Default,
            VSCodeService.Default,
            this._context
              ? createSecretStorageLayer(this._context)
              : Layer.empty,
            this._outputChannel
              ? createLoggerLayer(this._outputChannel, this._isDev)
              : Layer.empty,
          ),
        ),
      ),
    );
  }

  /**
   * Set up file system watchers for status updates
   */
  private setupFileWatchers(webviewView: vscode.WebviewView): void {
    // Watch for package.json changes
    const packageWatcher =
      vscode.workspace.createFileSystemWatcher("**/package.json");
    packageWatcher.onDidChange(() => {
      if (webviewView.visible && this.messageHandlerContext) {
        const ctx = this.messageHandlerContext;
        this.executeHandlerEffect((handler) =>
          handler.handleMessage(ctx, {
            command: WebviewMessages.refreshStatus,
          }),
        ).catch((error) => {
          console.error("Failed to handle package.json change:", error);
        });
      }
    });
    packageWatcher.onDidCreate(() => {
      if (webviewView.visible && this.messageHandlerContext) {
        const ctx = this.messageHandlerContext;
        this.executeHandlerEffect((handler) =>
          handler.handleMessage(ctx, {
            command: WebviewMessages.refreshStatus,
          }),
        ).catch((error) => {
          console.error("Failed to handle package.json create:", error);
        });
      }
    });
    packageWatcher.onDidDelete(() => {
      if (webviewView.visible && this.messageHandlerContext) {
        const ctx = this.messageHandlerContext;
        this.executeHandlerEffect((handler) =>
          handler.handleMessage(ctx, {
            command: WebviewMessages.refreshStatus,
          }),
        ).catch((error) => {
          console.error("Failed to handle package.json delete:", error);
        });
      }
    });

    // Watch for Cypress config file changes
    const configWatcher = vscode.workspace.createFileSystemWatcher(
      "**/cypress.config.{ts,js,mjs}",
    );
    configWatcher.onDidChange(() => {
      if (webviewView.visible && this.messageHandlerContext) {
        const ctx = this.messageHandlerContext;
        this.executeHandlerEffect((handler) =>
          handler.handleMessage(ctx, {
            command: WebviewMessages.refreshStatus,
          }),
        ).catch((error) => {
          console.error("Failed to handle config change:", error);
        });
      }
    });
    configWatcher.onDidCreate(() => {
      if (webviewView.visible && this.messageHandlerContext) {
        const ctx = this.messageHandlerContext;
        this.executeHandlerEffect((handler) =>
          handler.handleMessage(ctx, {
            command: WebviewMessages.refreshStatus,
          }),
        ).catch((error) => {
          console.error("Failed to handle config create:", error);
        });
      }
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
