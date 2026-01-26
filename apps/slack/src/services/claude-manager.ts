/**
 * Claude Manager
 *
 * Bridge to Claude CLI for executing planning interviews.
 * Handles spawning CLI, streaming events, and routing answers.
 */

import { EventEmitter } from "node:events";
import {
  type ClaudeCliEvent,
  ClaudeCliService,
  type CliExecutionHandle,
} from "@clive/claude-services";
import { Data, Effect, type Runtime, Stream } from "effect";
import type {
  AnswerPayload,
  InterviewEvent,
  QuestionData,
} from "../store/types";

/**
 * Error when ClaudeManager operations fail
 */
export class ClaudeManagerError extends Data.TaggedError("ClaudeManagerError")<{
  message: string;
  operation: "start_interview" | "start_greeting";
  cause?: unknown;
}> {}

/**
 * Greeting/conversational system prompt
 * For initial conversational interaction before entering plan mode
 */
const GREETING_PROMPT = `You are Clive, a friendly AI assistant for software development.

Greet the user warmly and ask how you can help them today. You can help with:
- Planning new features (say "let's plan" or describe what you want to build)
- Fixing bugs (describe the issue)
- Code reviews
- General questions about the codebase

Keep responses brief and friendly. When the user describes a feature or bug to work on, respond with: "Great! Let me start a planning session for that." and then invoke the /clive:plan skill.

Do NOT immediately start planning. Have a brief conversation first.`;

/**
 * Planning skill system prompt
 * Invokes the /clive:plan skill for conducting interviews
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
 * Claude Manager for interview execution
 */
export class ClaudeManager extends EventEmitter {
  private runtime: Runtime.Runtime<ClaudeCliService>;
  private activeHandles = new Map<string, CliExecutionHandle>();
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
   * Start a planning interview session
   *
   * @param threadTs - Slack thread timestamp (session identifier)
   * @param initialPrompt - Initial user request/description
   * @param onEvent - Callback for interview events
   * @returns Effect yielding Claude CLI execution handle
   */
  startInterview(
    threadTs: string,
    initialPrompt: string,
    onEvent: (event: InterviewEvent) => void,
  ): Effect.Effect<CliExecutionHandle, ClaudeManagerError> {
    return Effect.gen(this, function* () {
      console.log(`[ClaudeManager] Starting interview for thread ${threadTs}`);

      // Build the prompt
      const prompt = initialPrompt
        ? `Plan the following: ${initialPrompt}`
        : "Help me plan a new feature. What would you like to build?";

      const program = Effect.gen(
        this.createExecutionProgram(threadTs, prompt, onEvent),
      );

      const handle = yield* program.pipe(
        Effect.provide(ClaudeCliService.Default),
        Effect.catchAll((error) =>
          Effect.gen(this, function* () {
            console.error(`[ClaudeManager] Failed to start interview:`, error);
            onEvent({
              type: "error",
              message: `Failed to start interview: ${String(error)}`,
            });
            return yield* Effect.fail(
              new ClaudeManagerError({
                message: `Failed to start interview: ${String(error)}`,
                operation: "start_interview",
                cause: error,
              }),
            );
          }),
        ),
      );

      this.activeHandles.set(threadTs, handle);
      return handle;
    });
  }

  /**
   * Start a greeting/conversational session
   *
   * @param threadTs - Slack thread timestamp (session identifier)
   * @param channel - Slack channel
   * @param userId - User who initiated
   * @param initialPrompt - Initial user message (if any)
   * @param onEvent - Callback for events
   * @returns Effect yielding Claude CLI execution handle
   */
  startGreeting(
    threadTs: string,
    _channel: string,
    _userId: string,
    initialPrompt: string | undefined,
    onEvent: (event: InterviewEvent) => void,
  ): Effect.Effect<CliExecutionHandle, ClaudeManagerError> {
    return Effect.gen(this, function* () {
      console.log(`[ClaudeManager] Starting greeting for thread ${threadTs}`);

      // Build the prompt
      const prompt = initialPrompt
        ? `The user mentioned you with: "${initialPrompt}"`
        : "The user mentioned you. Greet them and ask how you can help.";

      const program = Effect.gen(
        this.createGreetingProgram(threadTs, prompt, onEvent),
      );

      const handle = yield* program.pipe(
        Effect.provide(ClaudeCliService.Default),
        Effect.catchAll((error) =>
          Effect.gen(this, function* () {
            console.error(`[ClaudeManager] Failed to start greeting:`, error);
            onEvent({
              type: "error",
              message: `Failed to start greeting: ${String(error)}`,
            });
            return yield* Effect.fail(
              new ClaudeManagerError({
                message: `Failed to start greeting: ${String(error)}`,
                operation: "start_greeting",
                cause: error,
              }),
            );
          }),
        ),
      );

      this.activeHandles.set(threadTs, handle);
      return handle;
    });
  }

