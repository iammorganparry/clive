/**
 * Core diff tracking service - editor-agnostic business logic
 */

import { Effect, Ref } from "effect";
import type {
  DiffBlock,
  DiffEvent,
  LineRange,
  PendingFileEdit,
} from "./types.js";
import type { Disposable } from "../editor/adapter.js";
import { EditorAdapterTag } from "../editor/adapter.js";

/**
 * Simple event emitter for diff events
 */
class EventEmitter<T> {
  private listeners: Array<(event: T) => void> = [];

  on(listener: (event: T) => void): Disposable {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index > -1) {
          this.listeners.splice(index, 1);
        }
      },
    };
  }

  emit(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

/**
 * Core diff tracking service
 * Manages pending edits, block tracking, and external edit detection
 */
export class DiffTrackerService extends Effect.Service<DiffTrackerService>()(
  "DiffTrackerService",
  {
    effect: Effect.gen(function* () {
      const adapter = yield* EditorAdapterTag;
      const pendingEditsRef = yield* Ref.make<Map<string, PendingFileEdit>>(
        new Map(),
      );
      const activeEditsRef = yield* Ref.make<Set<string>>(new Set());
      const eventEmitter = yield* Effect.sync(
        () => new EventEmitter<DiffEvent>(),
      );

      /**
       * Fire a diff event
       */
      const fireEvent = (event: DiffEvent) =>
        Effect.sync(() => {
          eventEmitter.emit(event);
        });

      /**
       * Register a new edit block
       */
      const registerBlock = (
        filePath: string,
        blockId: string,
        range: LineRange,
        originalLines: string[],
        newLineCount: number,
        baseContent: string,
        isNewFile: boolean,
        newContentHash: string,
      ) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          const existing = pendingEdits.get(filePath);

          const newBlock: DiffBlock = {
            id: blockId,
            filePath,
            range,
            originalLines,
            newLineCount,
            timestamp: Date.now(),
          };

          if (existing) {
            // Add block to existing file edits
            const updatedBlocks = [...existing.blocks, newBlock].sort(
              (a, b) => a.range.startLine - b.range.startLine,
            );

            yield* Ref.update(pendingEditsRef, (edits) => {
              const newEdits = new Map(edits);
              newEdits.set(filePath, {
                ...existing,
                blocks: updatedBlocks,
                lastKnownContentHash: newContentHash,
              });
              return newEdits;
            });
          } else {
            // Create new file edits entry
            const fileEdit: PendingFileEdit = {
              filePath,
              blocks: [newBlock],
              baseContent,
              isNewFile,
              lastKnownContentHash: newContentHash,
            };

            yield* Ref.update(pendingEditsRef, (edits) => {
              const newEdits = new Map(edits);
              newEdits.set(filePath, fileEdit);
              return newEdits;
            });
          }

          // Mark as active edit
          yield* Ref.update(activeEditsRef, (active) => {
            const newActive = new Set(active);
            newActive.add(filePath);
            return newActive;
          });

          // Emit event
          yield* fireEvent({
            type: "block-added",
            filePath,
            blockId,
          });
        });

      /**
       * Accept a specific edit block (keep changes)
       */
      const acceptBlock = (filePath: string, blockId: string) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          const fileEdit = pendingEdits.get(filePath);
          if (!fileEdit) {
            return false;
          }

          const remainingBlocks = fileEdit.blocks.filter(
            (b) => b.id !== blockId,
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
                ...fileEdit,
                blocks: remainingBlocks,
              });
              return newEdits;
            });
          }

          // Emit event
          yield* fireEvent({
            type: "block-accepted",
            filePath,
            blockId,
          });

          return true;
        });

      /**
       * Reject a specific edit block (revert to original)
       */
      const rejectBlock = (filePath: string, blockId: string) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          const fileEdit = pendingEdits.get(filePath);
          if (!fileEdit) {
            return false;
          }

          const blockToReject = fileEdit.blocks.find((b) => b.id === blockId);
          if (!blockToReject) {
            return false;
          }

          // Read current file content
          const currentContent = yield* adapter.getFileContent(filePath);
          const currentLines = currentContent.split("\n");

          // Replace the block's lines with original lines
          const newLines = [
            ...currentLines.slice(0, blockToReject.range.startLine - 1),
            ...blockToReject.originalLines,
            ...currentLines.slice(
              blockToReject.range.startLine - 1 + blockToReject.newLineCount,
            ),
          ];

          // Calculate line shift for subsequent blocks
          const lineShift =
            blockToReject.originalLines.length - blockToReject.newLineCount;

          // Update subsequent blocks' line numbers
          const updatedBlocks = fileEdit.blocks
            .filter((b) => b.id !== blockId)
            .map((b) => {
              if (b.range.startLine > blockToReject.range.startLine) {
                return {
                  ...b,
                  range: {
                    startLine: b.range.startLine + lineShift,
                    endLine: b.range.endLine + lineShift,
                  },
                };
              }
              return b;
            });

          // Write the reverted content
          const revertedContent = newLines.join("\n");
          yield* adapter.writeFile(filePath, revertedContent);

          // Update content hash
          const newHash = adapter.computeContentHash(revertedContent);

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
                ...fileEdit,
                blocks: updatedBlocks,
                lastKnownContentHash: newHash,
              });
              return newEdits;
            });
          }

          // Emit event
          yield* fireEvent({
            type: "block-rejected",
            filePath,
            blockId,
          });

          return true;
        });

      /**
       * Accept all blocks for a file (keep current content)
       */
      const acceptAll = (filePath: string) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          const hadEdit = pendingEdits.has(filePath);

          if (hadEdit) {
            yield* Ref.update(pendingEditsRef, (edits) => {
              const newEdits = new Map(edits);
              newEdits.delete(filePath);
              return newEdits;
            });

            // Emit event
            yield* fireEvent({
              type: "all-cleared",
              filePath,
            });
          }

          return hadEdit;
        });

      /**
       * Reject all blocks for a file (revert to original content)
       */
      const rejectAll = (filePath: string) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          const fileEdit = pendingEdits.get(filePath);
          if (!fileEdit) {
            return false;
          }

          if (fileEdit.isNewFile) {
            // Delete the new file
            yield* adapter.deleteFile(filePath);
          } else {
            // Restore original content
            yield* adapter.writeFile(filePath, fileEdit.baseContent);
          }

          yield* Ref.update(pendingEditsRef, (edits) => {
            const newEdits = new Map(edits);
            newEdits.delete(filePath);
            return newEdits;
          });

          // Emit event
          yield* fireEvent({
            type: "all-cleared",
            filePath,
          });

          return true;
        });

      /**
       * Mark file as actively being edited by our agent
       */
      const beginActiveEdit = (filePath: string) =>
        Effect.gen(function* () {
          yield* Ref.update(activeEditsRef, (active) => {
            const newActive = new Set(active);
            newActive.add(filePath);
            return newActive;
          });
        });

      /**
       * Mark file edit as complete and update content hash
       */
      const endActiveEdit = (filePath: string, newContentHash: string) =>
        Effect.gen(function* () {
          yield* Ref.update(activeEditsRef, (active) => {
            const newActive = new Set(active);
            newActive.delete(filePath);
            return newActive;
          });

          const pendingEdits = yield* Ref.get(pendingEditsRef);
          const fileEdit = pendingEdits.get(filePath);
          if (fileEdit) {
            yield* Ref.update(pendingEditsRef, (edits) => {
              const newEdits = new Map(edits);
              newEdits.set(filePath, {
                ...fileEdit,
                lastKnownContentHash: newContentHash,
              });
              return newEdits;
            });
          }
        });

      /**
       * Check if current content indicates an external edit
       */
      const isExternalEdit = (filePath: string, currentContent: string) =>
        Effect.gen(function* () {
          const activeEdits = yield* Ref.get(activeEditsRef);
          // If we're actively editing, it's not external
          if (activeEdits.has(filePath)) {
            return false;
          }

          const pendingEdits = yield* Ref.get(pendingEditsRef);
          const fileEdit = pendingEdits.get(filePath);
          if (!fileEdit) {
            return false;
          }

          const currentHash = adapter.computeContentHash(currentContent);
          return currentHash !== fileEdit.lastKnownContentHash;
        });

      /**
       * Handle external edit by clearing pending state
       */
      const handleExternalEdit = (filePath: string) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          const fileEdit = pendingEdits.get(filePath);
          if (!fileEdit) {
            return;
          }

          // Clear pending edits
          yield* Ref.update(pendingEditsRef, (edits) => {
            const newEdits = new Map(edits);
            newEdits.delete(filePath);
            return newEdits;
          });
          yield* Ref.update(activeEditsRef, (active) => {
            const newActive = new Set(active);
            newActive.delete(filePath);
            return newActive;
          });

          // Emit event
          yield* fireEvent({
            type: "external-edit",
            filePath,
          });
        });

      /**
       * Get all blocks for a file
       */
      const getBlocksForFile = (filePath: string) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          const fileEdit = pendingEdits.get(filePath);
          return fileEdit?.blocks || [];
        });

      /**
       * Check if file has pending edits
       */
      const hasPendingEdits = (filePath: string) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          return pendingEdits.has(filePath);
        });

      /**
       * Get pending file edit info
       */
      const getPendingFileEdit = (filePath: string) =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          return pendingEdits.get(filePath);
        });

      /**
       * Get all file paths with pending edits
       */
      const getPendingFilePaths = () =>
        Effect.gen(function* () {
          const pendingEdits = yield* Ref.get(pendingEditsRef);
          return Array.from(pendingEdits.keys());
        });

      /**
       * Clear all pending edits
       * Note: UI updates (decorations, accept/reject buttons) are now handled
       * by EditorInsetService, not through the adapter
       */
      const clearAll = () =>
        Effect.gen(function* () {
          yield* Ref.set(pendingEditsRef, new Map());
          yield* Ref.set(activeEditsRef, new Set());
        });

      /**
       * Subscribe to diff events
       */
      const onDiffEvent = (callback: (event: DiffEvent) => void) =>
        Effect.sync(() => eventEmitter.on(callback));

      /**
       * Dispose of the tracker
       */
      const dispose = () =>
        Effect.gen(function* () {
          yield* clearAll();
          yield* Effect.sync(() => {
            eventEmitter.dispose();
          });
        });

      return {
        registerBlock,
        acceptBlock,
        rejectBlock,
        acceptAll,
        rejectAll,
        beginActiveEdit,
        endActiveEdit,
        isExternalEdit,
        handleExternalEdit,
        getBlocksForFile,
        hasPendingEdits,
        getPendingFileEdit,
        getPendingFilePaths,
        clearAll,
        onDiffEvent,
        dispose,
      };
    }),
    dependencies: [],
  },
) {}
