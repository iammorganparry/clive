/**
 * Local Executor
 *
 * Wraps ClaudeCliService for executing interviews locally.
 * Streams events back to the central service via callback.
 */

import { execSync } from "node:child_process";
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
import type { WorktreeManager } from "./worktree-manager.js";

/**
 * Planning skill system prompt
 */
const PLANNING_SKILL_PROMPT = `# Clive Plan Mode

You are Clive, an AI planning agent. Help the user plan their feature or task.

## Your Workflow

1. **Understand the request** — Ask clarifying questions one at a time
2. **Research the codebase** — Explore relevant files and patterns
3. **Generate a plan** — Break work into user stories with acceptance criteria
4. **Create issues** — Use Linear to track the work
5. **Share your work** — Push your branch and create a PR

## Git Branch Safety Rules

**NEVER push to these branches:** main, master, production, prod
**ALWAYS work on your current clive/* feature branch.**

When you need to share your work:
1. Commit to the current branch (clive/*)
2. Push the current branch: \`git push -u origin HEAD\`
3. Create a PR: \`gh pr create --base main --title "..." --body "..."\`

NEVER run:
- \`git push origin main\`
- \`git checkout main && git push\`
- \`git push --force\` to any protected branch`;

/**
 * Build mode system prompt — tells the agent to execute tasks one at a time
 * with completion markers for the orchestrator's ralph loop.
 */
const BUILD_SYSTEM_PROMPT = `# Clive Build Mode

You are Clive, a build execution agent. Execute tasks ONE AT A TIME from Claude Tasks (linked to Linear issues).

## Your Workflow

1. **Fetch next task** — Use TaskList() to find the next pending, unblocked task
2. **Read context** — Load the task details and Linear issue description
3. **Implement** — Write code, tests, follow acceptance criteria
4. **Commit** — Git commit to the current branch (do NOT push yet)
5. **Update Linear** — Mark sub-task as Done via mcp__linear__update_issue
6. **Update Claude Task** — Mark as completed via TaskUpdate
7. **Emit completion marker** — See below

## Completion Protocol

After completing ONE task, emit EXACTLY ONE of these markers as the LAST thing you output:
- If more tasks remain: <promise>TASK_COMPLETE</promise>
- If ALL tasks are done: <promise>ALL_TASKS_COMPLETE</promise>

STOP IMMEDIATELY after emitting the marker. Do not output anything else.
Execute ONE task per invocation. The orchestrator controls the iteration loop.

## Git Branch Safety Rules

**NEVER push to these branches:** main, master, production, prod
**ALWAYS work on your current clive/* feature branch.**
Commit locally only. The orchestrator handles push + PR creation after all tasks complete.`;

/** Marker constants for build loop detection */
const TASK_COMPLETE_MARKER = "<promise>TASK_COMPLETE</promise>";
const ALL_TASKS_COMPLETE_MARKER = "<promise>ALL_TASKS_COMPLETE</promise>";

/** Maximum iterations for a build loop */
const MAX_BUILD_ITERATIONS = 10;

/** Delay between build iterations (ms) */
const BUILD_ITERATION_DELAY = 1500;

/**
 * Active interview session
 */
interface ActiveSession {
  sessionId: string;
  handle: CliExecutionHandle;
  startedAt: Date;
  /** Claude CLI session ID for resume support */
  claudeSessionId?: string;
  /** Worktree path if using per-session worktrees */
  worktreePath?: string;
}

/**
 * Local executor for interview execution
 */
export class LocalExecutor extends EventEmitter {
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
    const { sessionId, initialPrompt, claudeSessionId: resumeSessionId, mode } = request;
    const effectiveMode = mode ?? "plan";

