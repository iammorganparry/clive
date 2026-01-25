/**
 * Worker Protocol Types
 *
 * Shared type definitions for communication between:
 * - Central Slack Service (deployed)
 * - Worker Clients (user terminals)
 */

/**
 * Worker status
 */
export type WorkerStatus = "connecting" | "ready" | "busy" | "disconnected";

/**
 * Session mode for different workflow phases
 */
export type SessionMode = "plan" | "build" | "review";

/**
 * Project/workspace that a worker has access to
 */
export interface WorkerProject {
  /** Project identifier (e.g., "marketing-app", "api-service") */
  id: string;
  /** Human-readable project name */
  name: string;
  /** Absolute path to project root on worker's machine */
  path: string;
  /** Optional aliases for matching (e.g., ["marketing", "mktg"]) */
  aliases?: string[];
  /** Optional description */
  description?: string;
}

/**
 * Worker registration request sent when worker connects
 */
export interface WorkerRegistration {
  /** Unique worker identifier (generated client-side) */
  workerId: string;
  /** API token for authentication */
  apiToken: string;
  /** Projects this worker has access to */
  projects: WorkerProject[];
  /** Default project if none specified in request */
  defaultProject?: string;
  /** Worker hostname for debugging */
  hostname?: string;
  /** Worker capabilities/tags */
  capabilities?: string[];
}

/**
 * Worker registration response from central service
 */
export interface WorkerRegistrationResponse {
  /** Success flag */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Assigned worker ID (may differ from requested) */
  workerId: string;
  /** WebSocket URL for event streaming */
  websocketUrl: string;
  /** ngrok configuration for tunnel creation */
  ngrokConfig?: NgrokConfig;
}

/**
 * ngrok configuration for worker tunnel
 */
export interface NgrokConfig {
  /** ngrok auth token */
  authtoken: string;
  /** Optional reserved domain */
  domain?: string;
  /** Optional region */
  region?: string;
}

/**
 * Worker heartbeat message
 */
export interface WorkerHeartbeat {
  /** Worker ID */
  workerId: string;
  /** Current status */
  status: WorkerStatus;
  /** Active session IDs */
  activeSessions: string[];
  /** System stats */
  stats?: {
    cpuUsage: number;
    memoryUsage: number;
    uptime: number;
  };
}

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
 * Interview request from central service to worker
 */
export interface InterviewRequest {
  /** Unique session identifier (matches Slack thread_ts) */
  sessionId: string;
  /** Slack thread timestamp */
  threadTs: string;
  /** Slack channel ID */
  channel: string;
  /** User who initiated the interview */
  initiatorId: string;
  /** Initial prompt/description from @mention */
  initialPrompt: string;
  /** Optional model override */
  model?: string;
  /** Target project ID for routing to appropriate worker */
  projectId?: string;
  /** Session mode: plan, build, or review (defaults to 'plan') */
  mode?: SessionMode;
  /** Linear issue URLs for context in build/review modes */
  linearIssueUrls?: string[];
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
 * Event types emitted by worker during interview
 */
export type InterviewEventType =
  | "question"
  | "phase_change"
  | "text"
  | "plan_ready"
  | "issues_created"
  | "pr_created"
  | "error"
  | "timeout"
  | "complete";

/**
 * Interview event from worker to central service
 */
export interface InterviewEvent {
  /** Session identifier */
  sessionId: string;
  /** Event type */
  type: InterviewEventType;
  /** Event payload */
  payload: InterviewEventPayload;
  /** Timestamp */
  timestamp: string;
}

/**
 * Interview event payloads by type
 */
export type InterviewEventPayload =
  | { type: "question"; data: QuestionData }
  | { type: "phase_change"; phase: InterviewPhase }
  | { type: "text"; content: string }
  | { type: "plan_ready"; content: string }
  | { type: "issues_created"; urls: string[] }
  | { type: "pr_created"; url: string }
  | { type: "error"; message: string }
  | { type: "timeout" }
  | { type: "complete" };

/**
 * Answer from central service to worker
 */
export interface AnswerRequest {
  /** Session identifier */
  sessionId: string;
  /** Tool use ID to respond to */
  toolUseId: string;
  /** Answers keyed by question header */
  answers: Record<string, string>;
}

/**
 * Message to send to worker session
 */
export interface MessageRequest {
  /** Session identifier */
  sessionId: string;
  /** Message content */
  message: string;
}

/**
 * Session cancellation request
 */
export interface CancelRequest {
  /** Session identifier */
  sessionId: string;
  /** Reason for cancellation */
  reason?: string;
}

// ============================================================
// WebSocket Message Types
// ============================================================

/**
 * WebSocket message from central service to worker
 */
export type CentralToWorkerMessage =
  | { type: "start_interview"; payload: InterviewRequest }
  | { type: "answer"; payload: AnswerRequest }
  | { type: "message"; payload: MessageRequest }
  | { type: "cancel"; payload: CancelRequest }
  | { type: "ping" }
  | { type: "config_update"; payload: { ngrokConfig?: NgrokConfig } };

/**
 * WebSocket message from worker to central service
 */
export type WorkerToCentralMessage =
  | { type: "register"; payload: WorkerRegistration }
  | { type: "heartbeat"; payload: WorkerHeartbeat }
  | { type: "event"; payload: InterviewEvent }
  | { type: "pong" }
  | { type: "error"; payload: { message: string; sessionId?: string } };

// ============================================================
// HTTP API Types
// ============================================================

/**
 * POST /api/workers/register request body
 */
export interface RegisterWorkerRequest {
  apiToken: string;
  workspaceRoot: string;
  hostname?: string;
  capabilities?: string[];
}

/**
 * POST /api/workers/register response body
 */
export interface RegisterWorkerResponse {
  success: boolean;
  workerId?: string;
  websocketUrl?: string;
  ngrokConfig?: NgrokConfig;
  error?: string;
}

/**
 * GET /api/workers response body
 */
export interface ListWorkersResponse {
  workers: WorkerInfo[];
}

/**
 * Worker info for listing
 */
export interface WorkerInfo {
  workerId: string;
  status: WorkerStatus;
  hostname?: string;
  activeSessions: number;
  lastHeartbeat: string;
  connectedAt: string;
}

/**
 * GET /api/sessions/:sessionId response body
 */
export interface SessionInfo {
  sessionId: string;
  workerId: string;
  channel: string;
  initiatorId: string;
  phase: InterviewPhase;
  createdAt: string;
  lastActivityAt: string;
}
