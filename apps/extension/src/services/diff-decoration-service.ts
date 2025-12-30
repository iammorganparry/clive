import * as vscode from "vscode";
import { Data, Effect, Ref, Runtime } from "effect";

/**
 * Represents decoration state for a file
 */
export interface FileDecorationState {
  /** The file path */
  filePath: string;
  /** Line ranges with added content (green background) */
  addedRanges: vscode.Range[];
  /** Line ranges with removed content (red background + strikethrough) */
  removedRanges: vscode.Range[];
  /** Original line count before modifications */
  originalLineCount: number;
  /** New line count after modifications */
  newLineCount: number;
}

/**
 * Diff change type
 */
export interface DiffChange {
  type: "added" | "removed" | "unchanged";
  startLine: number;
  endLine: number;
}

/**
 * Error types for diff decoration operations
 */
export class DiffDecorationError extends Data.TaggedError("DiffDecorationError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * Service for managing inline diff decorations using VS Code's TextEditorDecorationType API
 * Shows green background for added lines and red background + strikethrough for removed lines
 */
export class DiffDecorationService extends Effect.Service<DiffDecorationService>()(
  "DiffDecorationService",
  {
    effect: Effect.gen(function* () {
      // Decoration types
      const addedLineDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: "rgba(35, 134, 54, 0.2)", // green with transparency
        isWholeLine: true,
      });

      const removedLineDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: "rgba(248, 81, 73, 0.2)", // red with transparency
        textDecoration: "line-through",
        isWholeLine: true,
      });

      // Track decorations per file
      const fileDecorationsRef = yield* Ref.make<Map<string, FileDecorationState>>(
        new Map(),
      );

      /**
       * Calculate diff between two contents (line-by-line comparison)
       */
      const calculateDiff = (
        originalContent: string,
        newContent: string,
      ): DiffChange[] => {
        const originalLines = originalContent.split("\n");
        const newLines = newContent.split("\n");
        const changes: DiffChange[] = [];

        let oldIndex = 0;
        let newIndex = 0;

        while (oldIndex < originalLines.length || newIndex < newLines.length) {
          if (oldIndex >= originalLines.length) {
            // Only new lines remain
            const startLine = newIndex;
            while (newIndex < newLines.length) {
              newIndex++;
            }
            changes.push({
              type: "added",
              startLine,
              endLine: newIndex - 1,
            });
          } else if (newIndex >= newLines.length) {
            // Only old lines remain (removed)
            const startLine = oldIndex;
            while (oldIndex < originalLines.length) {
              oldIndex++;
            }
            changes.push({
              type: "removed",
              startLine,
              endLine: oldIndex - 1,
            });
          } else if (originalLines[oldIndex] === newLines[newIndex]) {
            // Lines match
            oldIndex++;
            newIndex++;
          } else {
            // Lines differ - try to find next match
            let foundMatch = false;
            const lookAhead = 10;

            // Look ahead in new lines for a match with current old line
            for (
              let searchNew = newIndex + 1;
              searchNew < Math.min(newIndex + lookAhead, newLines.length);
              searchNew++
            ) {
              if (originalLines[oldIndex] === newLines[searchNew]) {
                // Found match - lines from newIndex to searchNew-1 are added
                changes.push({
                  type: "added",
                  startLine: newIndex,
                  endLine: searchNew - 1,
                });
                newIndex = searchNew;
                foundMatch = true;
                break;
              }
            }

            if (!foundMatch) {
              // Look ahead in old lines for a match with current new line
              for (
                let searchOld = oldIndex + 1;
                searchOld < Math.min(oldIndex + lookAhead, originalLines.length);
                searchOld++
              ) {
                if (originalLines[searchOld] === newLines[newIndex]) {
                  // Found match - lines from oldIndex to searchOld-1 are removed
                  changes.push({
                    type: "removed",
                    startLine: oldIndex,
                    endLine: searchOld - 1,
                  });
                  oldIndex = searchOld;
                  foundMatch = true;
                  break;
                }
              }
            }

            if (!foundMatch) {
              // No match found - treat as both removed and added
              changes.push({
                type: "removed",
                startLine: oldIndex,
                endLine: oldIndex,
              });
              changes.push({
                type: "added",
                startLine: newIndex,
                endLine: newIndex,
              });
              oldIndex++;
              newIndex++;
            }
          }
        }

        return changes;
      };

      /**
       * Apply diff decorations to an editor
       * For new files, all lines are marked as added (green background)
       * For edited files, calculates diff and applies appropriate decorations
       * 
       * @param editor The TextEditor to apply decorations to (obtained from showTextDocument)
       * @param originalContent The original content before the edit
       * @param newContent The new content after the edit (for state tracking)
       * @param isNewFile Whether this is a new file (all lines will be green)
       */
      const applyDiffDecorations = (
        editor: vscode.TextEditor,
        originalContent: string,
        newContent: string,
        isNewFile: boolean = false,
      ) =>
        Effect.gen(function* () {
          const filePath = editor.document.uri.fsPath;

          if (isNewFile) {
            // All lines are new - apply green background to entire file
            const lineCount = editor.document.lineCount;
            const addedRanges = [
              new vscode.Range(
                new vscode.Position(0, 0),
                new vscode.Position(Math.max(0, lineCount - 1), Number.MAX_SAFE_INTEGER),
              ),
            ];

            editor.setDecorations(addedLineDecoration, addedRanges);

            // Store decoration state
            yield* Ref.update(fileDecorationsRef, (map) => {
              const newMap = new Map(map);
              newMap.set(filePath, {
                filePath,
                addedRanges,
                removedRanges: [],
                originalLineCount: 0,
                newLineCount: lineCount,
              });
              return newMap;
            });
          } else {
            // Calculate diff and apply decorations
            const changes = calculateDiff(originalContent, newContent);
            const addedRanges: vscode.Range[] = [];
            const removedRanges: vscode.Range[] = [];

            for (const change of changes) {
              if (change.type === "added") {
                // Map to actual document line numbers
                addedRanges.push(
                  new vscode.Range(
                    new vscode.Position(change.startLine, 0),
                    new vscode.Position(change.endLine, Number.MAX_SAFE_INTEGER),
                  ),
                );
              } else if (change.type === "removed") {
                // For removed lines, we need to track them for display
                // Note: These won't be visible in the current implementation
                // as they're not in the actual file content
                removedRanges.push(
                  new vscode.Range(
                    new vscode.Position(change.startLine, 0),
                    new vscode.Position(change.endLine, Number.MAX_SAFE_INTEGER),
                  ),
                );
              }
            }

            editor.setDecorations(addedLineDecoration, addedRanges);
            // Removed lines decorations will be applied after inserting them
            editor.setDecorations(removedLineDecoration, removedRanges);

            // Store decoration state
            yield* Ref.update(fileDecorationsRef, (map) => {
              const newMap = new Map(map);
              newMap.set(filePath, {
                filePath,
                addedRanges,
                removedRanges,
                originalLineCount: originalContent.split("\n").length,
                newLineCount: newContent.split("\n").length,
              });
              return newMap;
            });
          }

          yield* Effect.logDebug(
            `[DiffDecorationService] Applied decorations to ${filePath}`,
          );
        });

      /**
       * Clear decorations for a file
       */
      const clearDecorations = (filePath: string) =>
        Effect.gen(function* () {
          const editor = vscode.window.visibleTextEditors.find(
            (e) => e.document.uri.fsPath === filePath,
          );

          if (editor) {
            editor.setDecorations(addedLineDecoration, []);
            editor.setDecorations(removedLineDecoration, []);
          }

          // Remove from state
          yield* Ref.update(fileDecorationsRef, (map) => {
            const newMap = new Map(map);
            newMap.delete(filePath);
            return newMap;
          });

          yield* Effect.logDebug(
            `[DiffDecorationService] Cleared decorations for ${filePath}`,
          );
        });

      /**
       * Clear all decorations
       */
      const clearAllDecorations = () =>
        Effect.gen(function* () {
          const decorations = yield* Ref.get(fileDecorationsRef);

          for (const filePath of decorations.keys()) {
            yield* clearDecorations(filePath);
          }

          yield* Effect.logDebug(
            "[DiffDecorationService] Cleared all decorations",
          );
        });

      /**
       * Get decoration state for a file
       */
      const getDecorationState = (filePath: string) =>
        Effect.gen(function* () {
          const decorations = yield* Ref.get(fileDecorationsRef);
          return decorations.get(filePath);
        });

      /**
       * Dispose of the service and cleanup decorations
       */
      const dispose = () =>
        Effect.gen(function* () {
          yield* clearAllDecorations();
          yield* Effect.sync(() => {
            addedLineDecoration.dispose();
            removedLineDecoration.dispose();
          });
        });

      return {
        applyDiffDecorations,
        clearDecorations,
        clearAllDecorations,
        getDecorationState,
        dispose,
      };
    }),
  },
) {}

