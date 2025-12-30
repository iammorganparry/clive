import * as vscode from "vscode";
import { Data, Effect, Ref, Runtime } from "effect";

/**
 * Represents a single edit block within a file
 */
export interface EditBlock {
  /** Unique ID from tool call */
  blockId: string;
  /** The file path being edited */
  filePath: string;
  /** 1-based line number where this block starts */
  startLine: number;
  /** 1-based line number where this block ends */
  endLine: number;
  /** Original content of these lines before edit */
  originalLines: string[];
  /** How many lines the new content has */
  newLineCount: number;
  /** Timestamp when the block was registered */
  timestamp: number;
}

/**
 * Represents all pending edits for a file
 */
export interface PendingFileEdits {
  /** The file path */
  filePath: string;
  /** All edit blocks, ordered by startLine */
  blocks: EditBlock[];
  /** Content before ANY edits (for full revert) */
  baseContent: string;
  /** Whether this is a new file */
  isNewFile: boolean;
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
      // Mutable state for pending file edits (block-based)
      const pendingEditsRef = yield* Ref.make<Map<string, PendingFileEdits>>(
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
       * Register an edit block for a file
       * Call this BEFORE writing new content to the file
       */
      const _registerBlock = (
        filePath: string,
        blockId: string,
        startLine: number,
        endLine: number,
        originalLines: string[],
        newLineCount: number,
        baseContent?: string,
        isNewFile: boolean = false,
      ) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          const existing = pendingEdits.get(filePath);

          const newBlock: EditBlock = {
            blockId,
            filePath,
            startLine,
            endLine,
            originalLines,
            newLineCount,
            timestamp: Date.now(),
          };

          if (existing) {
            // Add block to existing file edits
            const updatedBlocks = [...existing.blocks, newBlock].sort(
              (a, b) => a.startLine - b.startLine,
            );

            yield* Ref.update(pendingEditsRef, (edits) => {
              const newEdits = new Map(edits);
              newEdits.set(filePath, {
                ...existing,
                blocks: updatedBlocks,
              });
              return newEdits;
            });
          } else {
            // Create new file edits entry
            const fileEdits: PendingFileEdits = {
              filePath,
              blocks: [newBlock],
              baseContent: baseContent || "",
              isNewFile,
            };

            yield* Ref.update(pendingEditsRef, (edits) => {
              const newEdits = new Map(edits);
              newEdits.set(filePath, fileEdits);
              return newEdits;
            });
          }

          yield* fireChangeEvent();
        });

      /**
       * Accept a specific edit block
       * Removes the block from tracking
       */
      const acceptBlock = (filePath: string, blockId: string) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          const fileEdits = pendingEdits.get(filePath);

          if (!fileEdits) {
            return false;
          }

          const remainingBlocks = fileEdits.blocks.filter(
            (b) => b.blockId !== blockId,
          );

          if (remainingBlocks.length === 0) {
            // No more blocks, remove file from tracking
            yield* Ref.update(pendingEditsRef, (edits) => {
              const newEdits = new Map(edits);
              newEdits.delete(filePath);
              return newEdits;
            });
          } else {
            // Update with remaining blocks
            yield* Ref.update(pendingEditsRef, (edits) => {
              const newEdits = new Map(edits);
              newEdits.set(filePath, {
                ...fileEdits,
                blocks: remainingBlocks,
              });
              return newEdits;
            });
          }

          yield* fireChangeEvent();
          return true;
        });

      /**
       * Reject a specific edit block
       * Reverts just that block's lines and updates subsequent block positions
       */
      const rejectBlock = (filePath: string, blockId: string) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          const fileEdits = pendingEdits.get(filePath);

          if (!fileEdits) {
            return false;
          }

          const blockToReject = fileEdits.blocks.find(
            (b) => b.blockId === blockId,
          );
          if (!blockToReject) {
            return false;
          }

          const fileUri = vscode.Uri.file(filePath);

          // Read current file content
          const document = yield* Effect.tryPromise({
            try: () => vscode.workspace.openTextDocument(fileUri),
            catch: (error) =>
              new PendingEditError({
                message: `Failed to open document: ${error instanceof Error ? error.message : "Unknown error"}`,
                cause: error,
              }),
          });

          const currentLines = document.getText().split("\n");

          // Replace the block's lines with original lines
          const newLines = [
            ...currentLines.slice(0, blockToReject.startLine - 1),
            ...blockToReject.originalLines,
            ...currentLines.slice(
              blockToReject.startLine - 1 + blockToReject.newLineCount,
            ),
          ];

          // Calculate line shift for subsequent blocks
          const lineShift =
            blockToReject.originalLines.length - blockToReject.newLineCount;

          // Update subsequent blocks' line numbers
          const updatedBlocks = fileEdits.blocks
            .filter((b) => b.blockId !== blockId)
            .map((b) => {
              if (b.startLine > blockToReject.startLine) {
                return {
                  ...b,
                  startLine: b.startLine + lineShift,
                  endLine: b.endLine + lineShift,
                };
              }
              return b;
            });

          // Write the reverted content
          const content = Buffer.from(newLines.join("\n"), "utf-8");
          yield* Effect.tryPromise({
            try: () => vscode.workspace.fs.writeFile(fileUri, content),
            catch: (error) =>
              new PendingEditError({
                message: `Failed to write file: ${error instanceof Error ? error.message : "Unknown error"}`,
                cause: error,
              }),
          });

          if (updatedBlocks.length === 0) {
            // No more blocks, remove file from tracking
            yield* Ref.update(pendingEditsRef, (edits) => {
              const newEdits = new Map(edits);
              newEdits.delete(filePath);
              return newEdits;
            });
          } else {
            // Update with remaining blocks
            yield* Ref.update(pendingEditsRef, (edits) => {
              const newEdits = new Map(edits);
              newEdits.set(filePath, {
                ...fileEdits,
                blocks: updatedBlocks,
              });
              return newEdits;
            });
          }

          yield* fireChangeEvent();
          return true;
        });

      /**
       * Accept all blocks for a file (keep current file content)
       * Removes all blocks from pending without reverting
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
       * Reject all blocks for a file (revert to original content)
       * Restores the original content and removes from pending
       */
      const rejectEdit = (filePath: string) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          const fileEdits = pendingEdits.get(filePath);

          if (!fileEdits) {
            return false;
          }

          const fileUri = vscode.Uri.file(filePath);

          if (fileEdits.isNewFile) {
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
            const content = Buffer.from(fileEdits.baseContent, "utf-8");
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
       * Check if a file has any pending edits
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
       * Get all blocks for a file
       */
      const getBlocksForFile = (filePath: string) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          const fileEdits = pendingEdits.get(filePath);
          return fileEdits?.blocks || [];
        });

      /**
       * Synchronous version of getBlocksForFile for CodeLens provider
       */
      const getBlocksForFileSync = (filePath: string): EditBlock[] => {
        return Runtime.runSync(Runtime.defaultRuntime)(
          Ref.get(pendingEditsRef).pipe(
            Effect.map((edits) => {
              const fileEdits = edits.get(filePath);
              return fileEdits?.blocks || [];
            }),
          ),
        );
      };

      /**
       * Get file edit info including base content
       */
      const getFileEdits = (filePath: string) =>
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
        registerBlock: _registerBlock,
        acceptBlock,
        rejectBlock,
        acceptEdit,
        rejectEdit,
        hasPendingEdit,
        hasPendingEditSync,
        getBlocksForFile,
        getBlocksForFileSync,
        getFileEdits,
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
  return Runtime.runPromise(Runtime.defaultRuntime)(
    service.rejectEdit(filePath),
  );
}

