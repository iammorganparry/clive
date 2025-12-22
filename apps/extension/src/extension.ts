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
import { GlobalStateKeys } from "./constants.js";

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

  // Register URI handler for OAuth callback
  const uriHandler = vscode.window.registerUriHandler({
    handleUri: async (uri: vscode.Uri) => {
      console.log(`Received URI: ${uri.toString()}`);
      try {
        await provider.handleOAuthCallback(uri);
      } catch (error) {
        console.error("OAuth callback error:", error);
      }
    },
  });
  context.subscriptions.push(uriHandler);

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

  Effect.gen(function* () {
    // Check if indexing is enabled (opt-in)
    if (!isIndexingEnabled) {
      yield* Effect.logDebug(
        "[Extension] Skipping indexing - not enabled (opt-in required)",
      );
      return;
    }

    // Check authentication before indexing
    const configService = yield* ConfigService;
    const authToken = yield* configService.getAuthToken();

    if (!authToken) {
      yield* Effect.logDebug(
        "[Extension] Skipping indexing - user not authenticated",
      );
      return;
    }

    yield* Effect.logDebug(
      "[Extension] Starting codebase indexing in background...",
    );
    const indexingService = yield* CodebaseIndexingService;

    // Index workspace asynchronously (don't block activation)
    yield* indexingService.indexWorkspace().pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[Extension] Codebase indexing error (non-fatal): ${error instanceof Error ? error.message : String(error)}`,
          );
        }),
      ),
    );

    // Start file watcher after initial indexing completes
    yield* Effect.logDebug(
      "[Extension] Starting file watcher for incremental indexing...",
    );
  })
    .pipe(
      Effect.provide(fullIndexingLayer),
      Runtime.runPromise(Runtime.defaultRuntime),
    )
    .then(() => {
      // Start file watcher after initial indexing (outside Effect context)
      // Only if indexing is enabled
      if (isIndexingEnabled) {
        fileWatcherDisposable.start().catch((error) => {
          outputChannel.appendLine(
            `File watcher failed to start: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
    })
    .catch(() => {
      // Ignore indexing errors - extension should still work without indexing
      outputChannel.appendLine(
        "Codebase indexing failed (extension will continue without it)",
      );
    });

  // Return exports for testing
  return { context };
}

// This method is called when your extension is deactivated
export function deactivate() {}
