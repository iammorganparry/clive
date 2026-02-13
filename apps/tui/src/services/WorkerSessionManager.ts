/**
 * WorkerSessionManager
 *
 * Manages Claude CLI sessions for worker mode.
 * Uses ClaudeCliService for -p mode (print/structured output).
 * Routes events between central service and local CLI.
 */

import { EventEmitter } from "node:events";
import {
  type ClaudeCliEvent,
  ClaudeCliService,
  type CliExecutionHandle,
} from "@clive/claude-services";
import type {
  InterviewEvent,
  InterviewEventPayload,
  InterviewRequest,
  QuestionData,
} from "@clive/worker-protocol";
import { Effect, type Runtime, Stream } from "effect";
import { loadCommand } from "../utils/command-loader";
import type { WorktreeManager } from "./WorktreeManager";

/**
 * Session mode type
 */
export type SessionMode = 'plan' | 'build' | 'review';

/**
 * Get system prompt for the given session mode.
 * Loads the full prompt from command files (plan.md, build.md, review.md)
 * instead of using hardcoded skill-invocation wrappers.
 * @internal Exported for testing
 */
export function getSystemPromptForMode(mode: SessionMode, workspaceRoot?: string): string {
  const command = loadCommand(mode, workspaceRoot);
  if (command) {
    return command.content;
  }
  // Fallback if command file not found
  return `You are in ${mode} mode. Follow the ${mode} workflow.`;
}

/**
 * Get default model for the given session mode.
 * All modes use opus for comprehensive capability.
 * @internal Exported for testing
 */
export function getModelForMode(_mode: SessionMode): string {
  return 'opus';
}

/**
 * Chat message type for UI display
 */
export interface ChatMessage {
  id: string;
  type: "user" | "assistant" | "system" | "question" | "error";
  content: string;
  timestamp: Date;
  questionData?: QuestionData;
}

/**
 * Active session information
 */
interface ActiveSession {
  sessionId: string;
  handle: CliExecutionHandle;
  startedAt: Date;
  messages: ChatMessage[];
  worktreePath?: string;
  mode?: SessionMode;
}

/**
 * Event types emitted by WorkerSessionManager
 */
export interface WorkerSessionManagerEvents {
  message: (sessionId: string, message: ChatMessage) => void;
  question: (sessionId: string, questionData: QuestionData) => void;
  complete: (sessionId: string) => void;
  error: (sessionId: string, error: string) => void;
}

/**
 * Worker session manager for CLI execution
 */
export class WorkerSessionManager extends EventEmitter {
  private runtime: Runtime.Runtime<ClaudeCliService>;
  private activeSessions = new Map<string, ActiveSession>();
  private workspaceRoot: string;
  private worktreeManager?: WorktreeManager;

  constructor(workspaceRoot: string, worktreeManager?: WorktreeManager) {
    super();
    this.workspaceRoot = workspaceRoot;
    this.worktreeManager = worktreeManager;

    // Create Effect runtime with ClaudeCliService
    const layer = ClaudeCliService.Default;
    this.runtime = Effect.runSync(
      Effect.gen(function* () {
        return yield* Effect.runtime<ClaudeCliService>();
      }).pipe(Effect.provide(layer)),
    );
  }

