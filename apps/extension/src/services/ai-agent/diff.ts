/**
 * SEARCH/REPLACE diff parsing and matching utilities
 * Supports multi-block SEARCH/REPLACE format similar to Cline
 */

export interface SearchReplaceBlock {
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
export function parseSearchReplaceBlocks(
  diff: string,
): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];

  // Try modern format first (------- SEARCH / ======= / +++++++ REPLACE)
  const modernPattern =
    /(-{7,}\s*SEARCH\s*\n)([\s\S]*?)(={7,}\s*\n)([\s\S]*?)(\+{7,}\s*REPLACE\s*\n)/g;
  
  // Reset regex lastIndex
  modernPattern.lastIndex = 0;

  let match: RegExpExecArray | null = modernPattern.exec(diff);
  while (match !== null) {
    const searchContent = match[2];
    const replaceContent = match[4];

    blocks.push({
      search: searchContent,
      replace: replaceContent,
    });
    match = modernPattern.exec(diff);
  }

  // If no modern format blocks found, try legacy format
  if (blocks.length === 0) {
    const legacyPattern = /(?:<{1,3}\s*SEARCH\s*\n)([\s\S]*?)(?:>{3}\s*REPLACE\s*\n)([\s\S]*?)(?=(?:<{1,3}\s*SEARCH|$))/g;
    legacyPattern.lastIndex = 0;

    match = legacyPattern.exec(diff);
    while (match !== null) {
      const searchContent = match[1];
      const replaceContent = match[2];

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
 * Three-tier matching strategy for finding SEARCH content in original file
 * 1. Exact match (character-for-character)
 * 2. Line-trimmed fallback (ignores leading/trailing whitespace per line)
 * 3. Block anchor match (uses first and last lines as anchors for 3+ line blocks)
 */
export function findSearchContent(
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

    for (let searchLineIdx = 0; searchLineIdx < searchLines.length; searchLineIdx++) {
      const searchLine = searchLines[searchLineIdx]?.trimEnd() ?? "";
      const origLine = originalLines[origLineIdx + searchLineIdx]?.trimEnd() ?? "";

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
 * Construct new file content by applying SEARCH/REPLACE blocks
 * Processes blocks sequentially and tracks position to ensure order
 */
export function constructNewFileContent(
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
    const match = findSearchContent(newContent, block.search, lastProcessedIndex);

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
    const afterMatch = newContent.slice(match.index + match.matchedContent.length);
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

