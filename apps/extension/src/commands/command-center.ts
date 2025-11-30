import * as vscode from "vscode";
import { Effect, Runtime, pipe } from "effect";
import { setupCypress } from "../services/cypress-setup.js";
import { Commands, Views } from "../constants.js";

export class CommandCenter {
  private disposables: vscode.Disposable[] = [];

  /**
   * Register all commands
   */
  registerAll(context: vscode.ExtensionContext): void {
    this.registerShowView();
    this.registerHelloWorld();
    this.registerSetupCypress();

    // Add all disposables to context subscriptions
    this.disposables.forEach((disposable) => {
      context.subscriptions.push(disposable);
    });
  }

  /**
   * Register command to show/reveal the Clive view
   */
  private registerShowView(): void {
    const disposable = vscode.commands.registerCommand(
      Commands.showView,
      () => {
        pipe(
          Effect.sync(() => {
            vscode.commands.executeCommand(`${Views.mainView}.focus`);
          }),
          Runtime.runPromise(Runtime.defaultRuntime)
        );
      }
    );

    this.disposables.push(disposable);
  }

  /**
   * Register hello world command
   */
  private registerHelloWorld(): void {
    const disposable = vscode.commands.registerCommand(
      Commands.helloWorld,
      () => {
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
        vscode.window.showInformationMessage("Hello World from clive!");
      }
    );

    this.disposables.push(disposable);
  }

  /**
   * Register Cypress setup command
   */
  private registerSetupCypress(): void {
    const disposable = vscode.commands.registerCommand(
      Commands.setupCypress,
      async (targetDirectory?: string) => {
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders || workspaceFolders.length === 0) {
          vscode.window.showErrorMessage("No workspace folder found");
          return;
        }

        const targetDir = targetDirectory || workspaceFolders[0].uri.fsPath;
        await setupCypress({ targetDirectory: targetDir });
      }
    );

    this.disposables.push(disposable);
  }

  /**
   * Dispose all registered commands
   */
  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
