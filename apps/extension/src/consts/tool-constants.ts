/**
 * Constants for AI agent tools
 * Defines concurrency limits for bounded parallelism
 */

/**
 * Concurrency limits for tool operations
 * These values control back pressure and prevent overwhelming the system
 */
export const TOOL_CONCURRENCY = {
  /** Max parallel file reads (grep search, content reading) */
  FILE_READ: 5,
  /** Max parallel file stats (list files, directory scanning) */
  FILE_STAT: 10,
  /** Max parallel grep search operations per tool call */
  GREP_SEARCH: 5,
} as const;

/**
 * Default limits for search operations
 */
export const SEARCH_LIMITS = {
  /** Default max results for grep search */
  GREP_MAX_RESULTS: 50,
  /** Multiplier for file search to ensure enough candidates */
  FILE_SEARCH_MULTIPLIER: 10,
  /** Max files to list before truncation */
  LIST_FILES_MAX: 100,
} as const;