    console.log(`[LocalExecutor] Starting interview ${sessionId} (mode=${effectiveMode})${resumeSessionId ? ` (resuming ${resumeSessionId})` : ""}`);

    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    // Create session worktree if manager is available
    let sessionWorkspace = this.workspaceRoot;
    let worktreePath: string | undefined;
    if (this.worktreeManager) {
      try {
        worktreePath = this.worktreeManager.create(sessionId);
        sessionWorkspace = worktreePath;
      } catch (error) {
        console.error(
          `[LocalExecutor] Failed to create worktree for ${sessionId}:`,
          error,
        );
        // Fall back to main workspace
      }
    }

    // Select system prompt and initial prompt based on mode
    const systemPrompt = effectiveMode === "build"
      ? BUILD_SYSTEM_PROMPT
      : PLANNING_SKILL_PROMPT;

    const prompt = effectiveMode === "build"
      ? initialPrompt || "Execute the next pending task from Claude Tasks."
      : initialPrompt
        ? `Plan the following: ${initialPrompt}`
        : "Help me plan a new feature. What would you like to build?";

    // Build mode: run the ralph loop (multiple iterations)
    if (effectiveMode === "build") {
      await this.runBuildLoop(
        sessionId,
        prompt,
        systemPrompt,
        request,
        onEvent,
        sessionWorkspace,
        worktreePath,
      );
      return;
    }

    // Plan mode: single execution (existing flow)
    const claudeSessionId = resumeSessionId || randomUUID();

    const program = Effect.gen(
      this.createExecutionProgram(
        sessionId,
        prompt,
        systemPrompt,
        request.model || "opus",
        onEvent,
        claudeSessionId,
        resumeSessionId,
        sessionWorkspace,
        worktreePath,
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
      this.cleanupSession(sessionId);
    }
  }

