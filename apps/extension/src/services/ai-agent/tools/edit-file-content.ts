import * as path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { Runtime, Effect, pipe } from "effect";
import { VSCodeService } from "../../vs-code.js";
import { processModelContent } from "../../../utils/model-content-processor.js";
import { formatFileEditError } from "../response-formatter.js";
import { registerBlockSync } from "../../pending-edit-service.js";
import { applyDiffDecorationsSync } from "../../diff-decoration-service.js";

/**
 * SEARCH/REPLACE block interface
 */
interface SearchReplaceBlock {
  search: string;
  replace: string;
}

/**
 * Parse SEARCH/REPLACE blocks from diff string
 * Supports format:
 * ------- SEARCH
 * [content]
 * =======
 * [replacement]
 * +++++++ REPLACE
 *
 * Also supports legacy format:
 * < SEARCH
 * [content]
 * >>> REPLACE
 * [replacement]
 */
function parseSearchReplaceBlocks(diff: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];

  // Try modern format first (------- SEARCH / ======= / +++++++ REPLACE)
  // Make trailing newline optional to handle blocks at end of string
  const modernPattern =
    /(-{7,}\s*SEARCH\s*\n)([\s\S]*?)(={7,}\s*\n)([\s\S]*?)(\+{7,}\s*REPLACE\s*\n?)/g;

  // Reset regex lastIndex
  modernPattern.lastIndex = 0;

  let match: RegExpExecArray | null = modernPattern.exec(diff);
  while (match !== null) {
    // Trim trailing newlines from search/replace content to avoid matching issues
    const searchContent = match[2].replace(/\n+$/, "");
    const replaceContent = match[4].replace(/\n+$/, "");

    blocks.push({
      search: searchContent,
      replace: replaceContent,
    });
    match = modernPattern.exec(diff);
  }

  // If no modern format blocks found, try legacy format
  if (blocks.length === 0) {
    const legacyPattern =
      /(?:<{1,3}\s*SEARCH\s*\n)([\s\S]*?)(?:>{3}\s*REPLACE\s*\n)([\s\S]*?)(?=(?:<{1,3}\s*SEARCH|$))/g;
    legacyPattern.lastIndex = 0;

    match = legacyPattern.exec(diff);
    while (match !== null) {
      // Trim trailing newlines from search/replace content
      const searchContent = match[1].replace(/\n+$/, "");
      const replaceContent = match[2].replace(/\n+$/, "");

      blocks.push({
        search: searchContent,
        replace: replaceContent,
      });
      match = legacyPattern.exec(diff);
    }
  }

  return blocks;
}

/**
 * Get line index (0-based) for a character position
 */
function getLineIndexAtPosition(content: string, position: number): number {
  let lineIndex = 0;
  for (let i = 0; i < position && i < content.length; i++) {
    if (content[i] === "\n") {
      lineIndex++;
    }
  }
  return lineIndex;
}

/**
 * Get character position at the start of a line (0-based line index)
 */
function getPositionAtLine(content: string, lineIndex: number): number {
  let position = 0;
  let currentLine = 0;

  for (let i = 0; i < content.length; i++) {
    if (currentLine === lineIndex) {
      return position;
    }
    if (content[i] === "\n") {
      currentLine++;
    }
    position++;
  }

  return position;
}

/**
 * Line-trimmed matching: compares lines after trimming whitespace
 */
function findLineTrimmedMatch(
  originalContent: string,
  searchContent: string,
  startIndex: number,
): { index: number; matchedContent: string } | null {
  const searchLines = searchContent.split("\n");
  const originalLines = originalContent.split("\n");

  // Find starting line in original content
  const startLineIndex = getLineIndexAtPosition(originalContent, startIndex);

  for (
    let origLineIdx = startLineIndex;
    origLineIdx <= originalLines.length - searchLines.length;
    origLineIdx++
  ) {
    let matchFound = true;
    let matchedContent = "";

    for (
      let searchLineIdx = 0;
      searchLineIdx < searchLines.length;
      searchLineIdx++
    ) {
      const searchLine = searchLines[searchLineIdx]?.trimEnd() ?? "";
      const origLine =
        originalLines[origLineIdx + searchLineIdx]?.trimEnd() ?? "";

      if (searchLine !== origLine) {
        matchFound = false;
        break;
      }

      // Reconstruct matched content with original whitespace
      if (searchLineIdx > 0) {
        matchedContent += "\n";
      }
      matchedContent += originalLines[origLineIdx + searchLineIdx];
    }

    if (matchFound) {
      // Calculate character position
      const charIndex = getPositionAtLine(originalContent, origLineIdx);
      return {
        index: charIndex,
        matchedContent,
      };
    }
  }

  return null;
}