/**
 * Helper to run acceptEdit effect
 */
export async function acceptEditAsync(filePath: string): Promise<boolean> {
  const service = getPendingEditServiceInstance();
  return Runtime.runPromise(Runtime.defaultRuntime)(
    service.acceptEdit(filePath),
  );
}

/**
 * Helper to accept a specific block
 */
export async function acceptBlockAsync(
  filePath: string,
  blockId: string,
): Promise<boolean> {
  const service = getPendingEditServiceInstance();
  return Runtime.runPromise(Runtime.defaultRuntime)(
    service.acceptBlock(filePath, blockId),
  );
}

/**
 * Helper to reject a specific block
 */
export async function rejectBlockAsync(
  filePath: string,
  blockId: string,
): Promise<boolean> {
  const service = getPendingEditServiceInstance();
  return Runtime.runPromise(Runtime.defaultRuntime)(
    service.rejectBlock(filePath, blockId),
  );
}

/**
 * Helper to register a block (sync wrapper for tools)
 */
export function registerBlockSync(
  filePath: string,
  blockId: string,
  startLine: number,
  endLine: number,
  originalLines: string[],
  newLineCount: number,
  baseContent?: string,
  isNewFile: boolean = false,
): void {
  const service = getPendingEditServiceInstance();
  Runtime.runSync(Runtime.defaultRuntime)(
    service.registerBlock(
      filePath,
      blockId,
      startLine,
      endLine,
      originalLines,
      newLineCount,
      baseContent,
      isNewFile,
    ),
  );
}

/**
 * Helper to get file edits (sync wrapper for editor listener)
 */
export function getFileEditsSync(
  filePath: string,
): PendingFileEdits | undefined {
  const service = getPendingEditServiceInstance();
  return Runtime.runSync(Runtime.defaultRuntime)(
    service.getFileEdits(filePath),
  );
}
