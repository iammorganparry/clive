import * as vscode from "vscode";
import { Commands, Views } from "../constants.js";

export class CommandCenter {
  private disposables: vscode.Disposable[] = [];

  /**
   * Register all commands
   */
  registerAll(context: vscode.ExtensionContext): void {
    this.registerShowView();
    this.registerHelloWorld();

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
        vscode.commands.executeCommand(`${Views.mainView}.focus`);
      },
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
      },
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
