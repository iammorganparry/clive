/**
 * Type definitions for Clive TUI
 * Ported from apps/tui-go/internal/model/
 */

export interface Session {
  id: string;
  name: string;
  epicID: string;
  description?: string;
  createdAt: Date;
}

export interface Task {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  sessionID: string;
  createdAt: Date;
}

export interface OutputLine {
  text: string;
  type: 'stdout' | 'stderr' | 'tool_call' | 'tool_result' | 'assistant' |
        'system' | 'question' | 'exit' | 'debug' | 'file_diff' |
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
