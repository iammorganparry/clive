/**
 * Local Executor
 *
 * Wraps ClaudeCliService for executing interviews locally.
 * Streams events back to the central service via callback.
 */

import { randomUUID } from "node:crypto";
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
 * Planning skill system prompt
 */
const PLANNING_SKILL_PROMPT = `# Clive Plan Mode

You are the plan mode wrapper for Clive.

**CRITICAL INSTRUCTION:** You MUST immediately invoke the /clive:plan skill.
DO NOT implement planning yourself. The skill handles all planning logic.

## Your Only Action

Use the Skill tool NOW to invoke /clive:plan with the user's request.

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
 * Active interview session
 */
interface ActiveSession {
  sessionId: string;
  handle: CliExecutionHandle;
  startedAt: Date;
  /** Claude CLI session ID for resume support */
  claudeSessionId?: string;
}

/**
 * Local executor for interview execution
 */
export class LocalExecutor extends EventEmitter {
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
    const { sessionId, initialPrompt, claudeSessionId: resumeSessionId } = request;

    console.log(`[LocalExecutor] Starting interview ${sessionId}${resumeSessionId ? ` (resuming ${resumeSessionId})` : ""}`);

    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    const prompt = initialPrompt
      ? `Plan the following: ${initialPrompt}`
      : "Help me plan a new feature. What would you like to build?";

    // Generate a new Claude session ID if not resuming
    const claudeSessionId = resumeSessionId || randomUUID();

    const program = Effect.gen(
      this.createExecutionProgram(
        sessionId,
        prompt,
        request.model || "opus",
        onEvent,
        claudeSessionId,
        resumeSessionId,
      ),
    );

    try {
      await Effect.runPromise(
        program.pipe(Effect.provide(ClaudeCliService.Default)),
      );
    } catch (error) {
      console.error(`[LocalExecutor] Interview ${sessionId} failed:`, error);
      this.emitEvent(
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
    claudeSessionId: string,
    resumeSessionId?: string,
  ) {
    const self = this;

    return function* () {
      const cliService = yield* ClaudeCliService;

      const handle = yield* cliService.execute({
        prompt,
        systemPrompt: PLANNING_SKILL_PROMPT,
        workspaceRoot: self.workspaceRoot,
        model,
        resumeSessionId,
      });

      self.activeSessions.set(sessionId, {
        sessionId,
        handle,
        startedAt: new Date(),
        claudeSessionId,
      });

      console.log(
        `[LocalExecutor] CLI process started for session ${sessionId}${resumeSessionId ? ` (resumed from ${resumeSessionId})` : ` (new session ${claudeSessionId})`}`,
      );

      // Emit session_started event so central service can track the Claude session ID
      self.emitEvent(
        sessionId,
        {
          type: "session_started",
          claudeSessionId,
        },
        onEvent,
      );

      yield* handle.stream.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            self.processEvent(sessionId, event, onEvent);
          }),
        ),
      );

      // Cleanup after stream ends
      self.activeSessions.delete(sessionId);
      console.log(`[LocalExecutor] Session ${sessionId} completed`);
    };
  }

  /**
   * Process CLI event and emit interview event
   */
  private processEvent(
    sessionId: string,
    event: ClaudeCliEvent,
    onEvent: (event: InterviewEvent) => void,
  ): void {
    console.log(`[LocalExecutor] Event for ${sessionId}: ${event.type}`);

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

          this.emitEvent(
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
        if (
          event.content.includes("## Plan") ||
          event.content.includes("# Plan")
        ) {
          this.emitEvent(
            sessionId,
            {
              type: "plan_ready",
              content: event.content,
            },
            onEvent,
          );
        } else {
          this.emitEvent(
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
            this.emitEvent(
              sessionId,
              {
                type: "issues_created",
                urls: urlMatch,
              },
              onEvent,
            );
          }
        }
        break;
      }

      case "error": {
        this.emitEvent(
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
        this.emitEvent(
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
   * Emit an interview event
   */
  private emitEvent(
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
      console.error(`[LocalExecutor] No session ${sessionId} for answer`);
      return;
    }

    console.log(`[LocalExecutor] Sending answer for ${toolUseId}`);
    const answerJson = JSON.stringify(answers);
    session.handle.sendToolResult(toolUseId, answerJson);
  }

  /**
   * Send a message to a session
   */
  sendMessage(sessionId: string, message: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      console.error(`[LocalExecutor] No session ${sessionId} for message`);
      return;
    }

    console.log(`[LocalExecutor] Sending message to ${sessionId}`);
    session.handle.sendMessage(message);
  }

  /**
   * Cancel a session
   */
  cancelSession(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return;
    }

    console.log(`[LocalExecutor] Cancelling session ${sessionId}`);
    try {
      session.handle.kill();
    } catch {
      // Ignore errors during cleanup
    }
    this.activeSessions.delete(sessionId);
  }

  /**
   * Get active session IDs
   */
  getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  /**
   * Get Claude session ID for a session
   */
  getClaudeSessionId(sessionId: string): string | undefined {
    return this.activeSessions.get(sessionId)?.claudeSessionId;
  }

  /**
   * Get active session count
   */
  get activeSessionCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Set the workspace root for subsequent interviews
   */
  setWorkspace(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Get current workspace root
   */
  getWorkspace(): string {
    return this.workspaceRoot;
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
