import * as vscode from "vscode";
import { Data, Effect, Ref, Runtime } from "effect";

/**
 * Represents a pending edit that can be accepted or rejected
 */
export interface PendingEdit {
  /** The file path being edited */
  filePath: string;
  /** Original content before the edit (for revert) */
  originalContent: string;
  /** Whether this is a new file (no original content) */
  isNewFile: boolean;
  /** Timestamp when the edit was registered */
  timestamp: number;
}

/**
 * Error types for pending edit operations
 */
export class PendingEditError extends Data.TaggedError("PendingEditError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * Service for tracking file edits that are pending user review
 *
 * When the agent edits a file, it registers the edit here with the original content.
 * The user can then accept (keep changes) or reject (revert to original) via CodeLens.
 */
export class PendingEditService extends Effect.Service<PendingEditService>()(
  "PendingEditService",
  {
    effect: Effect.gen(function* () {
      // Mutable state for pending edits
      const pendingEditsRef = yield* Ref.make<Map<string, PendingEdit>>(
        new Map(),
      );

      // VS Code event emitter for CodeLens refresh
      const onDidChangeEmitter = new vscode.EventEmitter<void>();

      /**
       * Event fired when pending edits change (add, accept, reject)
       * Used by CodeLens provider to refresh
       */
      const onDidChangePendingEdits = onDidChangeEmitter.event;

      /**
       * Fire the change event
       */
      const fireChangeEvent = () =>
        Effect.sync(() => {
          onDidChangeEmitter.fire();
        });

      /**
       * Register a pending edit for a file
       * Call this BEFORE writing new content to the file
       */
      const registerPendingEdit = (
        filePath: string,
        originalContent: string,
        isNewFile: boolean = false,
      ) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);

          // If we already have a pending edit for this file, keep the original
          // (multiple edits to same file should revert to the FIRST original)
          if (pendingEdits.has(filePath)) {
            return;
          }

          const newEdit: PendingEdit = {
            filePath,
            originalContent,
            isNewFile,
            timestamp: Date.now(),
          };

          yield* Ref.update(pendingEditsRef, (edits) => {
            const newEdits = new Map(edits);
            newEdits.set(filePath, newEdit);
            return newEdits;
          });

          yield* fireChangeEvent();
        });

      /**
       * Accept the pending edit (keep current file content)
       * Removes the edit from pending without reverting
       */
      const acceptEdit = (filePath: string) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          const hadEdit = pendingEdits.has(filePath);

          if (hadEdit) {
            yield* Ref.update(pendingEditsRef, (edits) => {
              const newEdits = new Map(edits);
              newEdits.delete(filePath);
              return newEdits;
            });
            yield* fireChangeEvent();
          }

          return hadEdit;
        });

      /**
       * Reject the pending edit (revert to original content)
       * Restores the original content and removes from pending
       */
      const rejectEdit = (filePath: string) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          const pendingEdit = pendingEdits.get(filePath);

          if (!pendingEdit) {
            return false;
          }

          const fileUri = vscode.Uri.file(filePath);

          if (pendingEdit.isNewFile) {
            // Delete the new file
            yield* Effect.tryPromise({
              try: () => vscode.workspace.fs.delete(fileUri),
              catch: (error) =>
                new PendingEditError({
                  message: `Failed to delete file: ${error instanceof Error ? error.message : "Unknown error"}`,
                  cause: error,
                }),
            });
          } else {
            // Restore original content
            const content = Buffer.from(pendingEdit.originalContent, "utf-8");
            yield* Effect.tryPromise({
              try: () => vscode.workspace.fs.writeFile(fileUri, content),
              catch: (error) =>
                new PendingEditError({
                  message: `Failed to restore file: ${error instanceof Error ? error.message : "Unknown error"}`,
                  cause: error,
                }),
            });
          }

          yield* Ref.update(pendingEditsRef, (edits) => {
            const newEdits = new Map(edits);
            newEdits.delete(filePath);
            return newEdits;
          });

          yield* fireChangeEvent();
          return true;
        });

      /**
       * Check if a file has a pending edit
       */
      const hasPendingEdit = (filePath: string) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          return pendingEdits.has(filePath);
        });

      /**
       * Synchronous version of hasPendingEdit for CodeLens provider
       */
      const hasPendingEditSync = (filePath: string): boolean => {
        return Runtime.runSync(Runtime.defaultRuntime)(
          Ref.get(pendingEditsRef).pipe(
            Effect.map((edits) => edits.has(filePath)),
          ),
        );
      };

      /**
       * Get pending edit info for a file
       */
      const getPendingEdit = (filePath: string) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          return pendingEdits.get(filePath);
        });

      /**
       * Get all file paths with pending edits
       */
      const getPendingEditPaths = () =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          return Array.from(pendingEdits.keys());
        });

      /**
       * Get count of pending edits
       */
      const getPendingEditCount = () =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          return pendingEdits.size;
        });

      /**
       * Clear all pending edits (e.g., when session ends)
       */
      const clearAllPendingEdits = () =>
        Effect.gen(function* () {
          yield* Ref.set(pendingEditsRef, new Map());
          yield* fireChangeEvent();
        });

      /**
       * Dispose of the service
       */
      const dispose = () =>
        Effect.sync(() => {
          onDidChangeEmitter.dispose();
        });

      return {
        registerPendingEdit,
        acceptEdit,
        rejectEdit,
        hasPendingEdit,
        hasPendingEditSync,
        getPendingEdit,
        getPendingEditPaths,
        getPendingEditCount,
        clearAllPendingEdits,
        onDidChangePendingEdits,
        dispose,
      };
    }),
  },
) {}

/**
 * Singleton instance holder for synchronous access from CodeLens provider
 * This is initialized when the service layer is first created
 */
let pendingEditServiceInstance: PendingEditService | null = null;

/**
 * Set the singleton instance (called during extension activation)
 */
export function setPendingEditServiceInstance(
  service: PendingEditService,
): void {
  pendingEditServiceInstance = service;
}

/**
 * Get the singleton instance for synchronous access
 * Throws if not initialized
 */
export function getPendingEditServiceInstance(): PendingEditService {
  if (!pendingEditServiceInstance) {
    throw new Error(
      "PendingEditService not initialized. Ensure the service layer is created first.",
    );
  }
  return pendingEditServiceInstance;
}

/**
 * Helper to run rejectEdit effect
 */
export async function rejectEditAsync(filePath: string): Promise<boolean> {
  const service = getPendingEditServiceInstance();
  return Runtime.runPromise(Runtime.defaultRuntime)(service.rejectEdit(filePath));
}

/**
 * Helper to run acceptEdit effect
 */
export async function acceptEditAsync(filePath: string): Promise<boolean> {
  const service = getPendingEditServiceInstance();
  return Runtime.runPromise(Runtime.defaultRuntime)(service.acceptEdit(filePath));
}

/**
 * Helper to register pending edit (sync wrapper for tools)
 */
export function registerPendingEditSync(
  filePath: string,
  originalContent: string,
  isNewFile: boolean = false,
): void {
  const service = getPendingEditServiceInstance();
  Runtime.runSync(Runtime.defaultRuntime)(
    service.registerPendingEdit(filePath, originalContent, isNewFile),
  );
}
