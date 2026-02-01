/**
 * @clive/memory - Constants and configuration defaults
 *
 * Default configuration values for the memory system.
 */

/**
 * Default memory directory paths (relative to workspace root)
 */
export const MemoryPaths = {
  /** Base memory directory */
  base: ".clive/memory",
  /** Daily log files */
  daily: ".clive/memory/daily",
  /** Long-term curated memory */
  longTerm: ".clive/memory/long-term",
  /** Index files (SQLite database) */
  index: ".clive/memory/index",
  /** Database file name */
  dbFile: "memory.db",
} as const;

/**
 * Default search configuration
 */
export const SearchDefaults = {
  /** Maximum number of results to return */
  maxResults: 6,
  /** Minimum score threshold for results */
  minScore: 0.35,
  /** Weight for vector similarity in hybrid search */
  vectorWeight: 0.7,
  /** Weight for BM25 in hybrid search */
  bm25Weight: 0.3,
} as const;

/**
 * Default indexing configuration
 */
export const IndexingDefaults = {
  /** Target chunk size in tokens */
  chunkSize: 400,
  /** Overlap between chunks in tokens */
  chunkOverlap: 80,
  /** Debounce time for file changes in milliseconds */
  debounceMs: 1500,
  /** Maximum concurrent embedding requests */
  maxConcurrent: 5,
} as const;

/**
 * Default embedding configuration
 */
export const EmbeddingDefaults = {
  /** Default embedding provider */
  provider: "openai",
  /** Default embedding model */
  model: "text-embedding-3-small",
  /** Embedding dimensions */
  dimensions: 1536,
  /** Batch size for embedding requests */
  batchSize: 100,
} as const;

/**
 * Compaction settings
 */
export const CompactionDefaults = {
  /** Whether to flush memory before compaction */
  memoryFlush: true,
  /** Soft threshold for triggering pre-compaction flush (in tokens) */
  softThresholdTokens: 4000,
} as const;

/**
 * Snippet formatting
 */
export const SnippetDefaults = {
  /** Maximum length of snippets in characters */
  maxLength: 700,
} as const;

/**
 * File patterns for watching
 */
export const FilePatterns = {
  /** Glob pattern for memory markdown files */
  memoryFiles: "**/*.md",
} as const;

/**
 * SQLite schema for the memory database
 */
export const SqliteSchema = `
-- Metadata storage
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Indexed files
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  hash TEXT NOT NULL,
  modified_at INTEGER NOT NULL,
  size INTEGER NOT NULL
);

-- Text chunks with embeddings
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  source TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding BLOB,
  model TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(file_path, chunk_index),
  FOREIGN KEY (file_path) REFERENCES files(path) ON DELETE CASCADE
);

-- FTS5 full-text search index
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  content,
  content='chunks',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
  INSERT INTO chunks_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;

-- Embedding cache
CREATE TABLE IF NOT EXISTS embedding_cache (
  content_hash TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  dimension INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_chunks_file_path ON chunks(file_path);
CREATE INDEX IF NOT EXISTS idx_chunks_content_hash ON chunks(content_hash);
CREATE INDEX IF NOT EXISTS idx_files_source ON files(source);
CREATE INDEX IF NOT EXISTS idx_embedding_cache_model ON embedding_cache(model);
` as const;

/**
 * Memory category templates for daily log formatting
 */
export const CategoryTemplates = {
  decision: "### Decision\n\n",
  pattern: "### Pattern\n\n",
  gotcha: "### Gotcha\n\n",
  note: "### Note\n\n",
} as const;