/**
 * Block anchor matching: uses first and last lines as anchors
 */
function findBlockAnchorMatch(
  originalContent: string,
  _searchContent: string,
  searchLines: string[],
  startIndex: number,
): { index: number; matchedContent: string } | null {
  const originalLines = originalContent.split("\n");
  const startAnchor = searchLines[0]?.trimEnd() ?? "";
  const endAnchor = searchLines[searchLines.length - 1]?.trimEnd() ?? "";

  if (!startAnchor || !endAnchor) {
    return null;
  }

  const startLineIndex = getLineIndexAtPosition(originalContent, startIndex);

  // Find all potential start anchor matches
  for (
    let i = startLineIndex;
    i <= originalLines.length - searchLines.length;
    i++
  ) {
    const origStartLine = originalLines[i]?.trimEnd() ?? "";
    if (origStartLine !== startAnchor) {
      continue;
    }

    // Check if end anchor matches at expected position
    const endLineIdx = i + searchLines.length - 1;
    if (endLineIdx >= originalLines.length) {
      continue;
    }

    const origEndLine = originalLines[endLineIdx]?.trimEnd() ?? "";
    if (origEndLine !== endAnchor) {
      continue;
    }

    // Verify block size matches
    const matchedBlock = originalLines
      .slice(i, i + searchLines.length)
      .join("\n");
    const matchedLines = matchedBlock.split("\n");

    if (matchedLines.length === searchLines.length) {
      const charIndex = getPositionAtLine(originalContent, i);
      return {
        index: charIndex,
        matchedContent: matchedBlock,
      };
    }
  }

  return null;
}

/**
 * Three-tier matching strategy for finding SEARCH content in original file
 * 1. Exact match (character-for-character)
 * 2. Line-trimmed fallback (ignores leading/trailing whitespace per line)
 * 3. Block anchor match (uses first and last lines as anchors for 3+ line blocks)
 */
function findSearchContent(
  originalContent: string,
  searchContent: string,
  startIndex: number = 0,
): { index: number; matchedContent: string } | null {
  // Strategy 1: Exact match
  const exactIndex = originalContent.indexOf(searchContent, startIndex);
  if (exactIndex !== -1) {
    return {
      index: exactIndex,
      matchedContent: searchContent,
    };
  }

  // Strategy 2: Line-trimmed fallback
  const trimmedMatch = findLineTrimmedMatch(
    originalContent,
    searchContent,
    startIndex,
  );
  if (trimmedMatch) {
    return trimmedMatch;
  }

  // Strategy 3: Block anchor match (for blocks with 3+ lines)
  const lines = searchContent.split("\n");
  if (lines.length >= 3) {
    const anchorMatch = findBlockAnchorMatch(
      originalContent,
      searchContent,
      lines,
      startIndex,
    );
    if (anchorMatch) {
      return anchorMatch;
    }
  }

  return null;
}

export interface EditFileContentInput {
  targetPath: string;
  diff: string;
}

export interface EditFileContentOutput {
  success: boolean;
  filePath: string;
  message: string;
}

/**
 * Streaming file output callback type
 * Receives file path and content chunks as they're written
 */
export type StreamingFileOutputCallback = (chunk: {
  filePath: string;
  content: string;
  isComplete: boolean;
}) => void;

/**
 * Construct new file content by applying SEARCH/REPLACE blocks
 * Processes blocks sequentially and tracks position to ensure order
 */
