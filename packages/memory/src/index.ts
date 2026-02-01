/**
 * @clive/memory
 *
 * Persistent memory system for Clive with hybrid semantic search.
 * Provides context continuity across Claude Code sessions.
 *
 * @example
 * ```typescript
 * import { MemoryService, MemoryServiceLive } from '@clive/memory';
 * import { Effect } from 'effect';
 *
 * const program = Effect.gen(function* () {
 *   const memory = yield* MemoryService;
 *
 *   // Initialize the memory system
 *   yield* memory.initialize({
 *     workspaceRoot: '/path/to/workspace',
 *     embedding: { apiKey: process.env.OPENAI_API_KEY },
 *   });
 *
 *   // Search for relevant context
 *   const results = yield* memory.searchMemory('authentication flow');
 *
 *   // Save a decision to today's log
 *   yield* memory.saveToDaily({
 *     category: 'decision',
 *     content: 'Using JWT tokens for auth',
 *     tags: ['auth', 'api'],
 *   });
 * });
 * ```
 */

// Types
export type {
  EmbeddingCacheEntry,
  ExtractedSessionInfo,
  FileMetadata,
  MemoryCategory,
  MemoryChunk,
  MemoryEntry,
  MemoryGetOptions,
  MemoryGetResult,
  MemorySearchOptions,
  MemorySearchResult,
  MemorySource,
  RawSearchResult,
  SessionInfo,
} from "./types.js";

// Constants
export {
  CategoryTemplates,
  CompactionDefaults,
  EmbeddingDefaults,
  FilePatterns,
  IndexingDefaults,
  MemoryPaths,
  SearchDefaults,
  SnippetDefaults,
  SqliteSchema,
} from "./constants.js";

// Services
export {
  MemoryError,
  type MemoryConfig,
  MemoryService,
  MemoryServiceLive,
  createMemoryLayer,
} from "./services/memory-service.js";

export {
  StorageError,
  StorageService,
  StorageServiceLive,
} from "./services/storage-service.js";

export {
  ChunkerError,
  type ChunkerConfig,
  ChunkerService,
  ChunkerServiceLive,
} from "./services/chunker-service.js";

export {
  EmbeddingError,
  type EmbeddingConfig,
  EmbeddingService,
  EmbeddingServiceLive,
} from "./services/embedding-service.js";

export {
  IndexerError,
  type IndexerConfig,
  IndexerService,
  IndexerServiceLive,
} from "./services/indexer-service.js";

export {
  SearchError,
  type SearchConfig,
  SearchService,
  SearchServiceLive,
} from "./services/search-service.js";

// MCP Tools
import {
  type MemoryGetInput as _MemoryGetInput,
  memoryGetToolDefinition as _memoryGetToolDefinition,
  executeMemoryGet as _executeMemoryGet,
  handleMemoryGet as _handleMemoryGet,
} from "./tools/memory-get.js";

import {
  type MemorySaveInput as _MemorySaveInput,
  memorySaveToolDefinition as _memorySaveToolDefinition,
  executeMemorySave as _executeMemorySave,
  handleMemorySave as _handleMemorySave,
} from "./tools/memory-save.js";

import {
  type MemorySearchInput as _MemorySearchInput,
  memorySearchToolDefinition as _memorySearchToolDefinition,
  executeMemorySearch as _executeMemorySearch,
  handleMemorySearch as _handleMemorySearch,
} from "./tools/memory-search.js";

export type MemoryGetInput = _MemoryGetInput;
export const memoryGetToolDefinition = _memoryGetToolDefinition;
export const executeMemoryGet = _executeMemoryGet;
export const handleMemoryGet = _handleMemoryGet;

export type MemorySaveInput = _MemorySaveInput;
export const memorySaveToolDefinition = _memorySaveToolDefinition;
export const executeMemorySave = _executeMemorySave;
export const handleMemorySave = _handleMemorySave;

export type MemorySearchInput = _MemorySearchInput;
export const memorySearchToolDefinition = _memorySearchToolDefinition;
export const executeMemorySearch = _executeMemorySearch;
export const handleMemorySearch = _handleMemorySearch;

// Utilities
export {
  FileError,
  hashContent,
  getTodayDate,
  getDailyLogPath,
  getMemoryFilePath,
  getRelativePath,
  getSourceFromPath,
  ensureDir,
  fileExists,
  readFile,
  writeFile,
  appendFile,
  getFileStats,
  listFiles,
  formatMemoryEntry,
  formatDailyLogHeader,
  readFileLines,
  truncateToLength,
} from "./utils/file-utils.js";

/**
 * All MCP tool definitions for registration
 */
export const memoryTools = [
  _memoryGetToolDefinition,
  _memorySaveToolDefinition,
  _memorySearchToolDefinition,
] as const;
