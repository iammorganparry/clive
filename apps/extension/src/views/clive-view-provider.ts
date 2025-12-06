import * as vscode from "vscode";
import { CypressDetector } from "../services/cypress-detector.js";
import { GitService } from "../services/git-service.js";
import { ReactFileFilter } from "../services/react-file-filter.js";
import { CypressTestAgent } from "../services/ai-agent/agent.js";
import type { DiffContentProvider } from "../services/diff-content-provider.js";
import { WebviewMessageHandler } from "../services/webview-message-handler.js";
import type { MessageHandlerContext } from "../services/webview-message-handler.js";
import type { ConfigService } from "../services/config-service.js";
import { getWebviewHtml } from "./webview-html.js";
import { Views, WebviewMessages } from "../constants.js";

/**
 * Webview view provider for Clive extension
 * Coordinates webview lifecycle and delegates message handling
 */
export class CliveViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = Views.mainView;

  private _webviewView?: vscode.WebviewView;
  private _context?: vscode.ExtensionContext;
  private _outputChannel?: vscode.OutputChannel;
  private messageHandler?: WebviewMessageHandler;
  private themeChangeDisposable?: vscode.Disposable;
  private fileWatchers: vscode.FileSystemWatcher[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly diffProvider: DiffContentProvider,
    private readonly configService: ConfigService,
  ) {}

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

    webviewView.webview.html = getWebviewHtml(
      webviewView.webview,
      this._extensionUri,
    );

    // Initialize message handler
    this.messageHandler = this.createMessageHandler(webviewView);

    // Send initial theme info
    this.messageHandler.sendThemeInfo();

    // Listen for theme changes
    this.themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme(
      () => {
        this.messageHandler?.sendThemeInfo();
      },
    );

    // Set up message handling
    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        await this.messageHandler?.handleMessage(message);
      },
      null,
      [],
    );

    // Handle visibility changes
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        console.log("Clive view became visible");
        // Trigger status checks via message handler
        this.messageHandler?.handleMessage({
          command: WebviewMessages.refreshStatus,
        });
        this.messageHandler?.handleMessage({
          command: WebviewMessages.getBranchChanges,
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
    if (!this._webviewView || !this._context || !this.messageHandler) {
      return;
    }

    await this.messageHandler.handleOAuthCallback(uri);
  }

  /**
   * Create message handler with required context
   */
  private createMessageHandler(
    webviewView: vscode.WebviewView,
  ): WebviewMessageHandler {
    if (!this._context || !this._outputChannel) {
      throw new Error(
        "Context and output channel must be set before creating message handler",
      );
    }

    const context: MessageHandlerContext = {
      webviewView,
      context: this._context,
      outputChannel: this._outputChannel,
      cypressDetector: new CypressDetector(),
      gitService: new GitService(),
      reactFileFilter: new ReactFileFilter(),
      testAgent: new CypressTestAgent(this.configService),
      diffProvider: this.diffProvider,
      configService: this.configService,
    };

    return new WebviewMessageHandler(context);
  }

  /**
   * Set up file system watchers for status updates
   */
  private setupFileWatchers(webviewView: vscode.WebviewView): void {
    // Watch for package.json changes
    const packageWatcher =
      vscode.workspace.createFileSystemWatcher("**/package.json");
    packageWatcher.onDidChange(() => {
      if (webviewView.visible) {
        this.messageHandler?.handleMessage({
          command: WebviewMessages.refreshStatus,
        });
      }
    });
    packageWatcher.onDidCreate(() => {
      if (webviewView.visible) {
        this.messageHandler?.handleMessage({
          command: WebviewMessages.refreshStatus,
        });
      }
    });
    packageWatcher.onDidDelete(() => {
      if (webviewView.visible) {
        this.messageHandler?.handleMessage({
          command: WebviewMessages.refreshStatus,
        });
      }
    });

    // Watch for Cypress config file changes
    const configWatcher = vscode.workspace.createFileSystemWatcher(
      "**/cypress.config.{ts,js,mjs}",
    );
    configWatcher.onDidChange(() => {
      if (webviewView.visible) {
        this.messageHandler?.handleMessage({
          command: WebviewMessages.refreshStatus,
        });
      }
    });
    configWatcher.onDidCreate(() => {
      if (webviewView.visible) {
        this.messageHandler?.handleMessage({
          command: WebviewMessages.refreshStatus,
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
