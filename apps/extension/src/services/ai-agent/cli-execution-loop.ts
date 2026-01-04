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
import type {
  CliExecutionHandle,
  ClaudeCliEvent,
} from "../claude-cli-service.js";
import type { CliToolExecutor } from "./cli-tool-executor.js";
import type { ProgressCallback } from "./event-handlers.js";
import { logToOutput } from "../../utils/logger.js";
import { buildFullPlanContent } from "../../utils/frontmatter-utils.js";
import { emit } from "./stream-event-emitter.js";

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

    logToOutput(
      `[CliExecutionLoop:${correlationId}] Starting CLI execution loop`,
    );

    // Handle abort signal
    if (signal) {
      signal.addEventListener("abort", () => {
        logToOutput(
          `[CliExecutionLoop:${correlationId}] Abort signal received`,
        );
        cliHandle.kill();
      });
    }

    // Process the CLI event stream
    yield* cliHandle.stream.pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          // Check for abort
          if (signal?.aborted) {
            logToOutput(
              `[CliExecutionLoop:${correlationId}] Aborted, stopping loop`,
            );
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
  _toolExecutor: CliToolExecutor,
  progressCallback: ProgressCallback | undefined,
  correlationId: string | undefined,
  state: {
    addToResponse: (text: string) => void;
    setTaskCompleted: () => void;
  },
): Effect.Effect<void, Error> =>
  Effect.sync(() => {
    logToOutput(`[CliExecutionLoop:${correlationId}] Event: ${event.type}`);

    switch (event.type) {
      case "text": {
        // Emit text delta for UI
        emit.contentStreamed(progressCallback, event.content);
        state.addToResponse(event.content);
        break;
      }

      case "thinking": {
        // Emit as reasoning for UI (UI expects "reasoning" type)
        emit.reasoning(progressCallback, event.content);
        break;
      }

      case "tool_use": {
        logToOutput(
          `[CliExecutionLoop:${correlationId}] Tool use: ${event.name} (${event.id})`,
        );

        // Check if this is an MCP tool (prefixed with "mcp__")
        // MCP tools are executed locally via bridge handlers and results sent back to CLI
        const isMcpTool = event.name.startsWith("mcp__");

        if (isMcpTool) {
          // Extract the actual tool name (e.g., "mcp__clive-tools__proposeTestPlan" -> "proposeTestPlan")
          const toolParts = event.name.split("__");
          const toolName = toolParts.length >= 3 ? toolParts[2] : event.name;

          logToOutput(
            `[CliExecutionLoop:${correlationId}] MCP tool detected: ${toolName}, handled by MCP server (v2025-01-04-fixed)`,
          );

          // Emit tool-call event for UI (input available)
          // The MCP server subprocess handles execution via the bridge
          emit.toolCall(progressCallback, event.id, toolName, event.input, "input-available", true);

          // For proposeTestPlan, emit plan content from the input for floating approval bar
          if (toolName === "proposeTestPlan") {
            const input = event.input as {
              name?: string;
              overview?: string;
              suites?: Array<{
                id: string;
                name: string;
                testType: "unit" | "integration" | "e2e";
                targetFilePath: string;
                sourceFiles: string[];
                description?: string;
              }>;
              planContent?: string;
            };
            if (input.planContent && input.name) {
              const fullContent = buildFullPlanContent(
                { name: input.name, overview: input.overview, suites: input.suites },
                input.planContent,
              );
              emit.planContent(progressCallback, event.id, fullContent, true);
            }
          }

          // DON'T execute locally or send tool_result - MCP server handles it
          // The result will be echoed in CLI stdout as a 'user' message with tool_result
          // which is parsed by claude-cli-service.ts and emitted as a tool_result event
          break;
        }

        // Claude CLI has built-in tools (Read, Write, Edit, Bash, Glob, Grep, etc.)
        // that it executes itself. We should NOT execute them locally or send tool_result.
        // Only emit UI events so the user can see what's happening.
        logToOutput(
          `[CliExecutionLoop:${correlationId}] CLI built-in tool: ${event.name}, handled by Claude CLI (v2025-01-04-no-local-exec)`,
        );

        // Emit tool-call event for UI (input available)
        emit.toolCall(progressCallback, event.id, event.name, event.input, "input-available");

        // DON'T execute locally or send tool_result - Claude CLI handles it
        // The result will be echoed in CLI stdout as a 'user' message with tool_result
        break;
      }

      case "tool_result": {
        // Tool result echoed from CLI stdout (for MCP tools handled by MCP server)
        // Emit to UI for status update
        logToOutput(
          `[CliExecutionLoop:${correlationId}] Tool result received for: ${event.id}`,
        );

        // Parse result to determine success
        let success = true;
        let resultContent: unknown = event.content;
        try {
          const parsed = JSON.parse(event.content);
          if (parsed.success === false || parsed.error) {
            success = false;
          }
          resultContent = parsed;
        } catch {
          // Keep as string if not JSON
        }

        emit.toolResult(
          progressCallback,
          event.id,
          "mcp-tool", // Generic name since we don't have tool name in the result event
          resultContent,
          success ? "output-available" : "output-error",
        );
        break;
      }

      case "error": {
        logToOutput(
          `[CliExecutionLoop:${correlationId}] CLI error: ${event.message}`,
        );
        emit.error(progressCallback, event.message);
        break;
      }

      case "done": {
        logToOutput(`[CliExecutionLoop:${correlationId}] CLI done`);
        state.setTaskCompleted();
        // Close stdin to signal we're done sending tool results
        cliHandle.close();
        break;
      }
    }
  });
