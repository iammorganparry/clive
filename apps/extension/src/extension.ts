// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { CliveViewProvider } from "./views/clive-view-provider.js";
import { CommandCenter } from "./commands/command-center.js";
import { DiffContentProvider } from "./services/diff-content-provider.js";
import { Effect, Runtime, Layer } from "effect";
import { ConfigService } from "./services/config-service.js";
import { ApiKeyService } from "./services/api-key-service.js";
import { createSecretStorageLayer, VSCodeService } from "./services/vs-code.js";
import { createLoggerLayer } from "./services/logger-service.js";
import { CodebaseIndexingService } from "./services/codebase-indexing-service.js";
import { RepositoryService } from "./services/repository-service.js";
import {
  FileWatcherService,
  FileWatcherDisposable,
} from "./services/file-watcher-service.js";

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
  const indexingLayer = Layer.merge(
    Layer.merge(
      Layer.merge(ConfigService.Default, createSecretStorageLayer(context)),
      Layer.merge(VSCodeService.Default, RepositoryService.Default),
    ),
    Layer.merge(ApiKeyService.Default, loggerLayer),
  );

  // Full service layer including CodebaseIndexingService and FileWatcherService
  const fullIndexingLayer = Layer.merge(
    Layer.merge(CodebaseIndexingService.Default, FileWatcherService.Default),
    indexingLayer,
  );

  // Create file watcher disposable for incremental indexing
  const fileWatcherDisposable = new FileWatcherDisposable();
  fileWatcherDisposable.setOutputChannel(outputChannel);
  fileWatcherDisposable.setServiceLayer(fullIndexingLayer);
  context.subscriptions.push(fileWatcherDisposable);

  Effect.gen(function* () {
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
      fileWatcherDisposable.start().catch((error) => {
        outputChannel.appendLine(
          `File watcher failed to start: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
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
