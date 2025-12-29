import * as vscode from "vscode";
import { Data, Effect, Runtime } from "effect";
import { PendingEditService } from "./pending-edit-service.js";
import { Commands } from "../constants.js";

/**
 * Error types for edit CodeLens operations
 */
export class EditCodeLensError extends Data.TaggedError("EditCodeLensError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * CodeLens provider implementation for files with pending edits
 * Shows "Accept Changes" and "Reject Changes" buttons at the top of files
 */
class EditCodeLensProviderImpl implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private readonly pendingEditService: PendingEditService) {
    // Subscribe to pending edit changes
    pendingEditService.onDidChangePendingEdits(() => {
      this._onDidChangeCodeLenses.fire();
    });
  }

  /**
   * Refresh CodeLens when pending edits change
   */
  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  /**
   * Provide CodeLens for a document
   */
  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    // Check if this file has a pending edit
    if (!this.pendingEditService.hasPendingEditSync(document.uri.fsPath)) {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];

    // Position at the very first line
    const range = new vscode.Range(0, 0, 0, 0);

    // Accept Changes button
    const acceptCommand: vscode.Command = {
      title: "$(check) Accept Changes",
      command: Commands.acceptEdit,
      arguments: [document.uri],
      tooltip: "Keep the current changes made by the AI agent",
    };
    codeLenses.push(new vscode.CodeLens(range, acceptCommand));

    // Reject Changes button
    const rejectCommand: vscode.Command = {
      title: "$(x) Reject Changes",
      command: Commands.rejectEdit,
      arguments: [document.uri],
      tooltip: "Revert to the original content before the AI edit",
    };
    codeLenses.push(new vscode.CodeLens(range, rejectCommand));

    return codeLenses;
  }

  /**
   * Resolve CodeLens (optional - can add additional info here)
   */
  resolveCodeLens(
    codeLens: vscode.CodeLens,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens {
    return codeLens;
  }

  /**
   * Dispose of the provider
   */
  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
  }
}

/**
 * Effect Service for managing Edit CodeLens functionality
 *
 * Provides the CodeLens provider and handlers for accept/reject actions.
 */
export class EditCodeLensService extends Effect.Service<EditCodeLensService>()(
  "EditCodeLensService",
  {
    effect: Effect.gen(function* () {
      const pendingEditService = yield* PendingEditService;

      // Create the CodeLens provider implementation
      const provider = new EditCodeLensProviderImpl(pendingEditService);

      /**
       * Get the CodeLens provider for registration with VS Code
       */
      const getProvider = () => Effect.succeed(provider);

      /**
       * Refresh CodeLens display
       */
      const refresh = () =>
        Effect.sync(() => {
          provider.refresh();
        });

      /**
       * Accept pending edit for a file (keep AI changes)
       */
      const acceptEdit = (fileUri: vscode.Uri) =>
        Effect.gen(function* () {
          const accepted = yield* pendingEditService.acceptEdit(
            fileUri.fsPath,
          );

          if (accepted) {
            // Fire-and-forget notification (don't await - it hangs until dismissed)
            vscode.window.showInformationMessage(
              `Changes accepted for ${vscode.workspace.asRelativePath(fileUri)}`,
            );
          }

          return accepted;
        });

      /**
       * Reject pending edit for a file (revert to original)
       */
      const rejectEdit = (fileUri: vscode.Uri) =>
        Effect.gen(function* () {
          const rejected = yield* pendingEditService
            .rejectEdit(fileUri.fsPath)
            .pipe(
              Effect.catchAll((error) =>
                Effect.fail(
                  new EditCodeLensError({
                    message: `Failed to reject edit: ${error.message}`,
                    cause: error,
                  }),
                ),
              ),
            );

          if (rejected) {
            // Fire-and-forget notification (don't await - it hangs until dismissed)
            vscode.window.showInformationMessage(
              `Changes reverted for ${vscode.workspace.asRelativePath(fileUri)}`,
            );
          }

          return rejected;
        });

      /**
       * Dispose of the service and provider
       */
      const dispose = () =>
        Effect.sync(() => {
          provider.dispose();
        });

      return {
        getProvider,
        refresh,
        acceptEdit,
        rejectEdit,
        dispose,
      };
    }),
    dependencies: [PendingEditService.Default],
  },
) {}

/**
 * Singleton instance holder for synchronous access
 */
let editCodeLensServiceInstance: EditCodeLensService | null = null;

/**
 * Set the singleton instance (called during extension activation)
 */
export function setEditCodeLensServiceInstance(
  service: EditCodeLensService,
): void {
  editCodeLensServiceInstance = service;
}

/**
 * Get the singleton instance
 */
export function getEditCodeLensServiceInstance(): EditCodeLensService {
  if (!editCodeLensServiceInstance) {
    throw new Error(
      "EditCodeLensService not initialized. Ensure the service is created first.",
    );
  }
  return editCodeLensServiceInstance;
}

/**
 * Handle accepting changes from CodeLens command
 */
export async function handleAcceptEdit(fileUri: vscode.Uri): Promise<void> {
  try {
    const service = getEditCodeLensServiceInstance();
    await Runtime.runPromise(Runtime.defaultRuntime)(
      service.acceptEdit(fileUri),
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    vscode.window.showErrorMessage(`Failed to accept changes: ${errorMessage}`);
  }
}

/**
 * Handle rejecting changes from CodeLens command
 */
export async function handleRejectEdit(fileUri: vscode.Uri): Promise<void> {
  try {
    const service = getEditCodeLensServiceInstance();
    await Runtime.runPromise(Runtime.defaultRuntime)(
      service.rejectEdit(fileUri),
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    vscode.window.showErrorMessage(
      `Failed to revert changes: ${errorMessage}`,
    );
  }
}