  /**
   * Start an interview session
   */
  async startInterview(
    request: InterviewRequest,
    onEvent: (event: InterviewEvent) => void,
  ): Promise<void> {
    const { sessionId, initialPrompt } = request;
    // Map protocol SessionMode (which includes "greeting") to local SessionMode
    const mode: SessionMode = (request.mode === 'greeting' || !request.mode) ? 'plan' : request.mode as SessionMode;

    console.log(`[WorkerSessionManager] Starting ${mode} session ${sessionId}`);

    // If a session with this ID already exists (e.g., follow-up mention in same thread),
    // clean it up first before starting a new one
    if (this.activeSessions.has(sessionId)) {
      console.log(`[WorkerSessionManager] Cleaning up existing session ${sessionId} before starting new one`);
      this.cancelSession(sessionId);
    }

    // Build the user prompt based on mode
    const userPromptContent = mode === 'build'
      ? 'Execute the next pending task from Claude Tasks.'
      : mode === 'review'
      ? 'Review the completed work against acceptance criteria.'
      : initialPrompt || 'Help me plan a new feature.';

    // Initialize session with user message
    const userMessage: ChatMessage = {
      id: `${sessionId}-user-0`,
      type: "user",
      content: initialPrompt || "Help me plan a new feature.",
      timestamp: new Date(),
    };

    // Get the prompt to send to Claude based on mode
    const prompt = mode === 'build'
      ? 'Execute the next pending task from Claude Tasks.'
      : mode === 'review'
      ? 'Review the completed work against acceptance criteria.'
      : initialPrompt
      ? `Plan the following: ${initialPrompt}`
      : "Help me plan a new feature. What would you like to build?";

    // Create worktree for session isolation if worktree manager is available
    let worktreePath: string | undefined;
    if (this.worktreeManager) {
      try {
        worktreePath = this.worktreeManager.create(sessionId);
        console.log(`[WorkerSessionManager] Created worktree for ${sessionId} at ${worktreePath}`);
      } catch (error) {
        console.warn(`[WorkerSessionManager] Failed to create worktree for ${sessionId}, using main workspace:`, error);
      }
    }

    const effectiveWorkspaceRoot = worktreePath || this.workspaceRoot;

    const command = loadCommand(mode, effectiveWorkspaceRoot);
    const systemPrompt = command?.content || getSystemPromptForMode(mode, effectiveWorkspaceRoot);
    const modelToUse = request.model || command?.metadata.model;
    const allowedTools = command?.metadata.allowedTools;
    const disallowedTools = command?.metadata.deniedTools;

    const program = Effect.gen(
      this.createExecutionProgram(
        sessionId,
        prompt,
        modelToUse,
        systemPrompt,
        onEvent,
        [userMessage],
        allowedTools,
        disallowedTools,
        worktreePath,
        mode,
      ),
    );

    try {
      await Effect.runPromise(
        program.pipe(Effect.provide(ClaudeCliService.Default)),
      );
    } catch (error) {
      console.error(
        `[WorkerSessionManager] Interview ${sessionId} failed:`,
        error,
      );
      this.emitInterviewEvent(
        sessionId,
        {
          type: "error",
          message: String(error),
        },
        onEvent,
      );
      this.activeSessions.delete(sessionId);
    }
  }

