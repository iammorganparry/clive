// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { CliveViewProvider } from "./views/clive-view-provider.js";
import { CommandCenter } from "./commands/command-center.js";
import { DiffContentProvider } from "./services/diff-content-provider.js";
import { ConfigService } from "./services/config-service.js";
import { SecretKeys } from "./constants.js";

const commandCenter = new CommandCenter();

// Create output channel for logging
const outputChannel = vscode.window.createOutputChannel("Clive");

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  outputChannel.appendLine("Clive extension is activating...");
  outputChannel.appendLine(
    'Congratulations, your extension "clive" is now active!',
  );

  // Initialize ConfigService with SecretStorage
  const configService = new ConfigService(context.secrets);

  // Migrate auth token from globalState to SecretStorage (one-time migration)
  const oldAuthToken = context.globalState.get<string>("auth_token");
  if (oldAuthToken) {
    context.secrets.store(SecretKeys.authToken, oldAuthToken).catch((err) => {
      outputChannel.appendLine(
        `Failed to migrate auth token to SecretStorage: ${err}`,
      );
    });
    // Clear old token from globalState after migration
    context.globalState.update("auth_token", undefined);
  }

  // Register the diff content provider
  const diffProvider = DiffContentProvider.register(context);

  // Register the webview view provider
  const provider = new CliveViewProvider(
    context.extensionUri,
    diffProvider,
    configService,
  );
  provider.setContext(context);
  provider.setOutputChannel(outputChannel);

  const webviewProviderDisposable = vscode.window.registerWebviewViewProvider(
    CliveViewProvider.viewType,
    provider,
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
}

// This method is called when your extension is deactivated
export function deactivate() {}
