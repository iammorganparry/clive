/**
 * Type definitions for Clive TUI
 * Ported from apps/tui-go/internal/model/
 */

import type { BeadsIssue, LinearIssue } from '@clive/claude-services';

// Re-export service types
export type { BeadsIssue, LinearIssue } from '@clive/claude-services';

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
  source: 'beads' | 'linear';
  // Source-specific data
  beadsData?: BeadsIssue;
  linearData?: LinearIssue;
}

export interface OutputLine {
  text: string;
  type: 'stdout' | 'stderr' | 'tool_call' | 'tool_result' | 'assistant' |
        'system' | 'user' | 'question' | 'exit' | 'debug' | 'file_diff' |
        'subagent_spawn' | 'subagent_complete';
  toolName?: string;
  toolUseID?: string;
  refreshTasks?: boolean;
  exitCode?: number;
  closeStdin?: boolean;
  question?: QuestionData;
  debugInfo?: string;

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

export interface Config {
  issueTracker?: 'linear' | 'github';
  linear?: {
    apiKey: string;
    teamID: string;
  };
}
