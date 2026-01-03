/**
 * CLI Execution Loop
 * Core agentic loop for Claude CLI bi-directional communication
 *
 * This module handles:
 * 1. Reading events from CLI stdout stream
 * 2. Executing tools when tool_use events arrive
 * 3. Sending tool results back to CLI via stdin
 * 4. Emitting progress events for UI display
 */

import { Effect, Stream } from "effect";
import type { CliExecutionHandle, ClaudeCliEvent } from "../claude-cli-service.js";
import type { CliToolExecutor } from "./cli-tool-executor.js";
import type { ProgressCallback } from "./event-handlers.js";
import { logToOutput } from "../../utils/logger.js";

/**
 * Options for running the CLI execution loop
 */
export interface CliExecutionLoopOptions {
  /** Handle for bi-directional CLI communication */
  cliHandle: CliExecutionHandle;
  /** Tool executor for running tools */
  toolExecutor: CliToolExecutor;
  /** Callback for progress updates to UI */
  progressCallback?: ProgressCallback;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Correlation ID for logging */
  correlationId?: string;
}

/**
 * Result of running the CLI execution loop
 */
export interface CliExecutionResult {
  /** Whether the execution completed successfully */
  success: boolean;
  /** Any accumulated text response */
  response: string;
  /** Whether the task was completed */
  taskCompleted: boolean;
  /** Any error that occurred */
  error?: string;
}

/**
 * Run the CLI execution loop
 *
 * This is the core agentic loop that:
 * 1. Reads events from CLI stdout
 * 2. Executes tools and sends results back via stdin
 * 3. Emits progress events for UI
 */
export const runCliExecutionLoop = (
  options: CliExecutionLoopOptions,
): Effect.Effect<CliExecutionResult, Error> =>
  Effect.gen(function* () {
    const { cliHandle, toolExecutor, progressCallback, signal, correlationId } =
      options;

    let accumulatedResponse = "";
    let taskCompleted = false;

    logToOutput(`[CliExecutionLoop:${correlationId}] Starting CLI execution loop`);

    // Handle abort signal
    if (signal) {
      signal.addEventListener("abort", () => {
        logToOutput(`[CliExecutionLoop:${correlationId}] Abort signal received`);
        cliHandle.kill();
      });
    }

    // Process the CLI event stream
    yield* cliHandle.stream.pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          // Check for abort
          if (signal?.aborted) {
            logToOutput(`[CliExecutionLoop:${correlationId}] Aborted, stopping loop`);
            cliHandle.kill();
            return;
          }

          yield* handleCliEvent(
            event,
            cliHandle,
            toolExecutor,
            progressCallback,
            correlationId,
            {
              addToResponse: (text: string) => {
                accumulatedResponse += text;
              },
              setTaskCompleted: () => {
                taskCompleted = true;
              },
            },
          );
        }),
      ),
    );

    logToOutput(
      `[CliExecutionLoop:${correlationId}] Loop completed, response length: ${accumulatedResponse.length}`,
    );

    return {
      success: true,
      response: accumulatedResponse,
      taskCompleted,
    };
  }).pipe(
    Effect.catchAll((error) => {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logToOutput(`[CliExecutionLoop] Error: ${errorMsg}`);

      return Effect.succeed({
        success: false,
        response: "",
        taskCompleted: false,
        error: errorMsg,
      });
    }),
  );

/**
 * Handle a single CLI event
 */
const handleCliEvent = (
  event: ClaudeCliEvent,
  cliHandle: CliExecutionHandle,
  toolExecutor: CliToolExecutor,
  progressCallback: ProgressCallback | undefined,
  correlationId: string | undefined,
  state: {
    addToResponse: (text: string) => void;
    setTaskCompleted: () => void;
  },
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    logToOutput(`[CliExecutionLoop:${correlationId}] Event: ${event.type}`);

    switch (event.type) {
      case "text": {
        // Emit text delta for UI
        progressCallback?.(
          "content_streamed",
          JSON.stringify({
            type: "content_streamed",
            content: event.content,
          }),
        );
        state.addToResponse(event.content);
        break;
      }

      case "thinking": {
        // Emit as reasoning for UI (UI expects "reasoning" type)
        progressCallback?.(
          "reasoning",
          JSON.stringify({
            type: "reasoning",
            content: event.content,
          }),
        );
        break;
      }

      case "tool_use": {
        logToOutput(
          `[CliExecutionLoop:${correlationId}] Tool use: ${event.name} (${event.id})`,
        );

        // Emit tool-call event for UI (input available)
        progressCallback?.(
          "tool-call",
          JSON.stringify({
            type: "tool-call",
            toolCallId: event.id,
            toolName: event.name,
            args: event.input,
            state: "input-available",
          }),
        );

        // Execute the tool
        const result = yield* toolExecutor.executeToolCall(
          event.name,
          event.input,
          event.id,
        );

        // Emit tool-result event for UI
        const resultState = result.success ? "output-available" : "output-error";

        // Parse the result to send as structured object to UI
        // Tool executors return JSON strings, but UI expects objects
        let outputObject: unknown;
        if (result.success) {
          try {
            outputObject = JSON.parse(result.result);
          } catch {
            // If not valid JSON, keep as string
            outputObject = result.result;
          }
        } else {
          outputObject = { error: result.error };
        }

        progressCallback?.(
          "tool-result",
          JSON.stringify({
            type: "tool-result",
            toolCallId: event.id,
            toolName: event.name,
            output: outputObject,
            state: resultState,
          }),
        );

        // Send result back to CLI (as string)
        const resultToSend = result.success
          ? result.result
          : JSON.stringify({ error: result.error });

        logToOutput(
          `[CliExecutionLoop:${correlationId}] Sending tool result back to CLI`,
        );
        cliHandle.sendToolResult(event.id, resultToSend);
        break;
      }

      case "tool_result": {
        // This shouldn't happen in our flow since we execute tools locally
        // but handle it for completeness
        logToOutput(
          `[CliExecutionLoop:${correlationId}] Unexpected tool_result from CLI: ${event.id}`,
        );
        break;
      }

      case "error": {
        logToOutput(
          `[CliExecutionLoop:${correlationId}] CLI error: ${event.message}`,
        );
        progressCallback?.(
          "error",
          JSON.stringify({
            type: "error",
            message: event.message,
          }),
        );
        break;
      }

      case "done": {
        logToOutput(`[CliExecutionLoop:${correlationId}] CLI done`);
        state.setTaskCompleted();
        break;
      }
    }
  });
