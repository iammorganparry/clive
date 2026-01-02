/**
 * Editor adapter interface for editor-agnostic diff tracking
 */

import { Context, type Effect } from "effect";
import type { FileSystemError, EditorError } from "../diff/errors.js";

/**
 * Disposable resource that can be cleaned up
 */
export interface Disposable {
  dispose(): void;
}

/**
 * Abstract interface for editor operations
 * Implementations provide editor-specific functionality
 */
export interface EditorAdapter {
  // File Operations
  /**
   * Read file content as string
   */
  readFile(path: string): Effect.Effect<string, FileSystemError>;

  /**
   * Write file content
   */
  writeFile(
    path: string,
    content: string,
  ): Effect.Effect<void, FileSystemError>;

  /**
   * Delete a file
   */
  deleteFile(path: string): Effect.Effect<void, FileSystemError>;

  /**
   * Check if file exists
   */
  fileExists(path: string): Effect.Effect<boolean, FileSystemError>;

  // Editor State
  /**
   * Get the currently active file path, or null if none
   */
  getActiveFilePath(): Effect.Effect<string | null>;

  /**
   * Get current content of a file (may differ from disk if unsaved)
   */
  getFileContent(path: string): Effect.Effect<string, FileSystemError>;

  /**
   * Open a file in the editor
   */
  openFile(path: string): Effect.Effect<void, EditorError>;

  // Events
  /**
   * Register callback for file content changes
   * Returns a disposable to unregister
   */
  onFileChanged(
    callback: (filePath: string, content: string) => void,
  ): Effect.Effect<Disposable>;

  /**
   * Register callback for active file changes
   * Returns a disposable to unregister
   */
  onActiveFileChanged(
    callback: (filePath: string | null) => void,
  ): Effect.Effect<Disposable>;

  // Utilities
  /**
   * Compute content hash for change detection
   */
  computeContentHash(content: string): string;
}

/**
 * Context tag for EditorAdapter dependency injection
 */
export class EditorAdapterTag extends Context.Tag("EditorAdapter")<
  EditorAdapterTag,
  EditorAdapter
>() {}