  /**
   * Create the execution program generator
   */
  private createExecutionProgram(
    sessionId: string,
    prompt: string,
    systemPrompt: string,
    model: string,
    onEvent: (event: InterviewEvent) => void,
    claudeSessionId: string,
    resumeSessionId?: string,
    sessionWorkspace?: string,
    worktreePath?: string,
  ) {
    const self = this;

    return function* () {
      const cliService = yield* ClaudeCliService;

      const handle = yield* cliService.execute({
        prompt,
        systemPrompt,
        workspaceRoot: sessionWorkspace || self.workspaceRoot,
        model,
        resumeSessionId,
      });

      self.activeSessions.set(sessionId, {
        sessionId,
        handle,
        startedAt: new Date(),
        claudeSessionId,
        worktreePath,
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
      self.cleanupSession(sessionId);
      console.log(`[LocalExecutor] Session ${sessionId} completed`);
    };
  }

  /**
   * Run the build ralph loop — spawns Claude CLI sessions iteratively,
   * detecting completion markers to advance to the next task.
   */
  private async runBuildLoop(
    sessionId: string,
    initialPrompt: string,
    systemPrompt: string,
    request: InterviewRequest,
    onEvent: (event: InterviewEvent) => void,
    sessionWorkspace: string,
    worktreePath?: string,
  ): Promise<void> {
    const model = request.model || "opus";

    // Append Linear issue context to the first iteration prompt
    const linearContext = request.linearIssueUrls?.length
      ? `\n\nLinear issues to execute:\n${request.linearIssueUrls.map((u) => `- ${u}`).join("\n")}`
      : "";

    let iteration = 1;

    this.emitEvent(
      sessionId,
      {
        type: "text",
        content: `Starting build loop (max ${MAX_BUILD_ITERATIONS} iterations)...`,
      },
      onEvent,
    );

    while (iteration <= MAX_BUILD_ITERATIONS) {
      const iterationPrompt =
        iteration === 1
          ? `${initialPrompt}${linearContext}`
          : `Continue with the next task. This is iteration ${iteration} of ${MAX_BUILD_ITERATIONS}.`;

      // Each iteration gets a fresh Claude CLI session
      const claudeSessionId = randomUUID();

      this.emitEvent(
        sessionId,
        {
          type: "text",
          content: `Build iteration ${iteration}/${MAX_BUILD_ITERATIONS} starting...`,
        },
        onEvent,
      );

      console.log(
        `[LocalExecutor] Build iteration ${iteration}/${MAX_BUILD_ITERATIONS} for session ${sessionId}`,
      );

      const marker = await this.runBuildIteration(
        sessionId,
        iterationPrompt,
        systemPrompt,
        model,
        claudeSessionId,
        onEvent,
        sessionWorkspace,
        worktreePath,
      );

      console.log(
        `[LocalExecutor] Build iteration ${iteration} result: ${marker}`,
      );

      if (marker === "all-tasks-complete") {
        this.emitEvent(
          sessionId,
          {
            type: "text",
            content: `All tasks complete after ${iteration} iteration(s). Pushing branch and creating PR...`,
          },
          onEvent,
        );
        break;
      }

      if (marker === "error") {
        this.emitEvent(
          sessionId,
          {
            type: "text",
            content: `Build iteration ${iteration} ended without a completion marker. Stopping build loop.`,
          },
          onEvent,
        );
        break;
      }

      // TASK_COMPLETE — continue to next iteration
      this.emitEvent(
        sessionId,
        {
          type: "text",
          content: `Task completed (iteration ${iteration}). Moving to next task...`,
        },
        onEvent,
      );

      iteration++;

      if (iteration <= MAX_BUILD_ITERATIONS) {
        await new Promise((r) => setTimeout(r, BUILD_ITERATION_DELAY));
      }
    }

    if (iteration > MAX_BUILD_ITERATIONS) {
      this.emitEvent(
        sessionId,
        {
          type: "text",
          content: `Reached max iterations (${MAX_BUILD_ITERATIONS}). Pushing branch and creating PR...`,
        },
        onEvent,
      );
    }

    // Push branch and create PR
    this.pushAndCreatePR(sessionWorkspace, sessionId, onEvent);

    // Final cleanup
    this.emitEvent(sessionId, { type: "complete" }, onEvent);
    this.cleanupSession(sessionId);
  }

  /**
   * Run a single build iteration — spawns one Claude CLI session and
   * streams events until a completion marker is detected or the stream ends.
   */
  private runBuildIteration(
    sessionId: string,
    prompt: string,
    systemPrompt: string,
    model: string,
    claudeSessionId: string,
    onEvent: (event: InterviewEvent) => void,
    sessionWorkspace: string,
    worktreePath?: string,
  ): Promise<"task-complete" | "all-tasks-complete" | "error"> {
    return new Promise((resolve) => {
      let accumulatedText = "";
      let resolved = false;

      const resolveOnce = (
        result: "task-complete" | "all-tasks-complete" | "error",
      ) => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };

      const self = this;

      const program = Effect.gen(function* () {
        const cliService = yield* ClaudeCliService;

        const handle = yield* cliService.execute({
          prompt,
          systemPrompt,
          workspaceRoot: sessionWorkspace,
          model,
        });

        self.activeSessions.set(sessionId, {
          sessionId,
          handle,
          startedAt: new Date(),
          claudeSessionId,
          worktreePath,
        });

        self.emitEvent(
          sessionId,
          { type: "session_started", claudeSessionId },
          onEvent,
        );

        yield* handle.stream.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              // Forward events to Slack
              self.processEvent(sessionId, event, onEvent);

              // Accumulate text for marker detection
              if (event.type === "text") {
                accumulatedText += event.content;

                if (accumulatedText.includes(ALL_TASKS_COMPLETE_MARKER)) {
                  console.log(
                    `[LocalExecutor] Detected ALL_TASKS_COMPLETE marker`,
                  );
                  handle.kill();
                  resolveOnce("all-tasks-complete");
                } else if (accumulatedText.includes(TASK_COMPLETE_MARKER)) {
                  console.log(
                    `[LocalExecutor] Detected TASK_COMPLETE marker`,
                  );
                  handle.kill();
                  resolveOnce("task-complete");
                }
              }
            }),
          ),
        );

        // Stream ended without a marker
        resolveOnce("error");
      });

