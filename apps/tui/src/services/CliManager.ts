/**
 * CliManager
 * Central orchestrator for Claude CLI execution with event enrichment
 *
 * Responsibilities:
 * - Manages ClaudeCliService lifecycle
 * - Enriches events with metadata (duration, cost, diffs, subagent info)
 * - Coordinates DiffDetector, SubagentTracker, MetadataCalculator
 * - Emits enriched OutputLine events
 */

import { EventEmitter } from "node:events";
import {
  type ClaudeCliEvent,
  ClaudeCliService,
  type CliExecutionHandle,
} from "@clive/claude-services";
import { Effect, type Runtime, Stream } from "effect";
import type { OutputLine, QuestionData } from "../types";
import { debugLog } from "../utils/debug-logger";
import { ConversationLogger } from "./ConversationLogger";
import { DiffDetector } from "./DiffDetector";
import { SubagentTracker } from "./SubagentTracker";

export interface CliManagerOptions {
  workspaceRoot: string;
  model?: string;
  systemPrompt?: string;
  mode?: "plan" | "build" | "review";
  resumeSessionId?: string;
  permissionMode?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  epicId?: string;
  epicIdentifier?: string;
}

export class CliManager extends EventEmitter {
  private runtime: Runtime.Runtime<ClaudeCliService>;
  private currentHandle: CliExecutionHandle | null = null;
  private diffDetector = new DiffDetector();
  private subagentTracker = new SubagentTracker();
  private conversationLogger = new ConversationLogger();

  // Track tool metadata for enrichment
  private toolTimings = new Map<string, Date>();
  private toolNames = new Map<string, string>();
  private toolInputs = new Map<string, any>();

  // Track active agent session for persistent modes
  private activeMode: "plan" | "build" | "review" | null = null;

  // Track pending question to keep handle alive
  private pendingQuestionId: string | null = null;

  // Track all question IDs from current turn
  private currentTurnQuestionIds = new Set<string>();

  // Track which tool results have already been sent to prevent duplicates
  private sentToolResults = new Set<string>();

  // Track questions auto-rejected by the CLI (e.g. when not in --allowedTools)
  // Prevents sending stale tool_results that would cause 400 API errors
  private cliRejectedQuestions = new Set<string>();

  // Accumulation buffer for completion marker detection across streaming chunks
  private accumulatedText = "";

  // Set when stopForIteration() kills the process; suppresses the expected SIGTERM error
  private stoppingForIteration = false;

  // Track if we've already sent a tool_result this turn (only ONE per turn to prevent 400 errors)
  private hasAnsweredQuestionThisTurn = false;

  // Track conversation history for continuous sessions
  private conversationHistory: Array<{
    role: "user" | "assistant";
    content: string;
  }> = [];

  constructor() {
    super();

    // Create Effect runtime with ClaudeCliService
    const layer = ClaudeCliService.Default;
    this.runtime = Effect.runSync(
      Effect.gen(function* () {
        return yield* Effect.runtime<ClaudeCliService>();
      }).pipe(Effect.provide(layer)),
    );
  }

  /**
   * Execute a prompt via Claude CLI with enrichment
   */
  async execute(
    prompt: string,
    options: CliManagerOptions,
    appendToHistory: boolean = false,
  ): Promise<void> {
    debugLog("CliManager", "Starting execution", {
      promptLength: prompt.length,
      model: options.model,
      mode: options.mode,
      workspaceRoot: options.workspaceRoot,
      appendToHistory,
      historyLength: this.conversationHistory.length,
    });

    // Start conversation logging if mode is set
    if (options.mode) {
      this.conversationLogger.start(options.workspaceRoot, options.mode);
      debugLog("CliManager", "Started conversation logging", {
        logFile: this.conversationLogger.getLogFile(),
      });
    }

    // Add user message to history if not already there
    if (appendToHistory || this.conversationHistory.length === 0) {
      this.conversationHistory.push({ role: "user", content: prompt });
    }

    const program = Effect.gen(this.createExecutionProgram(prompt, options));

    try {
      await Effect.runPromise(
        program.pipe(Effect.provide(ClaudeCliService.Default)),
      );
      debugLog("CliManager", "Execution completed successfully");
    } catch (error) {
      debugLog("CliManager", "Execution error", {
        error: String(error),
        stoppingForIteration: this.stoppingForIteration,
      });
      // Suppress expected SIGTERM errors when stopForIteration() killed the process
      if (!this.stoppingForIteration) {
        this.emit("output", {
          text: `Execution error: ${error}`,
          type: "stderr",
        } as OutputLine);
      }
    } finally {
      this.stoppingForIteration = false;

      // Stop conversation logging
      this.conversationLogger.stop();
      debugLog("CliManager", "Stopped conversation logging");

      // Always emit "complete" so listeners (e.g. the build loop) can advance.
      // When stopForIteration() kills the process, SIGTERM causes a non-zero
      // exit code → emit.fail() → Stream.runForEach throws → the generator
      // never reaches the end of the stream.
      // Emitting here in finally ensures the build loop always gets notified.
      this.emit("complete");
    }
  }

