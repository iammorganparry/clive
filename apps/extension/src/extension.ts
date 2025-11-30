// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { Console, Effect, Runtime, pipe } from "effect";
import { CliveViewProvider } from "./views/clive-view-provider.js";
import { CommandCenter } from "./commands/command-center.js";

const commandCenter = new CommandCenter();

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  pipe(
    Effect.sync(() => {
      Console.log('Congratulations, your extension "clive" is now active!');
    }),
    Runtime.runPromise(Runtime.defaultRuntime)
  );

  // Register the webview view provider
  const provider = new CliveViewProvider(context.extensionUri);
  provider.setContext(context);

  const webviewProviderDisposable = vscode.window.registerWebviewViewProvider(
    CliveViewProvider.viewType,
    provider
  );

  context.subscriptions.push(webviewProviderDisposable);

  // Register URI handler for OAuth callback
  const uriHandler = vscode.window.registerUriHandler({
    handleUri: (uri: vscode.Uri) => {
      pipe(
        Effect.sync(() => {
          Console.log(`Received URI: ${uri.toString()}`);
        }),
        Effect.flatMap(() =>
          Effect.tryPromise({
            try: () => provider.handleOAuthCallback(uri),
            catch: (error) =>
              error instanceof Error ? error : new Error(String(error)),
          })
        ),
        Runtime.runPromise(Runtime.defaultRuntime)
      );
    },
  });
  context.subscriptions.push(uriHandler);

  // Register all commands via CommandCenter
  commandCenter.registerAll(context);
}

// This method is called when your extension is deactivated
export function deactivate() {}
