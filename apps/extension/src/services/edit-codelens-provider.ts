import * as vscode from "vscode";
import { Data, Effect, Runtime } from "effect";
import { PendingEditService } from "./pending-edit-service.js";
import { Commands } from "../constants.js";
import { DiffDecorationService } from "./diff-decoration-service.js";

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
   * Shows accept/reject buttons for each edit block
   */
  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    const blocks = this.pendingEditService.getBlocksForFileSync(
      document.uri.fsPath,
    );

    if (!blocks || blocks.length === 0) {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];

    // Add CodeLens for each block at its start line
    for (const block of blocks) {
      const range = new vscode.Range(
        block.startLine - 1,
        0,
        block.startLine - 1,
        0,
      );

      // Accept Block button
      const acceptCommand: vscode.Command = {
        title: "$(check) Accept",
        command: Commands.acceptEditBlock,
        arguments: [document.uri, block.blockId],
        tooltip: `Accept this edit block (lines ${block.startLine}-${block.startLine + block.newLineCount - 1})`,
      };
      codeLenses.push(new vscode.CodeLens(range, acceptCommand));

      // Reject Block button
      const rejectCommand: vscode.Command = {
        title: "$(x) Reject",
        command: Commands.rejectEditBlock,
        arguments: [document.uri, block.blockId],
        tooltip: `Reject this edit block and revert to original (${block.originalLines.length} lines)`,
      };
      codeLenses.push(new vscode.CodeLens(range, rejectCommand));
    }

    // Add "Accept All" / "Reject All" at line 0 if multiple blocks
    if (blocks.length > 1) {
      const range = new vscode.Range(0, 0, 0, 0);

      const acceptAllCommand: vscode.Command = {
        title: `$(check-all) Accept All (${blocks.length} blocks)`,
        command: Commands.acceptAllBlocks,
        arguments: [document.uri],
        tooltip: "Accept all edit blocks in this file",
      };
      codeLenses.push(new vscode.CodeLens(range, acceptAllCommand));

      const rejectAllCommand: vscode.Command = {
        title: `$(close-all) Reject All (${blocks.length} blocks)`,
        command: Commands.rejectAllBlocks,
        arguments: [document.uri],
        tooltip: "Reject all edit blocks and revert to original content",
      };
      codeLenses.push(new vscode.CodeLens(range, rejectAllCommand));
    }

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
      const diffDecorationService = yield* DiffDecorationService;

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
          // Clear diff decorations before accepting (ignore errors)
          yield* diffDecorationService
            .clearDecorations(fileUri.fsPath)
            .pipe(Effect.catchAll(() => Effect.void));

          const accepted = yield* pendingEditService.acceptEdit(fileUri.fsPath);

          if (accepted) {
            // Fire-and-forget notification (don't await - it hangs until dismissed)
            vscode.window.showInformationMessage(
              `Changes accepted for ${vscode.workspace.asRelativePath(fileUri)}`,
            );
          }

          return accepted;
        });

      /**
       * Accept a specific edit block
       */
      const acceptBlock = (fileUri: vscode.Uri, blockId: string) =>
        Effect.gen(function* () {
          const accepted = yield* pendingEditService.acceptBlock(
            fileUri.fsPath,
            blockId,
          );

          if (accepted) {
            vscode.window.showInformationMessage(
              `Edit block accepted in ${vscode.workspace.asRelativePath(fileUri)}`,
            );
          }

          return accepted;
        });

      /**
       * Reject pending edit for a file (revert to original)
       */
      const rejectEdit = (fileUri: vscode.Uri) =>
        Effect.gen(function* () {
          // Clear diff decorations before rejecting (ignore errors)
          yield* diffDecorationService
            .clearDecorations(fileUri.fsPath)
            .pipe(Effect.catchAll(() => Effect.void));

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
       * Reject a specific edit block
       */
      const rejectBlock = (fileUri: vscode.Uri, blockId: string) =>
        Effect.gen(function* () {
          const rejected = yield* pendingEditService
            .rejectBlock(fileUri.fsPath, blockId)
            .pipe(
              Effect.catchAll((error) =>
                Effect.fail(
                  new EditCodeLensError({
                    message: `Failed to reject block: ${error.message}`,
                    cause: error,
                  }),
                ),
              ),
            );

          if (rejected) {
            vscode.window.showInformationMessage(
              `Edit block reverted in ${vscode.workspace.asRelativePath(fileUri)}`,
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
        acceptBlock,
        rejectEdit,
        rejectBlock,
        dispose,
      };
    }),
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
 * Handle accepting a specific block from CodeLens command
 */
export async function handleAcceptEditBlock(
  fileUri: vscode.Uri,
  blockId: string,
): Promise<void> {
  try {
    const service = getEditCodeLensServiceInstance();
    await Runtime.runPromise(Runtime.defaultRuntime)(
      service.acceptBlock(fileUri, blockId),
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    vscode.window.showErrorMessage(`Failed to accept block: ${errorMessage}`);
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
    vscode.window.showErrorMessage(`Failed to revert changes: ${errorMessage}`);
  }
}

/**
 * Handle rejecting a specific block from CodeLens command
 */
export async function handleRejectEditBlock(
  fileUri: vscode.Uri,
  blockId: string,
): Promise<void> {
  try {
    const service = getEditCodeLensServiceInstance();
    await Runtime.runPromise(Runtime.defaultRuntime)(
      service.rejectBlock(fileUri, blockId),
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    vscode.window.showErrorMessage(`Failed to reject block: ${errorMessage}`);
  }
}