/**
 * Singleton instance holder for synchronous access
 */
let diffDecorationServiceInstance: DiffDecorationService | null = null;

/**
 * Set the singleton instance (called during extension activation)
 */
export function setDiffDecorationServiceInstance(
  service: DiffDecorationService,
): void {
  diffDecorationServiceInstance = service;
}

/**
 * Get the singleton instance
 */
export function getDiffDecorationServiceInstance(): DiffDecorationService {
  if (!diffDecorationServiceInstance) {
    throw new Error(
      "DiffDecorationService not initialized. Ensure the service is created first.",
    );
  }
  return diffDecorationServiceInstance;
}

/**
 * Helper to apply diff decorations (sync wrapper for tools)
 * 
 * @param editor The TextEditor to apply decorations to (obtained from showTextDocument)
 * @param originalContent The original content before the edit
 * @param newContent The new content after the edit
 * @param isNewFile Whether this is a new file (all lines will be green)
 */
export function applyDiffDecorationsSync(
  editor: vscode.TextEditor,
  originalContent: string,
  newContent: string,
  isNewFile: boolean = false,
): void {
  const service = getDiffDecorationServiceInstance();
  Runtime.runSync(Runtime.defaultRuntime)(
    service.applyDiffDecorations(editor, originalContent, newContent, isNewFile),
  );
}

/**
 * Helper to clear decorations (sync wrapper for tools)
 */
export function clearDecorationsSync(filePath: string): void {
  const service = getDiffDecorationServiceInstance();
  Runtime.runSync(Runtime.defaultRuntime)(service.clearDecorations(filePath));
}

/**
 * Default layer for convenience
 */
export const DiffDecorationServiceLive = DiffDecorationService.Default;