function constructNewFileContent(
  originalContent: string,
  diff: string,
): { content: string; error?: string } {
  const blocks = parseSearchReplaceBlocks(diff);

  if (blocks.length === 0) {
    // Empty diff means replace entire file
    // If original is empty, this is a pure insertion
    if (originalContent.length === 0) {
      return { content: "" };
    }
    // Otherwise, check if diff itself is the new content (write_to_file style)
    return { content: diff };
  }

  let newContent = originalContent;
  let lastProcessedIndex = 0;
  const outOfOrderMatches: Array<{
    index: number;
    search: string;
    replace: string;
  }> = [];

  for (const block of blocks) {
    // Handle empty SEARCH block
    if (block.search.trim() === "") {
      if (originalContent.length === 0) {
        // Pure insertion - replace entire content
        newContent = block.replace;
        lastProcessedIndex = newContent.length;
        continue;
      } else {
        // Empty SEARCH with non-empty file = replace entire file
        newContent = block.replace;
        lastProcessedIndex = newContent.length;
        continue;
      }
    }

    // Find the search content
    const match = findSearchContent(
      newContent,
      block.search,
      lastProcessedIndex,
    );

    if (!match) {
      // Try to find match before lastProcessedIndex (out of order)
      const earlierMatch = findSearchContent(newContent, block.search, 0);
      if (earlierMatch && earlierMatch.index < lastProcessedIndex) {
        outOfOrderMatches.push({
          index: earlierMatch.index,
          search: block.search,
          replace: block.replace,
        });
        continue;
      }

      // No match found - return error with context
      return {
        content: originalContent,
        error: `The SEARCH block:\n${block.search}\n...does not match anything in the file.`,
      };
    }

    // Perform replacement
    const beforeMatch = newContent.slice(0, match.index);
    const afterMatch = newContent.slice(
      match.index + match.matchedContent.length,
    );
    newContent = beforeMatch + block.replace + afterMatch;

    // Update last processed index
    lastProcessedIndex = match.index + block.replace.length;
  }

  // Handle out-of-order matches (apply them, but warn)
  if (outOfOrderMatches.length > 0) {
    // Sort by index (ascending) and apply
    outOfOrderMatches.sort((a, b) => a.index - b.index);

    // Apply in reverse order to maintain indices
    for (let i = outOfOrderMatches.length - 1; i >= 0; i--) {
      const match = outOfOrderMatches[i];
      const matchResult = findSearchContent(newContent, match.search, 0);
      if (matchResult) {
        const beforeMatch = newContent.slice(0, matchResult.index);
        const afterMatch = newContent.slice(
          matchResult.index + matchResult.matchedContent.length,
        );
        newContent = beforeMatch + match.replace + afterMatch;
      }
    }
  }

  return { content: newContent };
}

/**
 * Factory function to create editFileContentTool
 * Edits files using SEARCH/REPLACE blocks for token-efficient edits
 * Changes are written directly and registered with PendingEditService
 * User can accept/reject via CodeLens in the editor
 *
 * @param onStreamingOutput Optional streaming callback
 */
