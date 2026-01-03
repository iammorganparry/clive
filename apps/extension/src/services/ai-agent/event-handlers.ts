/**
 * Event Handlers Module
 * Composable Effect-based handlers for agent stream events
 * Separated by event type for clarity and testability
 */

import type { ToolResult } from "@ai-sdk/provider-utils";
import { Effect, pipe, Ref } from "effect";
import type { AgentState, StreamingState } from "./agent-state.js";
import {
  setToolRejected,
  setTaskCompleted,
  incrementMistakes,
  resetMistakes,
  addExecution,
  trackCommandToolCall,
  trackFileToolCall,
  trackPlanToolCall,
  hasPlanToolCall,
  deletePlanToolCall,
  setStreamingArgs,
  getStreamingArgs,
  hasStreamingArgs,
  deleteStreamingArgs,
  setPlanInitStatus,
  getPlanInitStatus,
  getFilePathForPlan,
} from "./agent-state.js";
import {
  extractJsonField,
  unescapeJsonString,
  sanitizePlanName,
  extractSuitesInfo,
  generatePlanFilename,
} from "./testing-agent-helpers.js";
import { logToOutput } from "../../utils/logger.js";
import {
  initializeStreamingWrite,
  appendStreamingContent,
  finalizeStreamingWrite,
} from "./tools/write-test-file.js";
import {
  initializePlanStreamingWriteEffect,
  appendPlanStreamingContentEffect,
  finalizePlanStreamingWriteEffect,
  renamePlanFileEffect,
} from "./tools/propose-test-plan.js";
import type { WriteTestFileOutput } from "./types.js";
/**
 * Progress callback type
 */
export type ProgressCallback = (status: string, message: string) => void;

/**
 * Maximum consecutive mistakes before warning
 */
const MAX_CONSECUTIVE_MISTAKES = 5;

/**
 * Handle tool-call-streaming-start event
 * Initializes streaming args tracking for writeTestFile and proposeTestPlan
 */
export const handleToolCallStreamingStart = (
  event: { toolName?: string; toolCallId?: string },
  streamingState: Ref.Ref<StreamingState>,
  progressCallback: ProgressCallback | undefined,
  correlationId: string,
) =>
  Effect.gen(function* () {
    logToOutput(
      `[handleToolCallStreamingStart] toolName=${event.toolName}, toolCallId=${event.toolCallId}`,
    );
    if (!event.toolCallId) return;

    if (event.toolName === "writeTestFile") {
      yield* Effect.logDebug(
        `[TestingAgent:${correlationId}] Streaming writeTestFile started: ${event.toolCallId}`,
      );
      yield* setStreamingArgs(streamingState, event.toolCallId, "");
    }

    if (event.toolName === "proposeTestPlan") {
      yield* Effect.logDebug(
        `[TestingAgent:${correlationId}] Streaming proposeTestPlan started: ${event.toolCallId}`,
      );
      yield* setStreamingArgs(streamingState, event.toolCallId, "");

      // Emit tool-call event immediately so UI shows the card
      yield* Effect.sync(() => {
        progressCallback?.(
          "tool-call",
          JSON.stringify({
            type: "tool-call",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: undefined, // Args not yet available
            state: "input-streaming",
          }),
        );
      });
    }
  });

/**
 * Handle writeTestFile streaming delta
 * Accumulates args and streams content to file
 */
const handleWriteTestFileDelta = (
  toolCallId: string,
  argsTextDelta: string,
  streamingState: Ref.Ref<StreamingState>,
  correlationId: string,
) =>
  Effect.gen(function* () {
    // Accumulate args text
    const current = yield* getStreamingArgs(streamingState, toolCallId);
    const accumulated = current + argsTextDelta;
    yield* setStreamingArgs(streamingState, toolCallId, accumulated);

    // Try to extract testContent from accumulated JSON
    const testContentValue = extractJsonField(accumulated, "testContent");
    if (!testContentValue) return;

    // Extract and unescape the content
    const contentChunk = unescapeJsonString(testContentValue);

    // If we have a targetPath, initialize streaming write
    const targetPathValue = extractJsonField(accumulated, "targetPath");
    if (!targetPathValue) {
      yield* Effect.logDebug(
        `[TestingAgent:${correlationId}] Skipping streaming write due to missing targetPath`,
      );
      return;
    }

    const targetPath = targetPathValue;

    // Check if streaming write is initialized
    const stateKey = `${toolCallId}-${targetPath}`;
    const hasState = yield* hasStreamingArgs(streamingState, stateKey);

    if (!hasState) {
      // Initialize streaming write
      const initResult = yield* Effect.promise(() =>
        initializeStreamingWrite(targetPath, toolCallId),
      );
      if (initResult.success) {
        yield* setStreamingArgs(streamingState, stateKey, "initialized");
        yield* trackFileToolCall(streamingState, targetPath, toolCallId);
      }
    }

    // Append content chunk
    yield* Effect.promise(() =>
      appendStreamingContent(toolCallId, contentChunk),
    );
  });

