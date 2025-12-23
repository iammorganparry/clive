// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { CliveViewProvider } from "./views/clive-view-provider.js";
import { CommandCenter } from "./commands/command-center.js";
import { DiffContentProvider } from "./services/diff-content-provider.js";
import { Effect, Runtime, Layer } from "effect";
import { ConfigService } from "./services/config-service.js";
import { createSecretStorageLayer } from "./services/vs-code.js";
import { createLoggerLayer } from "./services/logger-service.js";
import { CodebaseIndexingService } from "./services/codebase-indexing-service.js";
import { FileWatcherDisposable } from "./services/file-watcher-service.js";
import { createIndexingLayer } from "./services/layer-factory.js";
import { GlobalStateKeys, Commands } from "./constants.js";
import {
  PlanCodeLensProvider,
  handleApprovePlan,
  handleRejectPlan,
} from "./services/plan-codelens-provider.js";

const commandCenter = new CommandCenter();

// Create output channel for logging
const outputChannel = vscode.window.createOutputChannel("Clive");

/**
 * Extension exports for testing purposes
 */
export interface ExtensionExports {
  context: vscode.ExtensionContext;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext): ExtensionExports {
  outputChannel.appendLine("Clive extension is activating...");
  outputChannel.appendLine(
    'Congratulations, your extension "clive" is now active!',
  );

  // Auto-detect debug mode from extension context
  const isDev = context.extensionMode === vscode.ExtensionMode.Development;
  const loggerLayer = createLoggerLayer(outputChannel, isDev);

  // Migrate auth token from globalState to SecretStorage (one-time migration)
  const oldAuthToken = context.globalState.get<string>("auth_token");
  if (oldAuthToken) {
    const secretStorageLayer = createSecretStorageLayer(context);
    const configServiceLayer = Layer.merge(
      ConfigService.Default,
      secretStorageLayer,
    );

    Effect.gen(function* () {
      const configService = yield* ConfigService;
      yield* configService.storeAuthToken(oldAuthToken);
    })
      .pipe(
        Effect.provide(Layer.merge(configServiceLayer, loggerLayer)),
        Effect.catchAll((err: unknown) =>
          Effect.sync(() => {
            outputChannel.appendLine(
              `Failed to migrate auth token to SecretStorage: ${err}`,
            );
          }),
        ),
        Runtime.runPromise(Runtime.defaultRuntime),
      )
      .catch(() => {
        // Ignore errors during migration
      });
    // Clear old token from globalState after migration
    context.globalState.update("auth_token", undefined);
  }

  // Register the diff content provider
  const diffProvider = DiffContentProvider.register(context);

  // Register plan CodeLens provider
  const planCodeLensProvider = new PlanCodeLensProvider();
  const codeLensDisposable = vscode.languages.registerCodeLensProvider(
    { pattern: "**/.clive/plans/*.md" },
    planCodeLensProvider,
  );
  context.subscriptions.push(codeLensDisposable);

  // Refresh CodeLens when documents change
  const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument(
    () => {
      planCodeLensProvider.refresh();
    },
  );
  context.subscriptions.push(onDidChangeTextDocument);

  // Register approval/rejection commands
  const approvePlanDisposable = vscode.commands.registerCommand(
    Commands.approvePlan,
    async (
      planUri: vscode.Uri,
      proposalId: string,
      subscriptionId: string,
      toolCallId: string,
    ) => {
      await handleApprovePlan(planUri, proposalId, subscriptionId, toolCallId);
      planCodeLensProvider.refresh();
    },
  );
  context.subscriptions.push(approvePlanDisposable);

  const rejectPlanDisposable = vscode.commands.registerCommand(
    Commands.rejectPlan,
    async (
      planUri: vscode.Uri,
      proposalId: string,
      subscriptionId: string,
      toolCallId: string,
    ) => {
      await handleRejectPlan(planUri, proposalId, subscriptionId, toolCallId);
      planCodeLensProvider.refresh();
    },
  );
  context.subscriptions.push(rejectPlanDisposable);

  // Register sendApproval command (used by CodeLens to send approval to RPC)
  const sendApprovalDisposable = vscode.commands.registerCommand(
    Commands.sendApproval,
    async (data: {
      subscriptionId: string;
      toolCallId: string;
      data: string;
    }) => {
      // Send approval message via webview (will be handled by RPC handler)
      const webview = provider.getWebview();
      if (webview) {
        webview.webview.postMessage({
          subscriptionId: data.subscriptionId,
          type: "approval",
          toolCallId: data.toolCallId,
          data: data.data,
        });
      }
    },
  );
  context.subscriptions.push(sendApprovalDisposable);

  // Register the webview view provider
  const provider = new CliveViewProvider(context.extensionUri, diffProvider);
  provider.setContext(context);
  provider.setOutputChannel(outputChannel);
  provider.setIsDev(isDev);

  const webviewProviderDisposable = vscode.window.registerWebviewViewProvider(
    CliveViewProvider.viewType,
    provider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );

  context.subscriptions.push(webviewProviderDisposable);

  // Register all commands via CommandCenter
  commandCenter.registerAll(context);

  // Start codebase indexing in the background (non-blocking)
  // Only runs if user is authenticated
  // Use the layer factory to create a properly composed layer
  const fullIndexingLayer = createIndexingLayer({
    extensionContext: context,
    outputChannel,
    isDev: isDev,
  });

  // Create file watcher disposable for incremental indexing
  const fileWatcherDisposable = new FileWatcherDisposable();
  fileWatcherDisposable.setOutputChannel(outputChannel);
  fileWatcherDisposable.setServiceLayer(fullIndexingLayer);
  context.subscriptions.push(fileWatcherDisposable);

  // Check if indexing is enabled (opt-in)
  const isIndexingEnabled =
    context.globalState.get<boolean>(GlobalStateKeys.indexingEnabled) ?? false;

  if (!isIndexingEnabled) {
    outputChannel.appendLine(
      "Codebase indexing is disabled (opt-in required via Settings)",
    );
  }

  // Indexing is now only triggered manually via Settings page
  // File watcher will start when user enables indexing
  if (isIndexingEnabled) {
    // Start file watcher for incremental indexing when user enables it
    fileWatcherDisposable.start().catch((error) => {
      outputChannel.appendLine(
        `File watcher failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  // Return exports for testing
  return { context };
}

// This method is called when your extension is deactivated
export function deactivate() {}
