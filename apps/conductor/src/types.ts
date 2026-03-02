/**
 * Types for the OpenClaw Conductor
 *
 * Shared type definitions used across all conductor modules.
 */

/** Task lifecycle states */
export type TaskState =
  | "pending"
  | "planning"
  | "spawning"
  | "building"
  | "pr_open"
  | "reviewing"
  | "complete"
  | "failed";

/** Supported agent types */
export type AgentType = "claude" | "codex";

/** Agent execution status */
export type AgentStatus = "running" | "completed" | "failed" | "stuck";

/** CI pipeline status */
export type CiStatus = "pending" | "passing" | "failing";

/** PR review status */
export type ReviewStatus = "pending" | "approved" | "changes_requested";

/** Slack thread reference for status reporting */
export interface SlackThread {
  channel: string;
  threadTs: string;
  initiatorId: string;
}

/** Individual agent assignment within a task */
export interface AgentEntry {
  acpxSessionName: string;
  linearTaskId: string;
  agent: AgentType;
  status: AgentStatus;
  startedAt: string;
  lastActivityAt: string;
}

/** Top-level task tracked by the conductor */
export interface TaskEntry {
  id: string;
  state: TaskState;
  prompt?: string;
  slackThread?: SlackThread;
  linearEpicId?: string;
  linearTaskIds: string[];
  agents: AgentEntry[];
  worktreePath?: string;
  branchName?: string;
  prUrl?: string;
  ciStatus?: CiStatus;
  reviewStatus?: ReviewStatus;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Incoming request to the conductor */
export interface ConductorRequest {
  /** Natural language prompt for full discovery path */
  prompt?: string;
  /** Linear issue URLs for fast path (skip planning) */
  linearIssueUrls?: string[];
  /** Slack thread to report status to */
  slackThread?: SlackThread;
}

/** Result from an acpx CLI command */
export interface AcpxResult {
  output: string;
  exitCode: number;
}

/** Options for spawning an agent via acpx */
export interface AcpxSpawnOptions {
  name: string;
  agent?: AgentType;
  cwd: string;
  task: string;
  mode?: "session" | "run";
  thread?: boolean;
}

/** Completion markers emitted by clive-build */
export const COMPLETION_MARKERS = {
  TASK_COMPLETE: "<promise>TASK_COMPLETE</promise>",
  ALL_TASKS_COMPLETE: "<promise>ALL_TASKS_COMPLETE</promise>",
} as const;

/** Valid state transitions */
export const STATE_TRANSITIONS: Record<TaskState, TaskState[]> = {
  pending: ["planning", "spawning", "failed"],
  planning: ["spawning", "failed"],
  spawning: ["building", "failed"],
  building: ["pr_open", "failed"],
  pr_open: ["reviewing", "failed"],
  reviewing: ["complete", "building", "failed"],
  complete: [],
  failed: [],
};

/** Monitor loop graduated response levels */
export type ResponseLevel = "warn" | "steer" | "respawn" | "fail";

/** Agent health check result */
export interface AgentHealthCheck {
  sessionName: string;
  alive: boolean;
  stuck: boolean;
  lastOutput?: string;
  minutesSinceActivity: number;
}
