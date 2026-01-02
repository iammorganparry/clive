/**
 * Service wrapper for DiffTrackerService that integrates with VS Code
 * Provides Effect-based interface with interop helpers for existing code
 */

import * as vscode from "vscode";
import { Effect, Layer, Runtime } from "effect";
import {
  type DiffBlock,
  type LineRange,
  type EditorAdapter,
  EditorAdapterTag,
  DiffTrackerService,
} from "@clive/core";
import { VSCodeEditorAdapterService } from "../adapters/vscode-editor-adapter.js";
import { EditorInsetService } from "./editor-inset-service.js";
import { computeLineDiff } from "./ai-agent/tools/diff-engine.js";

/**
 * Create the adapter layer by mapping VSCodeEditorAdapterService to EditorAdapterTag
 */
const AdapterLayer = Layer.effect(
  EditorAdapterTag,
  Effect.gen(function* () {
    const adapter = yield* VSCodeEditorAdapterService;
    // Type assertion needed because TypeScript may not have picked up
    // the interface changes yet (UI methods were removed from EditorAdapter)
    return adapter as unknown as EditorAdapter;
  }).pipe(Effect.provide(VSCodeEditorAdapterService.Default)),
);

/**
 * Live layer for DiffTrackerService with adapter provided
 */
const DiffTrackerLive = DiffTrackerService.Default.pipe(
  Layer.provide(AdapterLayer),
);

/**
 * Lazy service instances
 */
let _service: DiffTrackerService | null = null;
let _adapter: EditorAdapter | null = null;

/**
 * Get the service instance
 */
const getService = (): DiffTrackerService => {
  if (!_service) {
    _service = Runtime.runSync(Runtime.defaultRuntime)(
      Effect.gen(function* () {
        return yield* DiffTrackerService;
      }).pipe(Effect.provide(DiffTrackerLive)),
    );
  }
  return _service;
};

/**
 * Get the adapter instance
 */
const getAdapter = (): EditorAdapter => {
  if (!_adapter) {
    _adapter = Runtime.runSync(Runtime.defaultRuntime)(
      Effect.gen(function* () {
        return yield* EditorAdapterTag;
      }).pipe(Effect.provide(AdapterLayer)),
    );
  }
  return _adapter;
};

/**
 * Service wrapper that provides a convenient interface
 */
export class DiffTrackerServiceWrapper {
  private insetService: EditorInsetService | null = null;
  private pendingInsetUpdates: Set<string> = new Set();

  constructor(extensionUri?: vscode.Uri) {
    if (extensionUri) {
      this.insetService = new EditorInsetService(extensionUri);
    }
    // Set up event listeners for decoration persistence
    this.setupEventListeners();
  }

  /**
   * Set the extension URI for the inset service
   */
  setExtensionUri(extensionUri: vscode.Uri): void {
    if (!this.insetService) {
      this.insetService = new EditorInsetService(extensionUri);
    }
  }

