/**
 * Type definitions for Clive Slack integration
 *
 * Reuses types from TUI where applicable.
 */

import type { CliExecutionHandle } from "@clive/claude-services";

/**
 * Session mode for different workflow phases
 */
export type SessionMode = "plan" | "build" | "review";

/**
 * Question data from AskUserQuestion tool
 */
export interface QuestionData {
  toolUseID: string;
  questions: Question[];
}

/**
 * Single question with options
 */
export interface Question {
  header: string;
  question: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

/**
 * Question option
 */
export interface QuestionOption {
  label: string;
  description: string;
}

/**
 * Interview phase
 */
export type InterviewPhase =
  | "starting"
  | "problem"
  | "scope"
  | "technical"
  | "confirmation"
  | "researching"
  | "generating"
  | "reviewing"
  | "creating_issues"
  | "completed"
  | "timed_out"
  | "error";

/**
 * Interview session state
 */
export interface InterviewSession {
  /** Slack thread timestamp (unique identifier) */
  threadTs: string;
  /** Channel where interview is happening */
  channel: string;
  /** User who initiated the interview (only they can answer) */
  initiatorId: string;
  /** Current interview phase */
  phase: InterviewPhase;
  /** Session mode: plan, build, or review */
  mode: SessionMode;
  /** Initial description provided with @mention */
  initialDescription?: string;
  /** Currently pending question data */
  pendingQuestion?: QuestionData;
  /** Current tool_use_id awaiting response */
  pendingToolUseId?: string;
  /** Collected answers by header */
  answers: Record<string, string>;
  /** Claude CLI execution handle (legacy - local mode only) */
  claudeHandle?: CliExecutionHandle;
  /** Worker ID handling this session (distributed mode) */
  workerId?: string;
  /** Session creation timestamp */
  createdAt: Date;
  /** Last activity timestamp */
  lastActivityAt: Date;
  /** Timeout timer ID */
  timeoutTimer?: ReturnType<typeof setTimeout>;
  /** Generated plan content (if any) */
  planContent?: string;
  /** Created Linear issue URLs */
  linearIssueUrls?: string[];
  /** PR created during build */
  prUrl?: string;
  /** Error message if any */
  errorMessage?: string;
}

/**
 * Answer format for Claude tool result
 */
export interface AnswerPayload {
  [header: string]: string;
}

/**
 * Event types emitted during interview
 */
export type InterviewEvent =
  | { type: "question"; data: QuestionData }
  | { type: "phase_change"; phase: InterviewPhase }
  | { type: "text"; content: string }
  | { type: "plan_ready"; content: string }
  | { type: "issues_created"; urls: string[] }
  | { type: "pr_created"; url: string }
  | { type: "error"; message: string }
  | { type: "timeout" }
  | { type: "complete" };
