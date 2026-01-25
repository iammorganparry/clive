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

import { Effect, Ref, Stream } from "effect";
import * as vscode from "vscode";
import { buildFullPlanContent } from "../../utils/frontmatter-utils.js";
import { logToOutput } from "../../utils/logger.js";
import type {
  ClaudeCliEvent,
  ClaudeCliExecuteOptions,
  ClaudeCliService,
  CliExecutionHandle,
} from "../claude-cli-service.js";
import type { CliToolExecutor } from "./cli-tool-executor.js";
import type { ProgressCallback } from "./event-handlers.js";
import {
  buildIterationPrompt,
  getExitReason,
  getProgressSummary,
  incrementIteration,
  type LoopState,
  recordFailedIteration,
  resetFailures,
  setExitReason,
  shouldContinueLoop,
} from "./loop-state.js";
import {
  discoverPlanFilePath,
  readPlanContentWithRetry,
} from "./plan-mode-handler.js";
import { emit } from "./stream-event-emitter.js";
import type { TodoDisplayItem } from "./stream-events.js";

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
  /** Workspace root for plan file discovery */
  workspaceRoot?: string;
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
    const {
      cliHandle,
      toolExecutor,
      progressCallback,
      signal,
      correlationId,
      workspaceRoot,
    } = options;

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
            workspaceRoot,
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
  workspaceRoot: string | undefined,
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

        // Check for Claude Code's native planning tools
        const isEnterPlanMode = event.name === "EnterPlanMode";
        const isExitPlanMode = event.name === "ExitPlanMode";

        if (isEnterPlanMode) {
          logToOutput(
            `[CliExecutionLoop:${correlationId}] Native EnterPlanMode detected`,
          );
          emit.nativePlanModeEntered(progressCallback, event.id);
          // Also emit as a tool call for UI visibility
          emit.toolCall(
            progressCallback,
            event.id,
            event.name,
            event.input,
            "input-available",
          );
          break;
        }

        if (isExitPlanMode) {
          logToOutput(
            `[CliExecutionLoop:${correlationId}] Native ExitPlanMode detected`,
          );
          emit.toolCall(
            progressCallback,
            event.id,
            event.name,
            event.input,
            "input-available",
          );

          // Discover and read the plan file
          if (workspaceRoot) {
            const planFilePath = yield* discoverPlanFilePath(workspaceRoot);

            if (planFilePath) {
              logToOutput(
                `[CliExecutionLoop:${correlationId}] Found plan file: ${planFilePath}`,
              );

              // Read plan content with retry (file may still be written)
              const planContentResult = yield* readPlanContentWithRetry(
                planFilePath,
              ).pipe(
                Effect.map((content) => ({ success: true as const, content })),
                Effect.catchAll((error) =>
                  Effect.succeed({
                    success: false as const,
                    error: error.message,
                  }),
                ),
              );

              if (planContentResult.success) {
                // Emit plan content for approval UI
                emit.planContent(
                  progressCallback,
                  event.id,
                  planContentResult.content,
                  true,
                  planFilePath,
                );
                logToOutput(
                  `[CliExecutionLoop:${correlationId}] Emitted plan content (${planContentResult.content.length} chars)`,
                );

                // Open the plan file in VSCode editor
                yield* Effect.tryPromise({
                  try: async () => {
                    const fileUri = vscode.Uri.file(planFilePath);
                    const document =
                      await vscode.workspace.openTextDocument(fileUri);
                    await vscode.window.showTextDocument(document, {
                      preview: false,
                      preserveFocus: false,
                    });
                    logToOutput(
                      `[CliExecutionLoop:${correlationId}] Opened plan file in editor: ${planFilePath}`,
                    );
                  },
                  catch: (error) =>
                    new Error(
                      `Failed to open plan file: ${error instanceof Error ? error.message : String(error)}`,
                    ),
                }).pipe(
                  Effect.catchAll((error) =>
                    Effect.sync(() => {
                      logToOutput(
                        `[CliExecutionLoop:${correlationId}] Warning: Could not open plan file in editor: ${error.message}`,
                      );
                    }),
                  ),
                );
              } else {
                logToOutput(
                  `[CliExecutionLoop:${correlationId}] Failed to read plan file: ${planContentResult.error}`,
                );
                emit.error(
                  progressCallback,
                  `Failed to read plan file: ${planContentResult.error}`,
                );
              }
            } else {
              logToOutput(
                `[CliExecutionLoop:${correlationId}] No plan file found in .claude/plans/`,
              );
            }
          } else {
            logToOutput(
              `[CliExecutionLoop:${correlationId}] Cannot discover plan file: workspaceRoot not provided`,
            );
          }

          emit.nativePlanModeExiting(progressCallback, event.id);
          break;
        }

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
          emit.toolCall(
            progressCallback,
            event.id,
            toolName,
            event.input,
            "input-available",
            true,
          );

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
                {
                  name: input.name,
                  overview: input.overview,
                  suites: input.suites,
                },
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
        emit.toolCall(
          progressCallback,
          event.id,
          event.name,
          event.input,
          "input-available",
        );

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

/**
 * Options for running the Ralph Wiggum CLI loop
 */
export interface RalphWiggumCliLoopOptions {
  /** Reference to loop state */
  loopStateRef: Ref.Ref<LoopState>;
  /** Claude CLI service for spawning new processes */
  claudeCliService: ClaudeCliService;
  /** Base CLI execute options */
  cliOptions: Omit<ClaudeCliExecuteOptions, "prompt">;
  /** Tool executor for running tools */
  toolExecutor: CliToolExecutor;
  /** Callback for progress updates to UI */
  progressCallback?: ProgressCallback;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Correlation ID for logging */
  correlationId?: string;
  /** Workspace root for building prompts */
  workspaceRoot: string;
  /** Path to the approved test plan file */
  planFilePath?: string;
}