      Effect.runPromise(
        program.pipe(Effect.provide(ClaudeCliService.Default)),
      ).catch((error) => {
        // Stream interruption from kill() is expected for marker detection
        if (!resolved) {
          console.error(
            `[LocalExecutor] Build iteration error for ${sessionId}:`,
            error,
          );
          resolveOnce("error");
        }
      });
    });
  }

  /**
   * Push the feature branch and create a PR after build loop completes.
   */
  private pushAndCreatePR(
    workspacePath: string,
    sessionId: string,
    onEvent: (event: InterviewEvent) => void,
  ): void {
    try {
      // Get branch name for the PR title
      const branchName = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: workspacePath,
        encoding: "utf-8",
      }).trim();

      // Push the branch
      execSync("git push -u origin HEAD", {
        cwd: workspacePath,
        stdio: "pipe",
      });

      console.log(
        `[LocalExecutor] Pushed branch ${branchName} for session ${sessionId}`,
      );

      // Create PR
      const prTitle = branchName.startsWith("clive/")
        ? `feat: ${branchName.replace("clive/", "").replace(/-/g, " ")}`
        : `feat: ${branchName}`;

      const prOutput = execSync(
        `gh pr create --base main --title "${prTitle}" --body "Automated build from Clive build agent."`,
        { cwd: workspacePath, encoding: "utf-8" },
      ).trim();

      const prUrlMatch = prOutput.match(
        /https:\/\/github\.com\/[^\s]+\/pull\/\d+/,
      );
      if (prUrlMatch) {
        this.emitEvent(
          sessionId,
          { type: "pr_created", url: prUrlMatch[0] },
          onEvent,
        );
        console.log(
          `[LocalExecutor] PR created: ${prUrlMatch[0]} for session ${sessionId}`,
        );
      }
    } catch (error) {
      console.error(
        `[LocalExecutor] Push/PR creation failed for ${sessionId}:`,
        error,
      );
      this.emitEvent(
        sessionId,
        {
          type: "error",
          message: `Push/PR failed: ${error instanceof Error ? error.message : String(error)}`,
        },
        onEvent,
      );
    }
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
          // Check for pr_feedback_addressed JSON block
          const feedbackAddressedMatch = event.content.match(
            /```json\s*\n\s*\{\s*"summary"\s*:/,
          );
          if (feedbackAddressedMatch) {
            const jsonMatch = event.content.match(
              /```json\s*\n([\s\S]*?)\n\s*```/,
            );
            if (jsonMatch?.[1]) {
              try {
                const parsed = JSON.parse(jsonMatch[1]) as {
                  summary?: string;
                  commentReplies?: Array<{ commentId: number; reply: string }>;
                };
                // Look up PR URL from session
                const session = this.activeSessions.get(sessionId);
                const prUrl =
                  (session as { prUrl?: string } | undefined)?.prUrl ?? "";
                this.emitEvent(
                  sessionId,
                  {
                    type: "pr_feedback_addressed",
                    prUrl,
                    summary: parsed.summary,
                    commentReplies: parsed.commentReplies,
                  },
                  onEvent,
                );
              } catch {
                // Not valid JSON — emit as regular text
              }
            }
          }

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
        // Detect PR creation from gh CLI output
        if (content.includes("github.com") && content.includes("/pull/")) {
          const prUrlMatch = content.match(
            /https:\/\/github\.com\/[^\s]+\/pull\/\d+/,
          );
          if (prUrlMatch) {
            this.emitEvent(
              sessionId,
              {
                type: "pr_created",
                url: prUrlMatch[0],
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
    this.cleanupSession(sessionId);
  }

  /**
   * Clean up session resources including worktree
   */
  private cleanupSession(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session?.worktreePath && this.worktreeManager) {
      try {
        this.worktreeManager.remove(sessionId);
      } catch (error) {
        console.warn(
          `[LocalExecutor] Worktree cleanup failed for ${sessionId}:`,
          error,
        );
      }
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
    for (const sessionId of Array.from(this.activeSessions.keys())) {
      this.cancelSession(sessionId);
    }
  }
}
