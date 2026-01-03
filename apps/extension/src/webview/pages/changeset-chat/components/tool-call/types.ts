import type { BundledLanguage } from "shiki";
import type { ToolState } from "../../../../types/chat.js";

/**
 * Props for the main ToolCallCard component
 */
export interface ToolCallCardProps {
  toolName: string;
  state: ToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  streamingContent?: string;
  toolCallId?: string;
  subscriptionId?: string;
  onCancelStream?: () => void;
}

/**
 * Props for BashExecuteTerminal component
 */
export interface BashExecuteTerminalProps {
  input: unknown;
  output: unknown;
  state: ToolState;
  toolCallId?: string;
  subscriptionId?: string;
}

/**
 * Bash execute command arguments
 */
export interface BashExecuteArgs {
  command: string;
}

/**
 * Bash execute output structure
 */
export interface BashExecuteOutput {
  command?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  message?: string;
  error?: string;
}

/**
 * Propose test tool arguments
 */
export interface ProposeTestArgs {
  sourceFile?: string;
  testStrategies?: unknown[];
}

/**
 * Write test file tool arguments
 */
export interface WriteTestFileArgs {
  filePath?: string;
  targetTestPath?: string;
  targetPath?: string;
  testContent?: string;
}

/**
 * Write test file tool output
 */
export interface WriteTestFileOutput {
  success?: boolean;
  filePath?: string;
  path?: string;
  message?: string;
}

/**
 * Search knowledge tool arguments
 */
export interface SearchKnowledgeArgs {
  query?: string;
  category?: string;
}

/**
 * Search knowledge result item
 */
export interface SearchKnowledgeResult {
  title?: string;
  path?: string;
  content?: string;
}

/**
 * Search knowledge tool output
 */
export interface SearchKnowledgeOutput {
  results?: SearchKnowledgeResult[];
  count?: number;
}

/**
 * Write knowledge file tool arguments
 */
export interface WriteKnowledgeFileArgs {
  filePath?: string;
  category?: string;
  topic?: string;
  content?: string;
}

/**
 * Write knowledge file tool output
 */
export interface WriteKnowledgeFileOutput {
  success?: boolean;
  path?: string;
  relativePath?: string;
  error?: string;
}

/**
 * Web search tool arguments
 */
export interface WebSearchArgs {
  query?: string;
}

/**
 * Read file tool arguments
 */
export interface ReadFileArgs {
  filePath?: string;
  targetPath?: string;
}

/**
 * Read file tool output
 */
export interface ReadFileOutput {
  content?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
}

/**
 * Edit file content tool arguments
 */
export interface EditFileContentArgs {
  targetPath?: string;
  filePath?: string;
  diff?: string;
}

/**
 * File match from grep output
 */
export interface FileMatch {
  filePath: string;
  count: number;
}

/**
 * Extracted file info for code preview
 */
export interface ExtractedFileInfo {
  filePath: string;
  content: string;
  language: BundledLanguage;
}

// Type Guards

export const isBashExecuteArgs = (input: unknown): input is BashExecuteArgs =>
  typeof input === "object" &&
  input !== null &&
  "command" in input &&
  typeof (input as BashExecuteArgs).command === "string";

export const isProposeTestArgs = (input: unknown): input is ProposeTestArgs =>
  typeof input === "object" && input !== null && "sourceFile" in input;

export const isWriteTestFileArgs = (input: unknown): input is WriteTestFileArgs =>
  typeof input === "object" && input !== null;

export const isSearchKnowledgeArgs = (input: unknown): input is SearchKnowledgeArgs =>
  typeof input === "object" && input !== null;

export const isWriteKnowledgeFileArgs = (input: unknown): input is WriteKnowledgeFileArgs =>
  typeof input === "object" && input !== null;

export const isWebSearchArgs = (input: unknown): input is WebSearchArgs =>
  typeof input === "object" && input !== null;

export const isReadFileArgs = (input: unknown): input is ReadFileArgs =>
  typeof input === "object" && input !== null;

export const isEditFileContentArgs = (input: unknown): input is EditFileContentArgs =>
  typeof input === "object" && input !== null;
