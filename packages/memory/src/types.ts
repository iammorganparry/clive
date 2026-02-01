/**
 * @clive/memory - Type definitions
 *
 * Core types for the memory system including chunks, search results, and entries.
 */

/**
 * Source of a memory entry
 */
export type MemorySource = "memory" | "sessions";

/**
 * Category for daily log entries
 */
export type MemoryCategory = "decision" | "pattern" | "gotcha" | "note";

/**
 * A chunk of indexed content with embedding
 */
export interface MemoryChunk {
  /** Unique identifier for the chunk */
  id: string;
  /** Path to the source file (relative to .clive/memory/) */
  filePath: string;
  /** Source type */
  source: MemorySource;
  /** Index of this chunk within the file */
  chunkIndex: number;
  /** Starting line number in the original file */
  startLine: number;
  /** Ending line number in the original file */
  endLine: number;
  /** The actual text content of the chunk */
  content: string;
  /** SHA-256 hash of the content for caching */
  contentHash: string;
  /** Embedding vector (1536 dimensions for text-embedding-3-small) */
  embedding: Float32Array | null;
  /** Model used to generate the embedding */
  model: string | null;
  /** When the chunk was created */
  createdAt: Date;
}

/**
 * Result from a memory search operation
 */
export interface MemorySearchResult {
  /** Path to the source file (relative to .clive/memory/) */
  path: string;
  /** Starting line number for precise retrieval */
  startLine: number;
  /** Ending line number for precise retrieval */
  endLine: number;
  /** Preview snippet of the content (~700 chars max) */
  snippet: string;
  /** Combined relevance score (0-1) */
  score: number;
  /** Source type */
  source: MemorySource;
}

/**
 * Entry to save to the daily log
 */
export interface MemoryEntry {
  /** Category of the entry */
  category: MemoryCategory;
  /** The content to save */
  content: string;
  /** Optional tags for organization */
  tags?: string[];
}

/**
 * Session information for memory extraction
 */
export interface SessionInfo {
  /** Unique session identifier */
  sessionId: string;
  /** Session mode (plan, build, review) */
  mode: string;
  /** Associated Linear task identifier */
  linearIssue?: string;
  /** Session outcome */
  outcome?: "success" | "partial" | "failed" | "cancelled";
}

/**
 * Extracted key information from a session
 */
export interface ExtractedSessionInfo extends SessionInfo {
  /** Key decisions made during the session */
  decisions?: string[];
  /** Patterns discovered */
  patterns?: string[];
  /** Gotchas or workarounds found */
  gotchas?: string[];
  /** General notes */
  notes?: string[];
}

/**
 * File metadata for change detection
 */
export interface FileMetadata {
  /** Path to the file (relative to .clive/memory/) */
  path: string;
  /** Source type */
  source: MemorySource;
  /** SHA-256 hash of the file content */
  hash: string;
  /** Last modified timestamp */
  modifiedAt: Date;
  /** File size in bytes */
  size: number;
}

/**
 * Options for memory search
 */
export interface MemorySearchOptions {
  /** Maximum number of results to return (default: 6) */
  maxResults?: number;
  /** Minimum score threshold (default: 0.35) */
  minScore?: number;
  /** Filter by source type */
  source?: MemorySource;
}

/**
 * Options for reading memory files
 */
export interface MemoryGetOptions {
  /** Path to the file (relative to .clive/memory/) */
  path: string;
  /** Starting line number (default: 1) */
  from?: number;
  /** Number of lines to read (default: all) */
  lines?: number;
}

/**
 * Result from reading a memory file
 */
export interface MemoryGetResult {
  /** The content read from the file */
  content: string;
  /** Total number of lines in the file */
  totalLines: number;
  /** Starting line of the returned content */
  startLine: number;
  /** Ending line of the returned content */
  endLine: number;
}

/**
 * Cached embedding entry
 */
export interface EmbeddingCacheEntry {
  /** SHA-256 hash of the content */
  contentHash: string;
  /** The embedding vector */
  embedding: Float32Array;
  /** Dimension of the embedding */
  dimension: number;
  /** Provider name (e.g., "openai") */
  provider: string;
  /** Model name (e.g., "text-embedding-3-small") */
  model: string;
  /** When the cache entry was last updated */
  updatedAt: Date;
}

/**
 * Internal search result before merging
 */
export interface RawSearchResult {
  chunk: MemoryChunk;
  score: number;
  searchType: "vector" | "bm25";
}
