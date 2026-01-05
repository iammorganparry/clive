/**
 * Stream Event Types
 * Canonical event type definitions for agent stream processing
 * Used by both API path (AI SDK) and CLI path (Claude Code) for consistent UI behavior
 */

/**
 * Tool call state transitions
 */
export type ToolCallState =
  | "input-streaming"
  | "input-available"
  | "awaiting-approval"
  | "output-available"
  | "output-error"
  | "output-cancelled"
  | "output-denied";

/**
 * Base event interface
 */
export interface BaseStreamEvent {
  type: string;
}

/**
 * Text content streaming event
 */
export interface ContentStreamedEvent extends BaseStreamEvent {
  type: "content_streamed";
  content: string;
}

/**
 * Reasoning/thinking content event
 */
export interface ReasoningEvent extends BaseStreamEvent {
  type: "reasoning";
  content: string;
}

/**
 * Tool call event - emitted when a tool is invoked
 */
export interface ToolCallEvent extends BaseStreamEvent {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args?: unknown;
  state: ToolCallState;
  isMcpTool?: boolean;
}

/**
 * Tool result event - emitted when a tool completes
 */
export interface ToolResultEvent extends BaseStreamEvent {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: unknown;
  state: "output-available" | "output-error" | "output-cancelled" | "output-denied";
}

/**
 * Plan content streaming event - for proposeTestPlan tool
 */
export interface PlanContentStreamingEvent extends BaseStreamEvent {
  type: "plan-content-streaming";
  toolCallId: string;
  content: string;
  isComplete: boolean;
  filePath?: string;
}

/**
 * Native plan mode entered event - emitted when Claude Code's EnterPlanMode tool is called
 */
export interface NativePlanModeEnteredEvent extends BaseStreamEvent {
  type: "native-plan-mode-entered";
  toolCallId: string;
}

/**
 * Native plan mode exiting event - emitted when Claude Code's ExitPlanMode tool is called
 */
export interface NativePlanModeExitingEvent extends BaseStreamEvent {
  type: "native-plan-mode-exiting";
  toolCallId: string;
  planFilePath?: string;
}

/**
 * File created event - for file creation notifications
 */
export interface FileCreatedEvent extends BaseStreamEvent {
  type: "file-created";
  toolCallId: string;
  filePath: string;
}

/**
 * Error event
 */
export interface ErrorEvent extends BaseStreamEvent {
  type: "error";
  message: string;
}

/**
 * Tool skipped event - when tool is skipped due to rejection cascade
 */
export interface ToolSkippedEvent extends BaseStreamEvent {
  type: "tool-skipped";
  toolCallId: string;
  toolName?: string;
  reason: string;
}

/**
 * Diagnostic problems event
 */
export interface DiagnosticProblemsEvent extends BaseStreamEvent {
  type: "diagnostic-problems";
  toolCallId?: string;
  toolName?: string;
}

/**
 * Mistake limit event
 */
export interface MistakeLimitEvent extends BaseStreamEvent {
  type: "mistake-limit";
  count: number;
  message: string;
}

/**
 * Todo display item for UI
 */
export interface TodoDisplayItem {
  content: string;
  status: string;
  activeForm: string;
}

/**
 * Progress summary for loop
 */
export interface LoopProgressSummary {
  completed: number;
  pending: number;
  total: number;
  percentComplete: number;
}

/**
 * Loop iteration start event - Ralph Wiggum loop
 */
export interface LoopIterationStartEvent extends BaseStreamEvent {
  type: "loop-iteration-start";
  iteration: number;
  maxIterations: number;
}

/**
 * Loop iteration complete event - Ralph Wiggum loop
 */
export interface LoopIterationCompleteEvent extends BaseStreamEvent {
  type: "loop-iteration-complete";
  iteration: number;
  todos: TodoDisplayItem[];
  progress: LoopProgressSummary;
}

/**
 * Loop complete event - Ralph Wiggum loop
 */
export interface LoopCompleteEvent extends BaseStreamEvent {
  type: "loop-complete";
  reason: "complete" | "max_iterations" | "max_time" | "error" | "cancelled";
  iteration: number;
  todos: TodoDisplayItem[];
  progress: LoopProgressSummary;
}

/**
 * Todos updated event - Ralph Wiggum loop
 */
export interface TodosUpdatedEvent extends BaseStreamEvent {
  type: "todos-updated";
  todos: TodoDisplayItem[];
  progress: LoopProgressSummary;
}

/**
 * Union of all stream events
 */
export type AgentStreamEvent =
  | ContentStreamedEvent
  | ReasoningEvent
  | ToolCallEvent
  | ToolResultEvent
  | PlanContentStreamingEvent
  | NativePlanModeEnteredEvent
  | NativePlanModeExitingEvent
  | FileCreatedEvent
  | ErrorEvent
  | ToolSkippedEvent
  | DiagnosticProblemsEvent
  | MistakeLimitEvent
  | LoopIterationStartEvent
  | LoopIterationCompleteEvent
  | LoopCompleteEvent
  | TodosUpdatedEvent;