  private setupEventListeners(): void {
    const service = getService();
    const adapter = getAdapter();
    // Listen to file changes and reapply decorations if needed
    Runtime.runPromise(Runtime.defaultRuntime)(
      adapter
        .onFileChanged((filePath, content) => {
          Runtime.runPromise(Runtime.defaultRuntime)(
            Effect.gen(function* () {
              const hasEdits = yield* service.hasPendingEdits(filePath);
              if (!hasEdits) {
                return;
              }

              // Check if this is an external edit
              const isExternal = yield* service.isExternalEdit(
                filePath,
                content,
              );
              if (isExternal) {
                yield* service.handleExternalEdit(filePath);
                return;
              }

              // Note: UI updates (decorations, accept/reject buttons) are now handled
              // by EditorInsetService, not through the adapter
            }).pipe(Effect.provide(DiffTrackerLive)),
          ).catch((error) => {
            console.error("Error handling file change:", error);
          });
        })
        .pipe(Effect.provide(AdapterLayer)),
    );

    // Listen to active file changes and reapply decorations
    Runtime.runPromise(Runtime.defaultRuntime)(
      adapter
        .onActiveFileChanged((filePath) => {
          if (!filePath) {
            return;
          }

          Runtime.runPromise(Runtime.defaultRuntime)(
            Effect.gen(function* () {
              const hasEdits = yield* service.hasPendingEdits(filePath);
              if (!hasEdits) {
                return;
              }

              // Get current content
              const content = yield* adapter.getFileContent(filePath);

              // Check for external edits
              const isExternal = yield* service.isExternalEdit(
                filePath,
                content,
              );
              if (isExternal) {
                yield* service.handleExternalEdit(filePath);
                return;
              }

              // Note: UI updates (decorations, accept/reject buttons) are now handled
              // by EditorInsetService, not through the adapter
            }).pipe(Effect.provide(DiffTrackerLive)),
          ).catch((error) => {
            console.error("Error handling active file change:", error);
          });
        })
        .pipe(Effect.provide(AdapterLayer)),
    );

    // Listen to diff events to update UI insets
    Runtime.runSync(Runtime.defaultRuntime)(
      service
        .onDiffEvent((event) => {
          if (!this.insetService) {
            return;
          }

          if (event.type === "block-added") {
            // Show inset for the new block
            this.updateInsetForFile(event.filePath);
          } else if (
            event.type === "block-accepted" ||
            event.type === "block-rejected"
          ) {
            // Hide inset for the accepted/rejected block
            if (event.blockId) {
              this.insetService.hideUI(event.filePath, event.blockId);
            }
          } else if (event.type === "all-cleared") {
            // Hide all insets for the file
            this.insetService.hideAllForFile(event.filePath);
          }
        })
        .pipe(Effect.provide(DiffTrackerLive)),
    );

    // Listen for editor visibility changes to show pending insets
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      // Check if any pending files are now visible
      for (const filePath of this.pendingInsetUpdates) {
        const editor = editors.find((e) => e.document.uri.fsPath === filePath);
        if (editor) {
          this.pendingInsetUpdates.delete(filePath);
          this.updateInsetForFile(filePath);
        }
      }
    });
  }

  /**
   * Update inset UI for all blocks in a file
   */
  private updateInsetForFile(filePath: string): void {
    // Defensive check: ensure insetService is initialized
    if (!this.insetService) {
      return;
    }

    const blocks = this.getBlocksForFile(filePath);
    if (blocks.length === 0) {
      return;
    }

    // Find the editor for this file
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.fsPath === filePath,
    );
    if (!editor) {
      // Editor not visible yet, add to pending updates
      this.pendingInsetUpdates.add(filePath);
      return;
    }

    const adapter = getAdapter();
    const currentContent = Runtime.runSync(Runtime.defaultRuntime)(
      adapter.getFileContent(filePath).pipe(Effect.provide(AdapterLayer)),
    );

    const fileEdit = this.getPendingFileEdit(filePath);
    if (!fileEdit) {
      return;
    }

    // Compute diff between base and current content
    const diffResult = computeLineDiff(fileEdit.baseContent, currentContent);

    // Show insets for each block
    for (const block of blocks) {
      // Extract lines for this block from the diff
      const addedLines: string[] = [];
      const removedLines: string[] = [];

      // Find changes that overlap with this block's range
      for (const change of diffResult.changes) {
        const changeStartLine = change.lineStart + 1; // Convert to 1-based
        const changeEndLine = change.lineStart + change.lineCount; // 1-based, exclusive

        // Check if this change overlaps with the block
        if (
          changeStartLine <= block.range.endLine &&
          changeEndLine > block.range.startLine
        ) {
          const lines = change.content.split("\n").filter((l) => l !== "");
          if (change.type === "added") {
            addedLines.push(...lines);
          } else if (change.type === "removed") {
            removedLines.push(...lines);
          }
        }
      }

      // If no diff lines found, use originalLines as removed and try to extract added lines
      if (addedLines.length === 0 && removedLines.length === 0) {
        removedLines.push(...block.originalLines);
        // Try to get added lines from current content
        const currentLines = currentContent.split("\n");
        const blockStart = block.range.startLine - 1; // Convert to 0-based
        const blockEnd = Math.min(
          blockStart + block.newLineCount,
          currentLines.length,
        );
        addedLines.push(...currentLines.slice(blockStart, blockEnd));
      }

      this.insetService.showDiffUI(editor, block, addedLines, removedLines);
    }
  }

  /**
   * Register a new edit block
   */
  registerBlock(
    filePath: string,
    blockId: string,
    range: LineRange,
    originalLines: string[],
    newLineCount: number,
    baseContent: string,
    isNewFile: boolean,
    newContent: string,
  ): void {
    const service = getService();
    const adapter = getAdapter();

    const contentHash = adapter.computeContentHash(newContent);

    Runtime.runSync(Runtime.defaultRuntime)(
      Effect.gen(function* () {
        yield* service.beginActiveEdit(filePath);
        yield* service.registerBlock(
          filePath,
          blockId,
          range,
          originalLines,
          newLineCount,
          baseContent,
          isNewFile,
          contentHash,
        );
        yield* service.endActiveEdit(filePath, contentHash);
      }).pipe(Effect.provide(DiffTrackerLive)),
    );

    // Update inset UI for this file
    // Add to pending updates in case editor isn't visible yet
    this.pendingInsetUpdates.add(filePath);
    // Also try immediate update in case editor is already visible
    this.updateInsetForFile(filePath);
  }

  /**
   * Accept a specific block
   */
  async acceptBlock(filePath: string, blockId: string): Promise<boolean> {
    const service = getService();
    const result = await Runtime.runPromise(Runtime.defaultRuntime)(
      service
        .acceptBlock(filePath, blockId)
        .pipe(Effect.provide(DiffTrackerLive)),
    );

    // Hide inset for this block
    if (result && this.insetService) {
      this.insetService.hideUI(filePath, blockId);
    }

    return result;
  }

  /**
   * Reject a specific block
   */
  async rejectBlock(filePath: string, blockId: string): Promise<boolean> {
    const service = getService();
    const result = await Runtime.runPromise(Runtime.defaultRuntime)(
      service
        .rejectBlock(filePath, blockId)
        .pipe(Effect.provide(DiffTrackerLive)),
    );

    // Hide inset for this block
    if (result && this.insetService) {
      this.insetService.hideUI(filePath, blockId);
    }

    return result;
  }

  /**
   * Accept all blocks for a file
   */
  async acceptAll(filePath: string): Promise<boolean> {
    const service = getService();
    return Runtime.runPromise(Runtime.defaultRuntime)(
      service.acceptAll(filePath).pipe(Effect.provide(DiffTrackerLive)),
    );
  }

  /**
   * Reject all blocks for a file
   */
  async rejectAll(filePath: string): Promise<boolean> {
    const service = getService();
    return Runtime.runPromise(Runtime.defaultRuntime)(
      service.rejectAll(filePath).pipe(Effect.provide(DiffTrackerLive)),
    );
  }

  /**
   * Get blocks for a file
   */
  getBlocksForFile(filePath: string): DiffBlock[] {
    const service = getService();
    return Runtime.runSync(Runtime.defaultRuntime)(
      service.getBlocksForFile(filePath).pipe(Effect.provide(DiffTrackerLive)),
    );
  }

  /**
   * Check if file has pending edits
   */
  hasPendingEdits(filePath: string): boolean {
    const service = getService();
    return Runtime.runSync(Runtime.defaultRuntime)(
      service.hasPendingEdits(filePath).pipe(Effect.provide(DiffTrackerLive)),
    );
  }

  /**
   * Get pending file edit info
   */
  getPendingFileEdit(filePath: string) {
    const service = getService();
    return Runtime.runSync(Runtime.defaultRuntime)(
      service
        .getPendingFileEdit(filePath)
        .pipe(Effect.provide(DiffTrackerLive)),
    );
  }

  /**
   * Get all file paths with pending edits
   */
  getPendingFilePaths(): string[] {
    const service = getService();
    return Runtime.runSync(Runtime.defaultRuntime)(
      service.getPendingFilePaths().pipe(Effect.provide(DiffTrackerLive)),
    );
  }

  /**
   * Dispose of the service
   */
  async dispose(): Promise<void> {
    const service = getService();
    await Runtime.runPromise(Runtime.defaultRuntime)(
      service.dispose().pipe(Effect.provide(DiffTrackerLive)),
    );
    if (this.insetService) {
      this.insetService.dispose();
    }
  }
}

/**
 * Singleton instance
 */
let diffTrackerServiceInstance: DiffTrackerServiceWrapper | null = null;

/**
 * Get or create the singleton instance
 */
export function getDiffTrackerService(): DiffTrackerServiceWrapper {
  if (!diffTrackerServiceInstance) {
    diffTrackerServiceInstance = new DiffTrackerServiceWrapper();
  }
  return diffTrackerServiceInstance;
}

/**
 * Initialize the service with extension URI
 */
export function initializeDiffTrackerService(
  extensionUri: vscode.Uri,
): DiffTrackerServiceWrapper {
  const service = getDiffTrackerService();
  service.setExtensionUri(extensionUri);
  return service;
}

/**
 * Set the singleton instance (for testing)
 */
export function setDiffTrackerService(
  service: DiffTrackerServiceWrapper | null,
): void {
  diffTrackerServiceInstance = service;
}