  /**
   * Create the execution program
   */
  private createExecutionProgram(prompt: string, options: CliManagerOptions) {
    const self = this;

    return function* () {
      const cliService = yield* ClaudeCliService;

      // Spawn CLI process
      const handle = yield* cliService.execute({
        prompt,
        systemPrompt: options.systemPrompt,
        workspaceRoot: options.workspaceRoot,
        model: options.model,
        resumeSessionId: options.resumeSessionId,
        permissionMode: options.permissionMode,
        allowedTools: options.allowedTools,
        disallowedTools: options.disallowedTools,
        epicId: options.epicId,
        epicIdentifier: options.epicIdentifier,
      });

      self.currentHandle = handle;
      self.activeMode = options.mode || null;

      // Stream events with enrichment
      yield* handle.stream.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            const enrichedLines = self.enrichEvent(event);

            debugLog("CliManager", "Emitting enriched lines", {
              count: enrichedLines.length,
              types: enrichedLines.map((l) => l.type),
            });

            // Log enriched output lines
            for (const line of enrichedLines) {
              self.conversationLogger.log({
                timestamp: new Date().toISOString(),
                type: "enriched_output",
                line,
              });
            }

            // Emit all enriched lines
            for (const line of enrichedLines) {
              debugLog("CliManager", "Emitting output event", {
                type: line.type,
                hasQuestion: !!(line.type === "question" && line.question),
              });
              self.emit("output", line);
            }
          }),
        ),
      );

      // Clean up handle if not in a persistent mode with pending interaction.
      // The "complete" event is emitted from the execute() finally block
      // so it fires even when the stream fails (e.g. SIGTERM from stopForIteration).
      if (!self.activeMode && !self.pendingQuestionId) {
        self.currentHandle = null;
      }
    };
  }

  /**
   * Enrich ClaudeCliEvent with metadata and context
   * Returns array of OutputLines (may be multiple for one event)
   */
  private enrichEvent(event: ClaudeCliEvent): OutputLine[] {
    const outputs: OutputLine[] = [];

    debugLog("CliManager", "enrichEvent called", { eventType: event.type });

    // Log raw event to conversation log
    this.conversationLogger.log({
      timestamp: new Date().toISOString(),
      type: "raw_event",
      event,
    });

    switch (event.type) {
      case "tool_use": {
        // Track tool metadata
        this.toolTimings.set(event.id, new Date());
        this.toolNames.set(event.id, event.name);
        this.toolInputs.set(event.id, event.input);

        // Detect Linear issue updates and emit event for sidebar sync
        if (event.name === "mcp__linear__update_issue") {
          const input = event.input as Record<string, unknown>;
          this.emit("linear-updated", {
            issueId: input?.id,
            state: input?.state,
          });
        }

        // Check for special tool types
        if (event.name === "AskUserQuestion") {
          // Handle question - emit question event
          debugLog("CliManager", "AskUserQuestion tool detected", {
            toolId: event.id,
            input: event.input,
          });

          // CRITICAL: Only allow ONE question per turn (block duplicates before UI sees them)
          // Check if we already have a question in this turn by counting currentTurnQuestionIds
          // We can't check hasAnsweredQuestionThisTurn because user hasn't answered yet when 2nd question arrives
          if (this.currentTurnQuestionIds.size > 0) {
            debugLog(
              "CliManager",
              "WARNING: Duplicate question detected - blocking before UI",
              {
                toolId: event.id,
                reason:
                  "Already have question in this turn - blocking at source",
                existingQuestions: Array.from(this.currentTurnQuestionIds),
              },
            );

            // Mark as sent to prevent any future answer attempts
            this.sentToolResults.add(event.id);

            // Log the block
            this.conversationLogger.log({
              timestamp: new Date().toISOString(),
              type: "tool_result_blocked",
              toolId: event.id,
              result: "(blocked before UI - duplicate question)",
              reason:
                "Duplicate question in same turn - blocked at tool_use level",
            });

            // CRITICAL: Send an automatic tool_result for the blocked question
            // Claude expects a tool_result for every tool_use. If we don't send one,
            // Claude thinks the tool failed and will ask again in text.
            // Send a message indicating we already have this information.
            if (this.currentHandle) {
              const autoResponse = JSON.stringify({
                response: "Question already answered - continuing conversation",
              });

              debugLog(
                "CliManager",
                "Sending automatic tool_result for blocked duplicate question",
                {
                  toolId: event.id,
                },
              );

              this.currentHandle.sendToolResult(event.id, autoResponse);

              this.conversationLogger.log({
                timestamp: new Date().toISOString(),
                type: "tool_result_auto_sent",
                toolId: event.id,
                result: autoResponse,
                reason: "Auto-response for blocked duplicate question",
              });
            }

            // Do NOT emit this question to the UI
            // Do NOT track it as pending
            // Return empty outputs to skip it completely
            debugLog(
              "CliManager",
              "Duplicate question blocked - not emitting to UI",
            );
            return outputs;
          }

          // Track this question as part of current turn
          this.currentTurnQuestionIds.add(event.id);
          debugLog("CliManager", "Added question to current turn", {
            toolId: event.id,
            currentTurnQuestions: Array.from(this.currentTurnQuestionIds),
          });

          // Track pending question to keep CLI handle alive
          this.pendingQuestionId = event.id;
          debugLog("CliManager", "Set pendingQuestionId", {
            pendingQuestionId: this.pendingQuestionId,
          });

          const questionData = this.extractQuestionData(event.id, event.input);

          debugLog("CliManager", "Question data extracted", {
            toolUseID: questionData.toolUseID,
            questionCount: questionData.questions.length,
          });

          outputs.push({
            text: "",
            type: "question",
            toolUseID: event.id,
            question: questionData,
          });

          debugLog("CliManager", "Question event pushed to outputs");
          return outputs;
        }

        // Capture file state for diffs
        this.diffDetector.handleToolUse(event.name, event.input);

        // Check for subagent spawn
        const spawnEvent = this.subagentTracker.handleToolUse(
          event.id,
          event.name,
          event.input,
        );
        if (spawnEvent) {
          outputs.push(spawnEvent);
        }

        // Regular tool call
        outputs.push({
          text: `● ${event.name}`,
          type: "tool_call",
          toolName: event.name,
          toolUseID: event.id,
          toolInput: event.input,
          startTime: new Date(),
        });

        break;
      }

      case "tool_result": {
        const toolName = this.toolNames.get(event.id) || "unknown";
        const toolInput = this.toolInputs.get(event.id);

        // Calculate duration
        const startTime = this.toolTimings.get(event.id);
        const duration = startTime
          ? Date.now() - startTime.getTime()
          : undefined;

        // Generate file diff if applicable
        const diffData = this.diffDetector.generateDiff(toolName, toolInput);
        if (diffData) {
          outputs.push({
            text: `${diffData.operation === "create" ? "Create" : "Edit"}(${diffData.fileName}) +${diffData.stats.additions}/-${diffData.stats.deletions}`,
            type: "file_diff",
            toolUseID: event.id,
            diffData,
            duration,
          });
        }

        // Check for subagent completion
        const completeEvent = this.subagentTracker.handleToolResult(
          event.id,
          toolName,
          event.content,
        );
        if (completeEvent) {
          outputs.push(completeEvent);
        }

        // Extract metadata from result (if available)
        const metadata = this.extractResultMetadata(event.content);

        // Main tool result
        outputs.push({
          text: event.content,
          type: "tool_result",
          toolUseID: event.id,
          toolName,
          duration,
          ...metadata,
        });

        // Cleanup
        this.toolTimings.delete(event.id);
        this.toolNames.delete(event.id);
        this.toolInputs.delete(event.id);

        break;
      }

      case "text": {
        outputs.push({
          text: event.content,
          type: "assistant",
        });

        // Detect completion markers in streaming text
        this.accumulatedText += event.content;

        if (
          this.accumulatedText.includes(
            "<promise>ALL_TASKS_COMPLETE</promise>",
          )
        ) {
          debugLog("CliManager", "ALL_TASKS_COMPLETE marker detected — stopping process");
          this.accumulatedText = "";
          this.emit("all-tasks-complete");
          // Kill the process so the stream ends and "complete" fires.
          // Use stopForIteration to avoid emitting "killed" (which resets loop state).
          this.stopForIteration();
        } else if (
          this.accumulatedText.includes("<promise>TASK_COMPLETE</promise>")
        ) {
          debugLog("CliManager", "TASK_COMPLETE marker detected — stopping process");
          this.accumulatedText = "";
          this.emit("task-complete");
          this.stopForIteration();
        } else if (
          this.accumulatedText.includes("<promise>REVIEW_COMPLETE</promise>")
        ) {
          debugLog("CliManager", "REVIEW_COMPLETE marker detected — stopping process");
          this.accumulatedText = "";
          this.emit("review-complete");
          this.stopForIteration();
        }

        // Keep buffer bounded to handle markers spanning chunks
        if (this.accumulatedText.length > 200) {
          this.accumulatedText = this.accumulatedText.slice(-100);
        }

        // Track assistant response in conversation history
        const lastMessage =
          this.conversationHistory[this.conversationHistory.length - 1];
        if (!lastMessage || lastMessage.role !== "assistant") {
          // Start new assistant message
          this.conversationHistory.push({
            role: "assistant",
            content: event.content,
          });
        } else {
          // Append to existing assistant message
          lastMessage.content += event.content;
        }

        break;
      }

      case "thinking": {
        outputs.push({
          text: event.content,
          type: "system",
        });
        break;
      }

      case "error": {
        outputs.push({
          text: event.message,
          type: "stderr",
        });
        break;
      }

      case "tool_rejected": {
        // CLI auto-rejected this tool (not in --allowedTools)
        // Track it so we can block stale tool_results from being sent later
        this.cliRejectedQuestions.add(event.id);
        debugLog("CliManager", "Tool auto-rejected by CLI", {
          toolId: event.id,
          isAskUserQuestion: event.isAskUserQuestion,
        });

        if (event.isAskUserQuestion) {
          // Clear pending question state since CLI already rejected it
          if (this.pendingQuestionId === event.id) {
            this.pendingQuestionId = null;
          }
          this.currentTurnQuestionIds.delete(event.id);
        }

        outputs.push({
          text: `Tool rejected by CLI: ${event.id}`,
          type: "system",
        });
        break;
      }

      case "done": {
        // NOTE: Do NOT clear currentTurnQuestionIds or pendingQuestionId here.
        // A done event with stop_reason="tool_use" fires when Claude requests a
        // tool result (e.g. AskUserQuestion). Clearing question state at this
        // point would prevent the user from answering. These are already cleaned
        // up by sendToolResult(), clear(), and kill().

        // Reset turn flag - allow answering questions in next turn
        this.hasAnsweredQuestionThisTurn = false;
        debugLog("CliManager", "Turn ended - reset question answer flag", {
          pendingQuestionId: this.pendingQuestionId,
          currentTurnQuestions: Array.from(this.currentTurnQuestionIds),
        });

        outputs.push({
          text: "",
          type: "exit",
          exitCode: 0,
        });
        break;
      }
    }

    return outputs;
  }

  /**
   * Extract question data from AskUserQuestion tool input
   */
  private extractQuestionData(toolUseID: string, input: any): QuestionData {
    return {
      toolUseID,
      questions: input.questions || [],
    };
  }

  /**
   * Extract metadata from tool result content
   * TODO: CLI should provide this in structured format
   */
  private extractResultMetadata(_content: string): Partial<OutputLine> {
    // For now, return empty metadata
    // In the future, CLI can include token/cost data in JSON format
    return {};
  }

  /**
   * Send a tool result back to the CLI via stdin
   */
  sendToolResult(toolId: string, result: string): void {
    debugLog("CliManager", "sendToolResult called", {
      toolId,
      resultLength: result.length,
    });

    // Log EVERY call to sendToolResult with stack trace to debug duplicates
    console.log(
      `[CliManager] sendToolResult called: toolId=${toolId}, result=${result.substring(0, 100)}`,
    );
    console.log(`[CliManager] Call stack:`, new Error().stack);

    if (!this.currentHandle) {
      debugLog(
        "CliManager",
        "ERROR: Cannot send tool result - no active handle",
      );
      console.error("[CliManager] Cannot send tool result - no active handle");
      return;
    }

    // Safety net: prevent sending tool_results for questions the CLI already auto-rejected
    // This happens when AskUserQuestion wasn't in --allowedTools — the CLI rejects instantly,
    // but the TUI may still show the question UI. Sending a stale answer causes 400 errors.
    if (this.cliRejectedQuestions.has(toolId)) {
      debugLog(
        "CliManager",
        "Tool result blocked - question was auto-rejected by CLI",
        { toolId },
      );

      this.conversationLogger.log({
        timestamp: new Date().toISOString(),
        type: "tool_result_blocked",
        toolId,
        result,
        reason: "Question was auto-rejected by CLI (not in --allowedTools)",
      });

      return;
    }

    // CRITICAL: Only allow ONE tool_result per turn to prevent Claude CLI replay bug
    // When Claude calls AskUserQuestion multiple times, only answer the FIRST one
    // Answering multiple questions causes the last tool_result to be replayed in subsequent requests
    if (this.hasAnsweredQuestionThisTurn) {
      debugLog(
        "CliManager",
        "WARNING: Already answered question this turn - ignoring to prevent 400 error",
        {
          toolId,
          reason: "Only one tool_result allowed per turn",
        },
      );

      // Log to conversation log
      this.conversationLogger.log({
        timestamp: new Date().toISOString(),
        type: "tool_result_blocked",
        toolId,
        result,
        reason:
          "Already answered question this turn (only one per turn allowed)",
      });

      // CRITICAL: Mark blocked questions as "sent" to prevent them from being answered later
      // This prevents 400 errors when blocked questions remain in UI and get answered in future turns
      this.sentToolResults.add(toolId);
      debugLog(
        "CliManager",
        "Marked blocked question as sent to prevent future answers",
        { toolId },
      );

      return;
    }

    // Check if this tool result has already been sent (prevent duplicates)
    if (this.sentToolResults.has(toolId)) {
      debugLog(
        "CliManager",
        "WARNING: Tool result already sent - ignoring duplicate",
        {
          toolId,
          alreadySent: Array.from(this.sentToolResults),
        },
      );

      // Log to conversation log
      this.conversationLogger.log({
        timestamp: new Date().toISOString(),
        type: "tool_result_duplicate",
        toolId,
        result,
        reason: "Already sent",
      });

      return;
    }

    debugLog("CliManager", "Sending tool result to handle", {
      toolId,
      resultPreview: result.substring(0, 200),
      currentPendingQuestionId: this.pendingQuestionId,
    });

    // Log tool result being sent
    this.conversationLogger.log({
      timestamp: new Date().toISOString(),
      type: "tool_result_sent",
      toolId,
      result,
    });

    this.currentHandle.sendToolResult(toolId, result);

    // Mark that we've answered a question this turn
    this.hasAnsweredQuestionThisTurn = true;
    debugLog("CliManager", "Set hasAnsweredQuestionThisTurn = true");

    // Mark this tool result as sent
    this.sentToolResults.add(toolId);

    // DO NOT remove from currentTurnQuestionIds - keep it to block subsequent questions!
    // The set will be cleared when the turn ends
    debugLog(
      "CliManager",
      "Question answered but keeping in currentTurnQuestionIds to block duplicates",
      {
        toolId,
        currentTurnQuestions: Array.from(this.currentTurnQuestionIds),
      },
    );

    // Clear pending question ID if this was the tracked question
    if (this.pendingQuestionId === toolId) {
      debugLog("CliManager", "Clearing pendingQuestionId", { toolId });
      this.pendingQuestionId = null;
    }

    debugLog("CliManager", "Tool result sent successfully", { toolId });
  }

  /**
   * Send a message to the CLI
   */
  sendMessage(message: string): void {
    if (!this.currentHandle) {
      console.error("[CliManager] Cannot send message - no active handle");
      return;
    }

    // For bidirectional mode, messages are sent as tool results
    // or via stdin depending on the CLI mode
    console.log("[CliManager] sendMessage not yet implemented:", message);
  }

  /**
   * Send a message to the active agent session
   * Used in persistent plan/build modes for follow-up messages
   *
   * NOTE: This currently just returns the conversation history context.
   * The actual re-execution is handled by the caller which will pass
   * this context to execute(). This is a workaround until the CLI
   * supports proper bidirectional chat mode.
   *
   * TODO: Implement proper chat mode when Claude CLI supports it
   */
  getConversationContext(): string {
    if (this.conversationHistory.length === 0) {
      return "";
    }

    const historyContext = this.conversationHistory
      .map(
        (msg) =>
          `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`,
      )
      .join("\n\n");

    return `\n\nPREVIOUS CONVERSATION:\n${historyContext}\n\nContinue the conversation with context from above.`;
  }

  /**
   * Send a message to the active agent session
   * This continues the conversation by sending a user message via stdin
   */
  async sendMessageToAgent(message: string): Promise<void> {
    if (!this.hasActiveSession()) {
      throw new Error("No active agent session");
    }

    if (!this.currentHandle) {
      throw new Error("No active CLI handle");
    }

    // Block free-text messages while a question (AskUserQuestion) is pending.
    // Sending a plain user message while a tool_use is awaiting a tool_result
    // causes the Claude API to receive duplicate tool_result blocks (the message
    // gets interpreted as a response, then the actual answer sends another),
    // resulting in a 400 error that puts the conversation out of sync.
    if (this.pendingQuestionId) {
      debugLog("CliManager", "Rejecting message — question pending", {
        pendingQuestionId: this.pendingQuestionId,
        message: message.substring(0, 50),
      });
      return;
    }

    // Add message to history
    this.conversationHistory.push({ role: "user", content: message });

    debugLog("CliManager", "Sending message to agent via stdin", {
      message: message.substring(0, 100),
      historyLength: this.conversationHistory.length,
    });

    // Send the user message to CLI via stdin using the handle's sendMessage method
    this.currentHandle.sendMessage(message);

    // Log the message to conversation log
    this.conversationLogger.log({
      timestamp: new Date().toISOString(),
      type: "user_message_sent",
      message: message,
    });

    debugLog("CliManager", "Message sent to agent successfully");
  }

  /**
   * Check if there's an active agent session
   */
  hasActiveSession(): boolean {
    return !!(this.currentHandle && this.activeMode);
  }

  /**
   * Get the current active mode
   */
  getActiveMode(): "plan" | "build" | "review" | null {
    return this.hasActiveSession() ? this.activeMode : null;
  }

  /**
   * Kill the running CLI process
   */
  kill(): void {
    if (this.currentHandle) {
      this.currentHandle.kill();
      this.currentHandle = null;
      this.activeMode = null;
      this.pendingQuestionId = null;
      this.emit("killed");
    }
  }

  /**
   * Stop the CLI process without emitting "killed" event.
   * Used by the build loop when a completion marker is detected —
   * the process needs to stop but the loop should continue, not reset.
   */
  stopForIteration(): void {
    if (this.currentHandle) {
      debugLog("CliManager", "Stopping process for iteration (no kill event)");
      this.stoppingForIteration = true;
      this.currentHandle.kill();
      this.currentHandle = null;
      this.activeMode = null;
      this.pendingQuestionId = null;
      // Do NOT emit "killed" — "complete" is emitted from the execute() finally block
    }
  }

  /**
   * Interrupt the CLI process (Ctrl+C)
   */
  interrupt(): void {
    this.kill(); // For now, same as kill
  }

  /**
   * Clear all tracked state (useful when starting new session)
   */
  clear(): void {
    this.toolTimings.clear();
    this.toolNames.clear();
    this.toolInputs.clear();
    this.diffDetector.clear();
    this.subagentTracker.clear();
    this.conversationHistory = [];
    this.pendingQuestionId = null;
    this.currentTurnQuestionIds.clear();
    this.sentToolResults.clear();
    this.cliRejectedQuestions.clear();
    this.hasAnsweredQuestionThisTurn = false;
    this.accumulatedText = "";
  }

  /**
   * Get active subagents
   */
  getActiveSubagents() {
    return this.subagentTracker.getActiveSubagents();
  }
}
