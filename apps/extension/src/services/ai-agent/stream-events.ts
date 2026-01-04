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
 * Union of all stream events
 */
export type AgentStreamEvent =
  | ContentStreamedEvent
  | ReasoningEvent
  | ToolCallEvent
  | ToolResultEvent
  | PlanContentStreamingEvent
  | FileCreatedEvent
  | ErrorEvent
  | ToolSkippedEvent
  | DiagnosticProblemsEvent
  | MistakeLimitEvent;