/**
 * Handle proposeTestPlan streaming delta
 * Accumulates args and streams plan content to file
 */
const handleProposeTestPlanDelta = (
  toolCallId: string,
  argsTextDelta: string,
  streamingState: Ref.Ref<StreamingState>,
  progressCallback: ProgressCallback | undefined,
  correlationId: string,
) =>
  Effect.gen(function* () {
    // Accumulate args text
    const current = yield* getStreamingArgs(streamingState, toolCallId);
    const accumulated = current + argsTextDelta;
    yield* setStreamingArgs(streamingState, toolCallId, accumulated);

    // Initialize plan file if name is available and not yet initialized
    // Create immediately with placeholder name, rename when suites info available
    const nameValue = extractJsonField(accumulated, "name");
    const suitesInfo = extractSuitesInfo(accumulated);
    const hasPlan = yield* hasPlanToolCall(streamingState, toolCallId);

    if (nameValue && !hasPlan) {
      const unescapedName = unescapeJsonString(nameValue);

      // Create file immediately with placeholder name
      const placeholderPath = `.clive/plans/${sanitizePlanName(unescapedName)}.md`;

      // Track the plan path BEFORE attempting initialization
      // This ensures we have a targetPath even if file creation fails
      yield* trackPlanToolCall(streamingState, toolCallId, placeholderPath);

      yield* pipe(
        initializePlanStreamingWriteEffect(placeholderPath, toolCallId),
        Effect.tap(() =>
          Effect.sync(() => {
            progressCallback?.(
              "file-created",
              JSON.stringify({
                type: "file-created",
                toolCallId,
                filePath: placeholderPath,
              }),
            );
          }),
        ),
        Effect.tap(() =>
          trackFileToolCall(streamingState, placeholderPath, toolCallId),
        ),
        Effect.tap(() =>
          setPlanInitStatus(streamingState, toolCallId, Promise.resolve(true)),
        ),
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* setPlanInitStatus(
              streamingState,
              toolCallId,
              Promise.resolve(false),
            );
            progressCallback?.(
              "error",
              JSON.stringify({
                type: "error",
                message: `Failed to open plan file: ${error.message ?? "Unknown error"}`,
              }),
            );
          }),
        ),
      );

      // If suites info is available immediately, rename to descriptive filename
      if (suitesInfo) {
        const descriptivePath = generatePlanFilename(unescapedName, suitesInfo);
        if (descriptivePath !== placeholderPath) {
          yield* pipe(
            renamePlanFileEffect(placeholderPath, descriptivePath, toolCallId),
            Effect.tap((newPath: string) =>
              trackPlanToolCall(streamingState, toolCallId, newPath),
            ),
            Effect.tap((newPath: string) =>
              trackFileToolCall(streamingState, newPath, toolCallId),
            ),
            Effect.tap((newPath: string) =>
              Effect.sync(() => {
                progressCallback?.(
                  "file-created",
                  JSON.stringify({
                    type: "file-created",
                    toolCallId,
                    filePath: newPath,
                  }),
                );
              }),
            ),
            Effect.catchAll((error) =>
              Effect.logError(
                `[TestingAgent:${correlationId}] Failed to rename plan file: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              ),
            ),
          );
        }
      }
    }

    // Check if file was created with placeholder and suites info just arrived
    if (nameValue && hasPlan && suitesInfo) {
      const currentPath = yield* getFilePathForPlan(streamingState, toolCallId);
      const unescapedName = unescapeJsonString(nameValue);
      const descriptivePath = generatePlanFilename(unescapedName, suitesInfo);

      // Check if current path is a placeholder (simple name without test type/count)
      const isPlaceholder =
        currentPath && !currentPath.match(/-\w+-\d+-(suite|suites)\.md$/);

      if (currentPath && isPlaceholder && descriptivePath !== currentPath) {
        yield* pipe(
          renamePlanFileEffect(currentPath, descriptivePath, toolCallId),
          Effect.tap((newPath) =>
            trackPlanToolCall(streamingState, toolCallId, newPath),
          ),
          Effect.tap((newPath) =>
            trackFileToolCall(streamingState, newPath, toolCallId),
          ),
          Effect.tap((newPath) =>
            Effect.sync(() => {
              progressCallback?.(
                "file-created",
                JSON.stringify({
                  type: "file-created",
                  toolCallId,
                  filePath: newPath,
                }),
              );
            }),
          ),
          Effect.catchAll((error) =>
            Effect.logError(
              `[TestingAgent:${correlationId}] Failed to rename plan file: ${
                error instanceof Error ? error.message : "Unknown error"
              }`,
            ),
          ),
        );
      }
    }

    // Extract and stream planContent to webview
    const planContentValue = extractJsonField(accumulated, "planContent");
    if (!planContentValue) return;

    const planContentChunk = unescapeJsonString(planContentValue);

    // Get targetPath (may be empty if initialization failed, but that's OK)
    const targetPath = yield* getFilePathForPlan(streamingState, toolCallId);

    // FIRST: Emit the event to the webview (always succeeds, even if filePath is empty)
    // The webview needs the content for display regardless of file creation success
    yield* Effect.sync(() => {
      progressCallback?.(
        "plan-content-streaming",
        JSON.stringify({
          type: "plan-content-streaming",
          toolCallId,
          content: planContentChunk,
          isComplete: false,
          filePath: targetPath || undefined, // Send undefined if empty string
        }),
      );
    });

    // THEN: Attempt to write to file (may fail, but event was already sent)
    // Only attempt file write if we have a targetPath and initialization succeeded
    if (targetPath) {
      const initPromise = yield* getPlanInitStatus(streamingState, toolCallId);
      if (initPromise) {
        yield* Effect.tryPromise({
          try: async () => {
            const success = await initPromise;
            if (!success) {
              throw new Error("Initialization failed");
            }
          },
          catch: () => new Error("Failed to wait for initialization"),
        }).pipe(
          Effect.flatMap(() =>
            appendPlanStreamingContentEffect(toolCallId, planContentChunk),
          ),
          Effect.catchAll((error) =>
            Effect.logError(
              `[TestingAgent:${correlationId}] Failed to append plan streaming content: ${error.message ?? "Unknown error"}`,
            ),
          ),
        );
      }
    }
  });

/**
 * Handle tool-call-delta event
 * Routes to appropriate streaming handler based on tool type
 */
export const handleToolCallDelta = (
  event: {
    toolName?: string;
    toolCallId?: string;
    inputTextDelta?: string; // AI SDK v6 renamed from argsTextDelta
  },
  streamingState: Ref.Ref<StreamingState>,
  progressCallback: ProgressCallback | undefined,
  correlationId: string,
) =>
  Effect.gen(function* () {
    if (!event.toolCallId || !event.inputTextDelta) return;

    if (event.toolName === "writeTestFile") {
      yield* handleWriteTestFileDelta(
        event.toolCallId,
        event.inputTextDelta,
        streamingState,
        correlationId,
      );
    }

    if (event.toolName === "proposeTestPlan") {
      yield* handleProposeTestPlanDelta(
        event.toolCallId,
        event.inputTextDelta,
        streamingState,
        progressCallback,
        correlationId,
      );
    }
  });

/**
 * Handle tool-call event
 * Tracks tool calls and emits progress updates
 * Checks approval setting for bashExecute and auto-approves if enabled
 */
export const handleToolCall = (
  event: {
    toolName?: string;
    toolCallId?: string;
    toolArgs?: unknown;
  },
  agentState: Ref.Ref<AgentState>,
  streamingState: Ref.Ref<StreamingState>,
  progressCallback: ProgressCallback | undefined,
  correlationId: string,
  _waitForApproval?: (toolCallId: string) => Promise<unknown>,
  _getApprovalSetting?: () => Effect.Effect<"always" | "auto">,
) =>
  Effect.gen(function* () {
    logToOutput(
      `[handleToolCall] toolName=${event.toolName}, toolCallId=${event.toolCallId}`,
    );
    if (!event.toolCallId) {
      yield* Effect.logDebug(
        `[TestingAgent:${correlationId}] Skipping tool call due to missing toolCallId`,
      );
      return;
    }

    // Check if a previous tool was rejected (rejection cascade)
    const state = yield* Ref.get(agentState);
    if (state.didRejectTool) {
      yield* Effect.logDebug(
        `[TestingAgent:${correlationId}] Skipping tool ${event.toolName} due to rejection cascade`,
      );
      progressCallback?.(
        "tool-skipped",
        JSON.stringify({
          type: "tool-skipped",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          reason: "Previous tool was rejected",
        }),
      );
      return;
    }

    yield* Effect.logDebug(
      `[TestingAgent:${correlationId}] Tool call: ${event.toolName}`,
    );

    // Track toolCallId for bash commands
    if (event.toolName === "bashExecute") {
      const args = event.toolArgs as { command?: string } | undefined;
      const command = args?.command || "";
      if (command) {
        yield* trackCommandToolCall(streamingState, command, event.toolCallId);
      }
      // Approval logic is now handled inside bash-execute.ts before execution
      // No need for additional approval handling here
    }

    // Track toolCallId for file writes
    if (event.toolName === "writeTestFile") {
      const args = event.toolArgs as { targetPath?: string } | undefined;
      const targetPath = args?.targetPath || "";
      if (targetPath) {
        yield* trackFileToolCall(streamingState, targetPath, event.toolCallId);

        // Finalize streaming write if it was active
        const hasArgs = yield* hasStreamingArgs(
          streamingState,
          event.toolCallId,
        );
        if (hasArgs) {
          const finalizeResult = yield* Effect.promise(() =>
            finalizeStreamingWrite(event.toolCallId || ""),
          );
          if (finalizeResult.success) {
            yield* Effect.logDebug(
              `[TestingAgent:${correlationId}] Streaming write finalized: ${finalizeResult.filePath}`,
            );
          }
          yield* deleteStreamingArgs(streamingState, event.toolCallId);
        }
      }
    }

    // Progress updates
    yield* emitToolProgress(event, progressCallback);

    // Emit event
    progressCallback?.(
      "tool-call",
      JSON.stringify({
        type: "tool-call",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.toolArgs,
        state: "input-available",
      }),
    );
  });

/**
 * Emit progress updates for tool calls
 */
const emitToolProgress = (
  event: { toolName?: string; toolArgs?: unknown },
  progressCallback: ProgressCallback | undefined,
) =>
  Effect.sync(() => {
    if (event.toolName === "bashExecute") {
      const args = event.toolArgs as { command?: string } | undefined;
      const command = args?.command || "";
      if (
        command.includes("vitest") ||
        command.includes("jest") ||
        command.includes("playwright") ||
        command.includes("cypress") ||
        command.includes("npm test") ||
        command.includes("npm run test")
      ) {
        progressCallback?.(
          "running",
          `Running test: ${command.substring(0, 100)}`,
        );
      } else if (
        command.includes("cat ") ||
        command.includes("head ") ||
        command.includes("tail ")
      ) {
        progressCallback?.("reading", "Reading file contents...");
      } else if (command.includes("find ") || command.includes("ls ")) {
        progressCallback?.("scanning", "Scanning directory structure...");
      } else {
        progressCallback?.("executing", "Running command...");
      }
    } else if (event.toolName === "writeTestFile") {
      progressCallback?.("writing", "Writing test file...");
    } else if (event.toolName === "summarizeContext") {
      progressCallback?.(
        "summarizing",
        "Summarizing conversation to free context...",
      );
    }
  });

/**
 * Handle text-delta event
 * Emits content streaming events
 */
export const handleTextDelta = (
  event: { content?: string },
  progressCallback: ProgressCallback | undefined,
) =>
  Effect.sync(() => {
    if (!event.content) return;

    progressCallback?.(
      "content_streamed",
      JSON.stringify({
        type: "content_streamed",
        content: event.content,
      }),
    );
  });

/**
 * Handle thinking event
 * Emits reasoning events
 */
export const handleThinking = (
  event: { content?: string },
  progressCallback: ProgressCallback | undefined,
  correlationId: string,
) =>
  Effect.gen(function* () {
    if (!event.content) return;

    yield* Effect.logDebug(
      `[TestingAgent:${correlationId}] Thinking event received`,
    );

    yield* Effect.sync(() => {
      progressCallback?.(
        "reasoning",
        JSON.stringify({
          type: "reasoning",
          content: event.content,
        }),
      );
    });
  });

/**
 * Handle tool-result event
 * Processes tool results, tracks mistakes, and manages state
 */
export const handleToolResult = (
  event: {
    toolName?: string;
    toolCallId?: string;
    toolResult?: unknown;
  },
  agentState: Ref.Ref<AgentState>,
  streamingState: Ref.Ref<StreamingState>,
  progressCallback: ProgressCallback | undefined,
  correlationId: string,
) =>
  Effect.gen(function* () {
    yield* Effect.logDebug(
      `[TestingAgent:${correlationId}] Tool result: ${event.toolName}`,
    );

    const actualOutput =
      event.toolResult &&
      typeof event.toolResult === "object" &&
      "output" in event.toolResult
        ? event.toolResult.output
        : event.toolResult;

    // Check if tool was rejected or cancelled
    const outputObj =
      actualOutput && typeof actualOutput === "object" ? actualOutput : {};
    const wasRejected = "rejected" in outputObj && outputObj.rejected === true;
    const wasCancelled =
      "cancelled" in outputObj && outputObj.cancelled === true;

    if (wasRejected) {
      yield* setToolRejected(agentState, true);
      yield* Effect.logDebug(
        `[TestingAgent:${correlationId}] Tool ${event.toolName} was rejected - enabling rejection cascade`,
      );
    }

    // Check for completion via completeTask tool
    if (event.toolName === "completeTask" && event.toolResult) {
      const toolResult = event.toolResult as ToolResult<
        string,
        unknown,
        { success: boolean; completed: boolean; message: string }
      >;
      if (toolResult.output?.completed) {
        yield* setTaskCompleted(agentState, true);
        yield* Effect.logDebug(
          `[TestingAgent:${correlationId}] Task marked as complete via completeTask tool`,
        );
      }
    }

    // Extract planContent from proposeTestPlan and finalize
    if (event.toolName === "proposeTestPlan" && event.toolCallId) {
      yield* handleProposeTestPlanResult(
        event.toolCallId,
        streamingState,
        progressCallback,
        correlationId,
        actualOutput,
      );
    }

    // Track consecutive mistakes
    yield* trackMistakes(
      actualOutput,
      wasRejected,
      agentState,
      progressCallback,
      event.toolCallId,
      event.toolName,
      correlationId,
    );

    // Update executions for writeTestFile
    if (event.toolName === "writeTestFile" && event.toolResult) {
      const toolResult = event.toolResult as ToolResult<
        string,
        unknown,
        WriteTestFileOutput
      >;
      if (toolResult.output?.success) {
        yield* addExecution(agentState, {
          testId: "unknown",
          filePath: toolResult.output?.filePath,
        });
      }
    }

    // Determine the result state
    const resultState = wasCancelled
      ? "output-cancelled"
      : wasRejected
        ? "output-denied"
        : "output-available";

    // Emit tool result
    progressCallback?.(
      "tool-result",
      JSON.stringify({
        type: "tool-result",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        output: actualOutput,
        state: resultState,
      }),
    );
  });

/**
 * Handle proposeTestPlan result finalization
 */
const handleProposeTestPlanResult = (
  toolCallId: string,
  streamingState: Ref.Ref<StreamingState>,
  progressCallback: ProgressCallback | undefined,
  correlationId: string,
  toolOutput?: unknown,
) =>
  Effect.gen(function* () {
    const accumulated = yield* getStreamingArgs(streamingState, toolCallId);

    // Extract file path from tool output if available
    let finalFilePath: string | undefined;
    if (
      toolOutput &&
      typeof toolOutput === "object" &&
      "filePath" in toolOutput &&
      typeof toolOutput.filePath === "string"
    ) {
      finalFilePath = toolOutput.filePath;
    }

    // Finalize streaming write if file was initialized
    const hasPlan = yield* hasPlanToolCall(streamingState, toolCallId);
    let finalizedFilePath: string | undefined;
    if (hasPlan) {
      const finalizeResult = yield* pipe(
        finalizePlanStreamingWriteEffect(toolCallId),
        Effect.tap((filePath) =>
          Effect.logDebug(
            `[TestingAgent:${correlationId}] Plan file finalized: ${filePath}`,
          ),
        ),
        Effect.tap(() => deletePlanToolCall(streamingState, toolCallId)),
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* Effect.logError(
              `[TestingAgent:${correlationId}] Failed to finalize plan streaming write: ${error.message ?? "Unknown error"}`,
            );
            return undefined;
          }),
        ),
      );
      finalizedFilePath = finalizeResult;
    }

    // Get file path from streaming state (fallback)
    const streamingFilePath = yield* getFilePathForPlan(
      streamingState,
      toolCallId,
    );
    // Prefer finalized file path, then tool output, then streaming state
    const targetPath = finalizedFilePath || finalFilePath || streamingFilePath;

    // Always emit final plan content using robust extraction
    if (accumulated) {
      const planContentValue = extractJsonField(accumulated, "planContent");
      if (planContentValue) {
        const planContent = unescapeJsonString(planContentValue);

        // Emit final plan content as complete with file path (may be empty if file creation failed)
        yield* Effect.sync(() => {
          progressCallback?.(
            "plan-content-streaming",
            JSON.stringify({
              type: "plan-content-streaming",
              toolCallId,
              content: planContent,
              isComplete: true,
              filePath: targetPath || undefined, // Send undefined if empty string
            }),
          );
        });
      }

      // Clean up accumulated args after extraction
      yield* deleteStreamingArgs(streamingState, toolCallId);
    } else if (targetPath) {
      // If no accumulated content (tool executed without streaming deltas),
      // emit a final event with just the filePath so frontend can display it
      yield* Effect.sync(() => {
        progressCallback?.(
          "plan-content-streaming",
          JSON.stringify({
            type: "plan-content-streaming",
            toolCallId,
            content: "",
            isComplete: true,
            filePath: targetPath,
          }),
        );
      });
    }
  });

/**
 * Track consecutive mistakes and emit warnings
 */
const trackMistakes = (
  actualOutput: unknown,
  wasRejected: boolean,
  agentState: Ref.Ref<AgentState>,
  progressCallback: ProgressCallback | undefined,
  toolCallId: string | undefined,
  toolName: string | undefined,
  correlationId: string,
) =>
  Effect.gen(function* () {
    const toolFailed =
      actualOutput &&
      typeof actualOutput === "object" &&
      "success" in actualOutput &&
      actualOutput.success === false;

    // Check for new diagnostic problems
    const hasNewProblems =
      actualOutput &&
      typeof actualOutput === "object" &&
      "message" in actualOutput &&
      typeof actualOutput.message === "string" &&
      actualOutput.message.includes("New diagnostic problems introduced");

    // Increment mistake count if tool failed or has new problems
    if (toolFailed || hasNewProblems || wasRejected) {
      const mistakeCount = yield* incrementMistakes(agentState);

      yield* Effect.logDebug(
        `[TestingAgent:${correlationId}] Consecutive mistakes: ${mistakeCount}`,
      );

      // Emit diagnostic problems event if detected
      if (hasNewProblems) {
        progressCallback?.(
          "diagnostic-problems",
          JSON.stringify({
            type: "diagnostic-problems",
            toolCallId,
            toolName,
          }),
        );
      }

      // Check if mistake limit reached
      if (mistakeCount >= MAX_CONSECUTIVE_MISTAKES) {
        progressCallback?.(
          "mistake-limit",
          JSON.stringify({
            type: "mistake-limit",
            count: mistakeCount,
            message: `Too many consecutive errors (${mistakeCount}). The model may need guidance or a different approach.`,
          }),
        );

        yield* Effect.logWarning(
          `[TestingAgent:${correlationId}] Mistake limit reached: ${mistakeCount}`,
        );
      }
    } else if (
      actualOutput &&
      typeof actualOutput === "object" &&
      "success" in actualOutput &&
      actualOutput.success === true
    ) {
      // Reset mistake count on successful tool execution
      yield* resetMistakes(agentState);
    }
  });