/**
 * Convert LoopState todos to TodoDisplayItem for UI
 */
const todosToDisplayItems = (state: LoopState): TodoDisplayItem[] =>
  state.todos.map((t) => ({
    content: t.content,
    status: t.status,
    activeForm: t.activeForm,
  }));

/**
 * Ralph Wiggum loop for CLI path
 *
 * Continuously runs CLI iterations until all tests pass or safety limits reached.
 * Each iteration:
 * 1. Spawns a fresh CLI process with context-aware prompt
 * 2. Runs the single-iteration execution loop
 * 3. Checks completion status and updates loop state
 * 4. Repeats if needed
 */
export const runRalphWiggumCliLoop = (
  options: RalphWiggumCliLoopOptions,
): Effect.Effect<CliExecutionResult, Error> =>
  Effect.gen(function* () {
    const {
      loopStateRef,
      claudeCliService,
      cliOptions,
      toolExecutor,
      progressCallback,
      signal,
      correlationId,
      workspaceRoot,
      planFilePath,
    } = options;

    let accumulatedResponse = "";
    let lastIterationSuccess = false;

    logToOutput(
      `[RalphWiggumCliLoop:${correlationId}] Starting Ralph Wiggum loop`,
    );

    // Main loop
    while (true) {
      // Check abort signal
      if (signal?.aborted) {
        logToOutput(`[RalphWiggumCliLoop:${correlationId}] Aborted by signal`);
        yield* Ref.update(loopStateRef, (s) => setExitReason(s, "cancelled"));
        break;
      }

      // Get current state
      const state = yield* Ref.get(loopStateRef);

      // Check if we should continue
      if (!shouldContinueLoop(state)) {
        const reason = getExitReason(state);
        logToOutput(
          `[RalphWiggumCliLoop:${correlationId}] Loop exit: ${reason}`,
        );

        // Emit loop complete event
        const progress = getProgressSummary(state);
        emit.loopComplete(
          progressCallback,
          reason ?? "complete",
          state.iteration,
          todosToDisplayItems(state),
          progress,
        );
        break;
      }

      // Increment iteration
      yield* Ref.update(loopStateRef, incrementIteration);
      const newState = yield* Ref.get(loopStateRef);

      logToOutput(
        `[RalphWiggumCliLoop:${correlationId}] Starting iteration ${newState.iteration}/${newState.maxIterations}`,
      );

      // Emit iteration start event
      emit.loopIterationStart(
        progressCallback,
        newState.iteration,
        newState.maxIterations,
      );

      // Build iteration prompt - agent sees filesystem state
      const iterationPrompt = buildIterationPrompt(
        newState,
        workspaceRoot,
        planFilePath,
      );

      // Spawn new CLI process for this iteration
      const cliHandle = yield* claudeCliService.execute({
        ...cliOptions,
        prompt: iterationPrompt,
        signal,
      });

      // Run single iteration
      const iterationResult = yield* runCliExecutionLoop({
        cliHandle,
        toolExecutor,
        progressCallback,
        signal,
        correlationId: `${correlationId}-iter${newState.iteration}`,
        workspaceRoot,
      });

      accumulatedResponse += iterationResult.response;

      // Determine if this iteration made progress
      const updatedState = yield* Ref.get(loopStateRef);
      const beforeProgress = getProgressSummary(newState);
      const afterProgress = getProgressSummary(updatedState);

      const madeProgress = afterProgress.completed > beforeProgress.completed;

      if (madeProgress || iterationResult.taskCompleted) {
        // Reset failure counter on progress
        yield* Ref.update(loopStateRef, resetFailures);
        lastIterationSuccess = true;
        logToOutput(
          `[RalphWiggumCliLoop:${correlationId}] Iteration ${newState.iteration} made progress`,
        );
      } else {
        // Record failure if no progress
        yield* Ref.update(loopStateRef, recordFailedIteration);
        lastIterationSuccess = false;
        logToOutput(
          `[RalphWiggumCliLoop:${correlationId}] Iteration ${newState.iteration} made no progress`,
        );
      }

      // Emit iteration complete event
      const finalIterState = yield* Ref.get(loopStateRef);
      emit.loopIterationComplete(
        progressCallback,
        finalIterState.iteration,
        todosToDisplayItems(finalIterState),
        getProgressSummary(finalIterState),
      );

      // If task explicitly completed, exit
      if (iterationResult.taskCompleted && finalIterState.allTestsPassed) {
        yield* Ref.update(loopStateRef, (s) => setExitReason(s, "complete"));
        logToOutput(
          `[RalphWiggumCliLoop:${correlationId}] All tests passed, exiting`,
        );
      }
    }

    // Get final state
    const finalState = yield* Ref.get(loopStateRef);

    logToOutput(
      `[RalphWiggumCliLoop:${correlationId}] Loop completed after ${finalState.iteration} iterations. ` +
        `Exit reason: ${finalState.exitReason}. All tests passed: ${finalState.allTestsPassed}`,
    );

    return {
      success: finalState.allTestsPassed || lastIterationSuccess,
      response: accumulatedResponse,
      taskCompleted: finalState.allTestsPassed,
      error:
        finalState.exitReason === "error" ? "Max failures reached" : undefined,
    };
  }).pipe(
    Effect.catchAll((error) => {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logToOutput(`[RalphWiggumCliLoop] Error: ${errorMsg}`);

      return Effect.succeed({
        success: false,
        response: "",
        taskCompleted: false,
        error: errorMsg,
      });
    }),
  );