  /**
   * Create the greeting execution program generator
   */
  private createGreetingProgram(
    threadTs: string,
    prompt: string,
    onEvent: (event: InterviewEvent) => void,
  ) {
    const self = this;

    return function* () {
      const cliService = yield* ClaudeCliService;

      // Spawn CLI process with greeting prompt
      const handle = yield* cliService.execute({
        prompt,
        systemPrompt: GREETING_PROMPT,
        workspaceRoot: self.workspaceRoot,
        model: "sonnet", // Use Sonnet for conversational greeting
      });

      console.log(`[ClaudeManager] Greeting started for thread ${threadTs}`);

      // Process stream events
      yield* handle.stream.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            self.processEvent(event, onEvent);
          }),
        ),
      );

      return handle;
    };
  }

  /**
   * Create the execution program generator
   */
  private createExecutionProgram(
    threadTs: string,
    prompt: string,
    onEvent: (event: InterviewEvent) => void,
  ) {
    const self = this;

    return function* () {
      const cliService = yield* ClaudeCliService;

      // Spawn CLI process with planning skill
      const handle = yield* cliService.execute({
        prompt,
        systemPrompt: PLANNING_SKILL_PROMPT,
        workspaceRoot: self.workspaceRoot,
        model: "opus", // Use Opus for planning
      });

      console.log(`[ClaudeManager] CLI process started for thread ${threadTs}`);

      // Process stream events
      yield* handle.stream.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            self.processEvent(event, onEvent);
          }),
        ),
      );

      return handle;
    };
  }

  /**
   * Process CLI event and emit interview events
   */
  private processEvent(
    event: ClaudeCliEvent,
    onEvent: (event: InterviewEvent) => void,
  ): void {
    console.log(`[ClaudeManager] Processing event: ${event.type}`);

    switch (event.type) {
      case "tool_use": {
        if (event.name === "AskUserQuestion") {
          // Extract question data
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

          console.log(
            `[ClaudeManager] Question received: ${questionData.toolUseID}`,
          );
          onEvent({ type: "question", data: questionData });
        }
        break;
      }

      case "text": {
        // Check for plan content markers
        if (
          event.content.includes("## Plan") ||
          event.content.includes("# Plan")
        ) {
          onEvent({ type: "plan_ready", content: event.content });
        } else {
          onEvent({ type: "text", content: event.content });
        }
        break;
      }

      case "tool_result": {
        // Check for Linear issue creation results
        const content = event.content;
        if (
          content.includes("linear.app") ||
          content.includes("Issue created")
        ) {
          // Extract URLs from content
          const urlMatch = content.match(/https:\/\/linear\.app\/[^\s]+/g);
          if (urlMatch) {
            onEvent({ type: "issues_created", urls: urlMatch });
          }
        }
        break;
      }

      case "error": {
        onEvent({ type: "error", message: event.message });
        break;
      }

      case "done": {
        onEvent({ type: "complete" });
        break;
      }
    }
  }

  /**
   * Send answer to an interview question
   *
   * @param threadTs - Slack thread timestamp (session identifier)
   * @param toolUseId - Tool use ID to respond to
   * @param answers - Answers keyed by question header
   */
  sendAnswer(
    threadTs: string,
    toolUseId: string,
    answers: AnswerPayload,
  ): void {
    const handle = this.activeHandles.get(threadTs);
    if (!handle) {
      console.error(`[ClaudeManager] No active handle for thread ${threadTs}`);
      return;
    }

    console.log(`[ClaudeManager] Sending answer for ${toolUseId}:`, answers);

    // Format answer as JSON
    const answerJson = JSON.stringify(answers);
    handle.sendToolResult(toolUseId, answerJson);
  }

  /**
   * Send a follow-up message to the interview
   *
   * @param threadTs - Slack thread timestamp
   * @param message - User message
   */
  sendMessage(threadTs: string, message: string): void {
    const handle = this.activeHandles.get(threadTs);
    if (!handle) {
      console.error(`[ClaudeManager] No active handle for thread ${threadTs}`);
      return;
    }

    console.log(
      `[ClaudeManager] Sending message: ${message.substring(0, 100)}`,
    );
    handle.sendMessage(message);
  }

  /**
   * Get handle for a thread
   */
  getHandle(threadTs: string): CliExecutionHandle | undefined {
    return this.activeHandles.get(threadTs);
  }

  /**
   * Check if a thread has an active session
   */
  hasActiveSession(threadTs: string): boolean {
    return this.activeHandles.has(threadTs);
  }

  /**
   * Close a session
   */
  closeSession(threadTs: string): void {
    const handle = this.activeHandles.get(threadTs);
    if (handle) {
      try {
        handle.kill();
      } catch {
        // Ignore errors during cleanup
      }
      this.activeHandles.delete(threadTs);
      console.log(`[ClaudeManager] Closed session for thread ${threadTs}`);
    }
  }

  /**
   * Close all sessions
   */
  closeAll(): void {
    for (const threadTs of this.activeHandles.keys()) {
      this.closeSession(threadTs);
    }
  }

  /**
   * Get count of active sessions
   */
  get activeSessionCount(): number {
    return this.activeHandles.size;
  }
}
