/**
 * Type definitions for Clive TUI
 * Ported from apps/tui-go/internal/model/
 */

import type { BeadsIssue, LinearIssue } from "@clive/claude-services";

// Re-export service types
export type { BeadsIssue, LinearIssue } from "@clive/claude-services";

/**
 * Unified task representation that can come from either Beads or Linear
 */
export type Task = BeadsIssue | LinearIssue;

/**
 * Session represents a working context (Linear epic or Beads epic)
 */
export interface Session {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  source: "beads" | "linear";
  // Source-specific data
  beadsData?: BeadsIssue;
  linearData?: LinearIssue;
}

export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiffData {
  filePath: string;
  fileName: string;
  operation: "create" | "edit";
  hunks: DiffHunk[];
  stats: { additions: number; deletions: number; totalLines?: number };
  newFilePreview?: string[];
  previewTruncated?: boolean;
}

export interface OutputLine {
  text: string;
  type:
    | "stdout"
    | "stderr"
    | "error"
    | "tool_call"
    | "tool_result"
    | "assistant"
    | "system"
    | "user"
    | "question"
    | "exit"
    | "debug"
    | "file_diff"
    | "subagent_spawn"
    | "subagent_complete";
  toolName?: string;
  toolUseID?: string;
  toolInput?: any; // Tool input parameters
  refreshTasks?: boolean;
  exitCode?: number;
  closeStdin?: boolean;
  question?: QuestionData;
  debugInfo?: string;
  diffData?: FileDiffData;

  // Metadata
  duration?: number; // milliseconds
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  costUSD?: number;
  startTime?: Date;
}

export interface QuestionData {
  toolUseID: string;
  questions: Question[];
}

export interface Question {
  header: string;
  question: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface QuestionOption {
  label: string;
  description: string;
}

export interface LinearConfig {
  apiKey: string;
  teamID: string;
}

export interface WorkerConfig {
  enabled: boolean;
  centralUrl: string;
  token: string;
  autoConnect?: boolean;
}

export interface Config {
  issueTracker?: "linear" | "beads" | null;
  linear?: LinearConfig;
  beads?: Record<string, unknown>;
  worker?: WorkerConfig;
}

/**
 * Focus zone for keyboard navigation between sidebar, tabs, and main content.
 */
export type FocusZone = "sidebar" | "tabs" | "main";

/**
 * A single chat session within a worktree.
 * Each chat has its own CliManager, output history, mode, and question state.
 */
export interface ChatContext {
  id: string;
  worktreePath: string;
  sessionId?: string;
  mode: "none" | "plan" | "build" | "review";
  label: string;
  outputLines: OutputLine[];
  pendingQuestion: QuestionData | null;
  questionQueue: QuestionData[];
  isRunning: boolean;
  createdAt: Date;
}

/**
 * A worktree with its associated chats and epic context.
 */
export interface WorktreeContext {
  path: string;
  branch: string;
  isMain: boolean;
  epicId?: string;
  epicIdentifier?: string;
  chats: ChatContext[];
  activeChatId: string | null;
}
