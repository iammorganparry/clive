import * as vscode from "vscode";
import { CypressDetector } from "../services/cypress-detector.js";
import type { DiffContentProvider } from "../services/diff-content-provider.js";
import { getWebviewHtml } from "./webview-html.js";
import { Views } from "../constants.js";
import { Effect, Layer, Runtime, pipe } from "effect";
import { GitService as GitServiceEffect } from "../services/git-service.js";
import { VSCodeService } from "../services/vs-code.js";
import {
  handleRpcMessage,
  handleSubscriptionMessage,
  isRpcMessage,
} from "../rpc/handler.js";
import type { RpcSubscriptionMessage } from "@clive/webview-rpc";
import type { RpcContext } from "../rpc/context.js";
import {
  resolveFileUri,
  openTextDocumentEffect,
  showTextDocumentEffect,
  showErrorMessageEffect,
} from "../lib/vscode-effects.js";
import { toLayerContext } from "../services/layer-factory.js";

/**
 * Message type for opening a file
 */
interface OpenFileMessage {
  command: "open-file";
  filePath: string;
}

/**
 * Type guard for OpenFileMessage
 */
function isOpenFileMessage(message: unknown): message is OpenFileMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as OpenFileMessage).command === "open-file" &&
    typeof (message as OpenFileMessage).filePath === "string"
  );
}

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

  public getWebview(): vscode.WebviewView | undefined {
    return this._webviewView;
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

    // Set up message handling
    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        // Handle subscription messages (approvals, cancellations, etc.)
        if (
          typeof message === "object" &&
          message !== null &&
          "subscriptionId" in message &&
          "type" in message
        ) {
          const rpcContext = this.createRpcContext(webviewView);
          if (rpcContext) {
            handleSubscriptionMessage(
              message as RpcSubscriptionMessage,
              rpcContext,
            );
          }
          return;
        }

        // Handle RPC messages
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

        // Handle non-RPC messages
        if (isOpenFileMessage(message)) {
          pipe(
            resolveFileUri(message.filePath),
            Effect.flatMap(openTextDocumentEffect),
            Effect.flatMap((document) => showTextDocumentEffect(document)),
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                console.error("Failed to open file:", error);
                yield* showErrorMessageEffect(
                  `Failed to open file: ${message.filePath}`,
                );
              }),
            ),
            Runtime.runPromise(Runtime.defaultRuntime),
          ).catch(() => {
            // Error already handled in Effect pipeline
          });
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
   * Create RPC context with required dependencies
   */
  private createRpcContext(webviewView: vscode.WebviewView): RpcContext | null {
    if (!this._context || !this._outputChannel) {
      return null;
    }

    // Create a typed proxy for GitService that wraps the Effect-based service
    const gitService: RpcContext["gitService"] = {
      getBranchChanges: () =>
        Effect.gen(function* () {
          const gitService = yield* GitServiceEffect;
          return yield* gitService.getBranchChanges();
        }).pipe(
          Effect.provide(
            Layer.merge(GitServiceEffect.Default, VSCodeService.Default),
          ),
        ),
    };

    return {
      webviewView,
      context: this._context,
      outputChannel: this._outputChannel,
      isDev: this._isDev,
      cypressDetector: new CypressDetector(),
      gitService,
      diffProvider: this.diffProvider,
      // Layer context for building Effect layers in routers
      layerContext: toLayerContext({
        context: this._context,
        outputChannel: this._outputChannel,
        isDev: this._isDev,
      }),
      // No layer overrides in production - routers use defaults
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