  /**
   * Create the execution program generator
   */
  private createExecutionProgram(
    sessionId: string,
    prompt: string,
    model: string | undefined,
    systemPrompt: string,
    onEvent: (event: InterviewEvent) => void,
    initialMessages: ChatMessage[],
    allowedTools?: string[],
    disallowedTools?: string[],
    worktreePath?: string,
    mode?: SessionMode,
  ) {
    const self = this;

    return function* () {
      const cliService = yield* ClaudeCliService;

      const handle = yield* cliService.execute({
        prompt,
        systemPrompt,
        workspaceRoot: worktreePath || self.workspaceRoot,
        model,
        allowedTools,
        disallowedTools,
      });

      const session: ActiveSession = {
        sessionId,
        handle,
        startedAt: new Date(),
        messages: [...initialMessages],
        worktreePath,
        mode,
      };
      self.activeSessions.set(sessionId, session);

      console.log(
        `[WorkerSessionManager] CLI process started for session ${sessionId}`,
      );

      // Emit initial user message
      self.emit("message", sessionId, initialMessages[0]);

      yield* handle.stream.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            self.processEvent(sessionId, event, onEvent);
          }),
        ),
      );

      // Cleanup after stream ends
      const completedSession = self.activeSessions.get(sessionId);
      if (completedSession?.worktreePath && self.worktreeManager) {
        try {
          self.worktreeManager.remove(sessionId);
        } catch (error) {
          console.warn(`[WorkerSessionManager] Failed to remove worktree for ${sessionId}:`, error);
        }
      }
      self.activeSessions.delete(sessionId);
      console.log(`[WorkerSessionManager] Session ${sessionId} completed`);
    };
  }

  /**
   * Process CLI event and emit chat messages + interview events
   */
  private processEvent(
    sessionId: string,
    event: ClaudeCliEvent,
    onEvent: (event: InterviewEvent) => void,
  ): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    console.log(`[WorkerSessionManager] Event for ${sessionId}: ${event.type}`);

    switch (event.type) {
      case "tool_use": {
        if (event.name === "AskUserQuestion") {
          const input = event.input as {
            questions?: Array<{
              header: string;
              question: string;
              options: Array<{ label: string; description: string }>;
              multiSelect?: boolean;
            }>;
          };

          const questionData: QuestionData = {
            toolUseID: event.id,
            questions: (input.questions || []).map((q) => ({
              header: q.header,
              question: q.question,
              options: q.options || [],
              multiSelect: q.multiSelect || false,
            })),
          };

          // Create chat message for question
          const questionMessage: ChatMessage = {
            id: `${sessionId}-question-${event.id}`,
            type: "question",
            content: questionData.questions.map((q) => q.question).join("\n"),
            timestamp: new Date(),
            questionData,
          };
          session.messages.push(questionMessage);
          this.emit("message", sessionId, questionMessage);
          this.emit("question", sessionId, questionData);

          this.emitInterviewEvent(
            sessionId,
            {
              type: "question",
              data: questionData,
            },
            onEvent,
          );
        }
        break;
      }

      case "text": {
        const assistantMessage: ChatMessage = {
          id: `${sessionId}-assistant-${Date.now()}`,
          type: "assistant",
          content: event.content,
          timestamp: new Date(),
        };
        session.messages.push(assistantMessage);
        this.emit("message", sessionId, assistantMessage);

        // Check for plan content
        if (
          event.content.includes("## Plan") ||
          event.content.includes("# Plan")
        ) {
          this.emitInterviewEvent(
            sessionId,
            {
              type: "plan_ready",
              content: event.content,
            },
            onEvent,
          );
        } else {
          this.emitInterviewEvent(
            sessionId,
            {
              type: "text",
              content: event.content,
            },
            onEvent,
          );
        }
        break;
      }

      case "tool_result": {
        const content = event.content;
        if (
          content.includes("linear.app") ||
          content.includes("Issue created")
        ) {
          const urlMatch = content.match(/https:\/\/linear\.app\/[^\s]+/g);
          if (urlMatch) {
            this.emitInterviewEvent(
              sessionId,
              {
                type: "issues_created",
                urls: urlMatch,
              },
              onEvent,
            );
          }
        }

        // Detect GitHub PR URLs
        const prMatch = content.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/g);
        if (prMatch && prMatch.length > 0) {
          this.emitInterviewEvent(sessionId, {
            type: 'pr_created',
            url: prMatch[0],
          }, onEvent);
        }
        break;
      }

      case "error": {
        const errorMessage: ChatMessage = {
          id: `${sessionId}-error-${Date.now()}`,
          type: "error",
          content: event.message,
          timestamp: new Date(),
        };
        session.messages.push(errorMessage);
        this.emit("message", sessionId, errorMessage);
        this.emit("error", sessionId, event.message);

        this.emitInterviewEvent(
          sessionId,
          {
            type: "error",
            message: event.message,
          },
          onEvent,
        );
        break;
      }

      case "done": {
        this.emit("complete", sessionId);
        this.emitInterviewEvent(
          sessionId,
          {
            type: "complete",
          },
          onEvent,
        );
        break;
      }
    }
  }

  /**
   * Emit an interview event to the central service
   */
  private emitInterviewEvent(
    sessionId: string,
    payload: InterviewEventPayload,
    onEvent: (event: InterviewEvent) => void,
  ): void {
    const event: InterviewEvent = {
      sessionId,
      type: payload.type,
      payload,
      timestamp: new Date().toISOString(),
    };
    onEvent(event);
  }

  /**
   * Send an answer to a session
   * Returns true if successful, false if the session failed
   */
  sendAnswer(
    sessionId: string,
    toolUseId: string,
    answers: Record<string, string>,
  ): boolean {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      console.error(
        `[WorkerSessionManager] No session ${sessionId} for answer`,
      );
      return false;
    }

    console.log(`[WorkerSessionManager] Sending answer for ${toolUseId}`);

    // Add user answer as chat message
    const answerContent = Object.entries(answers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    const userMessage: ChatMessage = {
      id: `${sessionId}-user-${Date.now()}`,
      type: "user",
      content: answerContent,
      timestamp: new Date(),
    };
    session.messages.push(userMessage);
    this.emit("message", sessionId, userMessage);

    try {
      const answerJson = JSON.stringify(answers);
      session.handle.sendToolResult(toolUseId, answerJson);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[WorkerSessionManager] Failed to send answer for session ${sessionId}: ${errorMessage}`);

      // Emit error event so WorkerConnectionManager can notify central service
      this.emit("error", sessionId, errorMessage);

      // Clean up the failed session
      this.cancelSession(sessionId);
      return false;
    }
  }

  /**
   * Send a message to a session
   * Returns true if successful, false if the session failed
   */
  sendMessage(sessionId: string, message: string): boolean {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      console.error(
        `[WorkerSessionManager] No session ${sessionId} for message`,
      );
      return false;
    }

    console.log(`[WorkerSessionManager] Sending message to ${sessionId}`);

    // Add user message
    const userMessage: ChatMessage = {
      id: `${sessionId}-user-${Date.now()}`,
      type: "user",
      content: message,
      timestamp: new Date(),
    };
    session.messages.push(userMessage);
    this.emit("message", sessionId, userMessage);

    try {
      session.handle.sendMessage(message);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[WorkerSessionManager] Failed to send message for session ${sessionId}: ${errorMessage}`);

      // Emit error event so WorkerConnectionManager can notify central service
      this.emit("error", sessionId, errorMessage);

      // Clean up the failed session
      this.cancelSession(sessionId);
      return false;
    }
  }

  /**
   * Cancel a session
   */
  cancelSession(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    console.log(`[WorkerSessionManager] Cancelling session ${sessionId}`);
    try {
      session.handle.kill();
    } catch {
      // Ignore errors during cleanup
    }

    // Clean up worktree if one was created
    if (session.worktreePath && this.worktreeManager) {
      try {
        this.worktreeManager.remove(sessionId);
      } catch (error) {
        console.warn(`[WorkerSessionManager] Failed to remove worktree for ${sessionId}:`, error);
      }
    }

    this.activeSessions.delete(sessionId);
  }

  /**
   * Get messages for a session
   */
  getMessages(sessionId: string): ChatMessage[] {
    return this.activeSessions.get(sessionId)?.messages || [];
  }

  /**
   * Get active session IDs
   */
  getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  /**
   * Get active session count
   */
  get activeSessionCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Get the worktree path for a session
   */
  getWorktreePath(sessionId: string): string | undefined {
    return this.activeSessions.get(sessionId)?.worktreePath;
  }

  /**
   * Get the mode for a session
   */
  getMode(sessionId: string): SessionMode | undefined {
    return this.activeSessions.get(sessionId)?.mode;
  }

  /**
   * Close all sessions
   */
  closeAll(): void {
    for (const sessionId of this.activeSessions.keys()) {
      this.cancelSession(sessionId);
    }
  }
}