export const createEditFileContentTool = (
  onStreamingOutput?: StreamingFileOutputCallback,
) =>
  tool({
    description:
      "Edit an existing file using SEARCH/REPLACE blocks. Provide enough context in SEARCH blocks to uniquely identify the location. Multiple edits can be batched. Changes are written immediately and user can accept/reject via CodeLens in the editor.",
    inputSchema: z.object({
      targetPath: z
        .string()
        .describe(
          "The target file path. Can be relative to workspace root or absolute.",
        ),
      diff: z
        .string()
        .describe(
          "Multi-block SEARCH/REPLACE format for file edits:\n" +
            "------- SEARCH\n[content to find]\n=======\n[replacement content]\n+++++++ REPLACE\n\n" +
            "Multiple blocks can be included for multiple changes. Use enough context in SEARCH blocks to uniquely identify locations.",
        ),
    }),
    execute: async (
      { targetPath, diff }: EditFileContentInput,
      _options?: { toolCallId?: string },
    ): Promise<EditFileContentOutput> => {
      return Runtime.runPromise(Runtime.defaultRuntime)(
        pipe(
          Effect.gen(function* () {
            const vsCodeService = yield* VSCodeService;
            const workspaceRoot = yield* vsCodeService.getWorkspaceRoot();

            // Resolve path relative to workspace root if not absolute
            const fileUri = path.isAbsolute(targetPath)
              ? vsCodeService.fileUri(targetPath)
              : vsCodeService.joinPath(workspaceRoot, targetPath);

            const relativePath = vsCodeService.asRelativePath(fileUri, false);

            // Check if file exists
            const fileExists = yield* vsCodeService.stat(fileUri).pipe(
              Effect.map(() => true),
              Effect.catchAll(() => Effect.succeed(false)),
            );

            if (!fileExists) {
              return {
                success: false,
                filePath: relativePath,
                message: `File does not exist: ${relativePath}. Use writeTestFile to create new files.`,
              };
            }

            // Read existing file content
            const document = yield* vsCodeService.openTextDocument(fileUri);
            const originalContent = document.getText();

            // Apply multi-block SEARCH/REPLACE diff
            const result = constructNewFileContent(originalContent, diff);
            if (result.error) {
              return {
                success: false,
                filePath: relativePath,
                message: `${result.error}\n\nCurrent file content:\n${originalContent}`,
              };
            }

            // Process model-specific content fixes
            const newContent = processModelContent(
              result.content,
              fileUri.fsPath,
            );

            // Generate unique block ID for this replace operation
            const blockId = `edit-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

            // For replace operations, the entire file is treated as one block
            const originalLines = originalContent.split("\n");
            const newLines = newContent.split("\n");

            // Register block BEFORE writing (store original for revert)
            registerBlockSync(
              fileUri.fsPath,
              blockId,
              1, // Start from first line
              newLines.length, // End at last line
              originalLines,
              newLines.length,
              originalContent, // base content
              false, // not a new file
            );

            // Write the file directly
            const content = Buffer.from(newContent, "utf-8");
            yield* vsCodeService.writeFile(fileUri, content);

            // Open the file in the editor to show changes
            const updatedDocument =
              yield* vsCodeService.openTextDocument(fileUri);
            const editor = yield* vsCodeService.showTextDocument(
              updatedDocument,
              {
                preview: false,
                preserveFocus: false,
              },
            );

            // Get the actual content after opening (may be auto-formatted)
            const actualContent = updatedDocument.getText();

            // Apply diff decorations to show changes (uses Myers diff internally)
            try {
              applyDiffDecorationsSync(
                editor,
                originalContent,
                actualContent,
                false, // not a new file
              );
            } catch (error) {
              // Log error but don't fail the operation
              console.error("Failed to apply diff decorations:", error);
            }

            // Emit streaming callback
            if (onStreamingOutput) {
              const callbackPath = path.isAbsolute(targetPath)
                ? relativePath
                : targetPath;
              onStreamingOutput({
                filePath: callbackPath,
                content: actualContent,
                isComplete: true,
              });
            }

            const blockCount = parseSearchReplaceBlocks(diff).length;
            const blockSummary =
              blockCount === 1 ? "1 edit block" : `${blockCount} edit blocks`;

            return {
              success: true,
              filePath: relativePath,
              message: `Applied ${blockSummary} to ${relativePath}. Changes are pending user review. User can accept or reject via CodeLens in the editor.`,
            };
          }),
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const vsCodeService = yield* VSCodeService;
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";

              // Try to read original content for error message
              const fileUri = path.isAbsolute(targetPath)
                ? vsCodeService.fileUri(targetPath)
                : vsCodeService.joinPath(
                    yield* vsCodeService.getWorkspaceRoot(),
                    targetPath,
                  );
              const relativePath = vsCodeService.asRelativePath(fileUri, false);

              const originalContent = yield* vsCodeService
                .openTextDocument(fileUri)
                .pipe(
                  Effect.map((doc) => doc.getText()),
                  Effect.catchAll(() => Effect.succeed(undefined)),
                );

              const errorResponse = formatFileEditError(
                relativePath,
                errorMessage,
                originalContent,
              );

              return {
                success: false,
                filePath: relativePath,
                message: errorResponse,
              };
            }),
          ),
          Effect.provide(VSCodeService.Default),
        ),
      );
    },
  });

/**
 * Default editFileContentTool instance
 */
export const editFileContentTool = createEditFileContentTool(undefined);
