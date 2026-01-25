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

/**
 * Session mode type
 */
export type SessionMode = 'plan' | 'build' | 'review';

/**
 * Planning skill system prompt
 * Invokes the /clive-plan skill for conducting interviews
 */
const PLANNING_SKILL_PROMPT = `# Clive Plan Mode

You are the plan mode wrapper for Clive.

**CRITICAL INSTRUCTION:** You MUST immediately invoke the /clive-plan skill.
DO NOT implement planning yourself. The skill handles all planning logic.

## Your Only Action

Use the Skill tool NOW to invoke /clive-plan with the user's request.

Let the skill handle:
- Stakeholder interviews (4 phases, one question at a time)
- Codebase research
- Plan generation with user stories
- Linear issue creation
- Claude Tasks creation

DO NOT:
- Ask questions yourself
- Research the codebase yourself
- Create Linear issues directly
- Write plans without using the skill`;

/**
 * Build skill system prompt
 * Invokes the /clive-build skill for task execution
 */
const BUILD_SKILL_PROMPT = `# Clive Build Mode

You are the build mode wrapper for Clive.

**CRITICAL INSTRUCTION:** You MUST immediately invoke the /clive-build skill.
DO NOT implement tasks yourself. The skill handles all execution logic.

## Your Only Action

Use the Skill tool NOW to invoke /clive-build.

Let the skill handle:
- Fetching next pending task from Claude Tasks
- Reading and applying global learnings
- Executing the task with proper patterns
- Updating Linear issue status
- Committing code with appropriate messages

DO NOT:
- Implement code yourself
- Manage tasks yourself
- Create commits directly`;

/**
 * Review skill system prompt
 * Invokes the /clive-review skill for work verification
 */
const REVIEW_SKILL_PROMPT = `# Clive Review Mode

You are the review mode wrapper for Clive.

**CRITICAL INSTRUCTION:** You MUST immediately invoke the /clive-review skill.
DO NOT review code yourself. The skill handles all verification logic.

## Your Only Action

Use the Skill tool NOW to invoke /clive-review.

Let the skill handle:
- Loading context from session files
- Code review against standards
- Acceptance criteria verification
- Browser testing with Playwright
- Gap analysis and task creation
- Comprehensive reporting

DO NOT:
- Review code yourself
- Create tasks directly
- Skip any verification phases`;

/**
 * Get system prompt for the given session mode
 */
function getSystemPromptForMode(mode: SessionMode): string {
  switch (mode) {
    case 'plan': return PLANNING_SKILL_PROMPT;
    case 'build': return BUILD_SKILL_PROMPT;
    case 'review': return REVIEW_SKILL_PROMPT;
  }
}

/**
 * Get default model for the given session mode
 * Plan uses opus for comprehensive research
 * Build uses sonnet for efficient execution
 * Review uses opus for thorough verification
 */
function getModelForMode(mode: SessionMode): string {
  return mode === 'build' ? 'sonnet' : 'opus';
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

  constructor(workspaceRoot: string) {
    super();
    this.workspaceRoot = workspaceRoot;

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
    const { sessionId, initialPrompt, mode = 'plan' } = request;

    console.log(`[WorkerSessionManager] Starting ${mode} session ${sessionId}`);

    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
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

    const program = Effect.gen(
      this.createExecutionProgram(
        sessionId,
        prompt,
        request.model || "opus",
        onEvent,
        [userMessage],
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
    model: string,
    onEvent: (event: InterviewEvent) => void,
    initialMessages: ChatMessage[],
  ) {
    const self = this;

    return function* () {
      const cliService = yield* ClaudeCliService;

      const handle = yield* cliService.execute({
        prompt,
        systemPrompt,
        workspaceRoot: self.workspaceRoot,
        model,
      });

      const session: ActiveSession = {
        sessionId,
        handle,
        startedAt: new Date(),
        messages: [...initialMessages],
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
   */
  sendAnswer(
    sessionId: string,
    toolUseId: string,
    answers: Record<string, string>,
  ): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      console.error(
        `[WorkerSessionManager] No session ${sessionId} for answer`,
      );
      return;
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

    const answerJson = JSON.stringify(answers);
    session.handle.sendToolResult(toolUseId, answerJson);
  }

  /**
   * Send a message to a session
   */
  sendMessage(sessionId: string, message: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      console.error(
        `[WorkerSessionManager] No session ${sessionId} for message`,
      );
      return;
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

    session.handle.sendMessage(message);
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
   * Close all sessions
   */
  closeAll(): void {
    for (const sessionId of this.activeSessions.keys()) {
      this.cancelSession(sessionId);
    }
  }
}
