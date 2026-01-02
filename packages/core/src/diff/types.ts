/**
 * Editor-agnostic types for diff tracking
 */

/**
 * Represents a line range in a file (1-based indexing)
 */
export interface LineRange {
  /** 1-based start line number */
  startLine: number;
  /** 1-based end line number (inclusive) */
  endLine: number;
}

/**
 * Represents a single edit block within a file
 */
export interface DiffBlock {
  /** Unique identifier for this block */
  id: string;
  /** File path being edited */
  filePath: string;
  /** Line range where this block is located */
  range: LineRange;
  /** Original lines before the edit */
  originalLines: string[];
  /** Number of lines in the new content */
  newLineCount: number;
  /** Timestamp when block was created */
  timestamp: number;
}

/**
 * Represents all pending edits for a file
 */
export interface PendingFileEdit {
  /** File path */
  filePath: string;
  /** All edit blocks, ordered by startLine */
  blocks: DiffBlock[];
  /** Original content before ANY edits (for full revert) */
  baseContent: string;
  /** Whether this is a new file */
  isNewFile: boolean;
  /** Hash of content after our edits (for external edit detection) */
  lastKnownContentHash: string;
}

/**
 * Status of a diff block
 */
export type DiffBlockStatus = "pending" | "accepted" | "rejected";

/**
 * Event emitted when diff state changes
 */
export interface DiffEvent {
  type:
    | "block-added"
    | "block-accepted"
    | "block-rejected"
    | "external-edit"
    | "all-cleared";
  filePath: string;
  blockId?: string;
}
