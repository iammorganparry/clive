/**
 * Stream Event Emitter
 * Helper functions for emitting stream events consistently across providers
 */

import type { ProgressCallback } from "./event-handlers.js";
import type {
  AgentStreamEvent,
  LoopCompleteEvent,
  LoopProgressSummary,
  TodoDisplayItem,
  ToolCallState,
} from "./stream-events.js";

/**
 * Emit a stream event via the progress callback
 */
export function emitStreamEvent(
  callback: ProgressCallback | undefined,
  event: AgentStreamEvent,
): void {
  if (!callback) return;
  callback(event.type, JSON.stringify(event));
}

/**
 * Convenience functions for emitting common events
 * Provides type-safe event emission with consistent structure
 */
export const emit = {
  /**
   * Emit text content streaming event
   */
  contentStreamed: (
    callback: ProgressCallback | undefined,
    content: string,
  ): void => {
    emitStreamEvent(callback, {
      type: "content_streamed",
      content,
    });
  },

  /**
   * Emit reasoning/thinking event
   */
  reasoning: (
    callback: ProgressCallback | undefined,
    content: string,
  ): void => {
    emitStreamEvent(callback, {
      type: "reasoning",
      content,
    });
  },

  /**
   * Emit tool call event
   */
  toolCall: (
    callback: ProgressCallback | undefined,
    toolCallId: string,
    toolName: string,
    args: unknown,
    state: ToolCallState,
    isMcpTool?: boolean,
  ): void => {
    emitStreamEvent(callback, {
      type: "tool-call",
      toolCallId,
      toolName,
      args,
      state,
      isMcpTool,
    });
  },

  /**
   * Emit tool result event
   */
  toolResult: (
    callback: ProgressCallback | undefined,
    toolCallId: string,
    toolName: string,
    output: unknown,
    state:
      | "output-available"
      | "output-error"
      | "output-cancelled"
      | "output-denied",
  ): void => {
    emitStreamEvent(callback, {
      type: "tool-result",
      toolCallId,
      toolName,
      output,
      state,
    });
  },

  /**
   * Emit plan content streaming event
   */
  planContent: (
    callback: ProgressCallback | undefined,
    toolCallId: string,
    content: string,
    isComplete: boolean,
    filePath?: string,
  ): void => {
    emitStreamEvent(callback, {
      type: "plan-content-streaming",
      toolCallId,
      content,
      isComplete,
      filePath,
    });
  },

  /**
   * Emit native plan mode entered event
   * Called when Claude Code's EnterPlanMode tool is detected
   */
  nativePlanModeEntered: (
    callback: ProgressCallback | undefined,
    toolCallId: string,
  ): void => {
    emitStreamEvent(callback, {
      type: "native-plan-mode-entered",
      toolCallId,
    });
  },

  /**
   * Emit native plan mode exiting event
   * Called when Claude Code's ExitPlanMode tool is detected
   */
  nativePlanModeExiting: (
    callback: ProgressCallback | undefined,
    toolCallId: string,
    planFilePath?: string,
  ): void => {
    emitStreamEvent(callback, {
      type: "native-plan-mode-exiting",
      toolCallId,
      planFilePath,
    });
  },

  /**
   * Emit file created event
   */
  fileCreated: (
    callback: ProgressCallback | undefined,
    toolCallId: string,
    filePath: string,
  ): void => {
    emitStreamEvent(callback, {
      type: "file-created",
      toolCallId,
      filePath,
    });
  },

  /**
   * Emit error event
   */
  error: (callback: ProgressCallback | undefined, message: string): void => {
    emitStreamEvent(callback, {
      type: "error",
      message,
    });
  },

  /**
   * Emit tool skipped event
   */
  toolSkipped: (
    callback: ProgressCallback | undefined,
    toolCallId: string,
    toolName: string | undefined,
    reason: string,
  ): void => {
    emitStreamEvent(callback, {
      type: "tool-skipped",
      toolCallId,
      toolName,
      reason,
    });
  },

  /**
   * Emit diagnostic problems event
   */
  diagnosticProblems: (
    callback: ProgressCallback | undefined,
    toolCallId?: string,
    toolName?: string,
  ): void => {
    emitStreamEvent(callback, {
      type: "diagnostic-problems",
      toolCallId,
      toolName,
    });
  },

  /**
   * Emit mistake limit event
   */
  mistakeLimit: (
    callback: ProgressCallback | undefined,
    count: number,
    message: string,
  ): void => {
    emitStreamEvent(callback, {
      type: "mistake-limit",
      count,
      message,
    });
  },

  /**
   * Emit loop iteration start event - Ralph Wiggum loop
   */
  loopIterationStart: (
    callback: ProgressCallback | undefined,
    iteration: number,
    maxIterations: number,
  ): void => {
    emitStreamEvent(callback, {
      type: "loop-iteration-start",
      iteration,
      maxIterations,
    });
  },

  /**
   * Emit loop iteration complete event - Ralph Wiggum loop
   */
  loopIterationComplete: (
    callback: ProgressCallback | undefined,
    iteration: number,
    todos: TodoDisplayItem[],
    progress: LoopProgressSummary,
  ): void => {
    emitStreamEvent(callback, {
      type: "loop-iteration-complete",
      iteration,
      todos,
      progress,
    });
  },

  /**
   * Emit loop complete event - Ralph Wiggum loop
   */
  loopComplete: (
    callback: ProgressCallback | undefined,
    reason: LoopCompleteEvent["reason"],
    iteration: number,
    todos: TodoDisplayItem[],
    progress: LoopProgressSummary,
  ): void => {
    emitStreamEvent(callback, {
      type: "loop-complete",
      reason,
      iteration,
      todos,
      progress,
    });
  },

  /**
   * Emit todos updated event - Ralph Wiggum loop
   */
  todosUpdated: (
    callback: ProgressCallback | undefined,
    todos: TodoDisplayItem[],
    progress: LoopProgressSummary,
  ): void => {
    emitStreamEvent(callback, {
      type: "todos-updated",
      todos,
      progress,
    });
  },
};
