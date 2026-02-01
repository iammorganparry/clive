/**
 * useAppState Hook
 * Central state management for the TUI application using XState
 * Manages CLI execution, output lines, and user interactions
 */

import { useQueryClient } from "@tanstack/react-query";
import { useMachine } from "@xstate/react";
import { Effect, Runtime } from "effect";
import { useEffect, useRef, useState } from "react";
import { assign, setup } from "xstate";
import { CliManager } from "../services/CliManager";
import { ConversationService } from "../services/ConversationService";
import { ConversationWatcher } from "../services/ConversationWatcher";
import { HistoryConverter } from "../services/HistoryConverter";
import { WorktreeService } from "../services/WorktreeService";
import type { BuildConfig } from "../services/prompts";
import { PromptService, PromptServiceLive } from "../services/prompts";
import { SessionMetadataService } from "../services/SessionMetadataService";
import type { OutputLine, QuestionData, Session, Task } from "../types";
import { loadCommand } from "../utils/command-loader";
import { debugLog } from "../utils/debug-logger";
import { useLinearSync } from "./useLinearSync";
import { taskQueryKeys, useSessions, useSessionTasks } from "./useTaskQueries";

/**
 * TUI State Machine
 * States: idle, executing, waiting_for_answer
 */
const tuiMachine = setup({
  types: {
    context: {} as {
      outputLines: OutputLine[];
      pendingQuestion: QuestionData | null;
      questionQueue: QuestionData[]; // Queue for multiple questions
      workspaceRoot: string;
      cliManager: CliManager | null;
      mode: "none" | "plan" | "build";
      agentSessionActive: boolean;
    },
    events: {} as
      | { type: "EXECUTE"; prompt: string; mode: "plan" | "build" }
      | { type: "OUTPUT"; line: OutputLine }
      | { type: "QUESTION"; question: QuestionData }
      | { type: "ANSWER"; answers: Record<string, string> }
      | { type: "COMPLETE" }
      | { type: "INTERRUPT" }
      | { type: "EXIT_MODE" }
      | { type: "CLEAR" }
      | { type: "MESSAGE"; content: string },
  },
  actions: {
    updateOutput: assign({
      outputLines: ({ context, event }) => {
        if (event.type !== "OUTPUT") return context.outputLines;
        return [...context.outputLines, event.line];
      },
    }),
    setQuestion: assign({
      pendingQuestion: ({ context, event }) => {
        if (event.type !== "QUESTION") return context.pendingQuestion;

        debugLog("useAppState", "State machine: setQuestion action called", {
          toolUseID: event.question.toolUseID,
          questionCount: event.question.questions.length,
          hasPendingQuestion: !!context.pendingQuestion,
          pendingToolUseID: context.pendingQuestion?.toolUseID,
          pendingQuestionCount: context.pendingQuestion?.questions.length,
          queueLength: context.questionQueue.length,
        });

        // Allow a complete question to replace an existing empty one with the
        // same toolUseID (handles the case where content_block_start fires
        // before the accumulated input is ready).
        if (
          context.pendingQuestion &&
          context.pendingQuestion.toolUseID === event.question.toolUseID &&
          context.pendingQuestion.questions.length === 0 &&
          event.question.questions.length > 0
        ) {
          debugLog("useAppState", "Replacing empty pending question with complete data", {
            toolUseID: event.question.toolUseID,
          });
          return event.question;
        }

        // If there's already a pending question, this will be added to queue by queueQuestion action
        // Otherwise, show immediately
        return context.pendingQuestion || event.question;
      },
      questionQueue: ({ context, event }) => {
        if (event.type !== "QUESTION") return context.questionQueue;

        // Don't queue if this is replacing the current pending question
        if (
          context.pendingQuestion &&
          context.pendingQuestion.toolUseID === event.question.toolUseID &&
          context.pendingQuestion.questions.length === 0 &&
          event.question.questions.length > 0
        ) {
          return context.questionQueue;
        }

        // If there's already a pending question, add new question to queue
        if (context.pendingQuestion) {
          debugLog("useAppState", "Adding question to queue", {
            toolUseID: event.question.toolUseID,
            newQueueLength: context.questionQueue.length + 1,
          });
          return [...context.questionQueue, event.question];
        }

        // Otherwise, don't add to queue (it's being shown immediately)
        return context.questionQueue;
      },
    }),
    clearQuestion: assign({
      pendingQuestion: ({ context }) => {
        // If there are queued questions, show the next one
        if (context.questionQueue.length > 0) {
          const nextQuestion = context.questionQueue[0]!;
          debugLog("useAppState", "Processing next queued question", {
            toolUseID: nextQuestion.toolUseID,
            remainingInQueue: context.questionQueue.length - 1,
          });
          return nextQuestion;
        }

        debugLog("useAppState", "No more queued questions");
        return null;
      },
      questionQueue: ({ context }) => {
        // Remove the first question from queue (it's now being shown)
        if (context.questionQueue.length > 0) {
          return context.questionQueue.slice(1);
        }
        return [];
      },
    }),
    clearOutput: assign({
      outputLines: [],
    }),
    renderMessage: assign({
      outputLines: ({ context, event }) => {
        if (event.type !== "MESSAGE") return context.outputLines;
        return [...context.outputLines, { type: "user" as const, text: event.content }];
      },
    }),
    setMode: assign({
      mode: ({ event }) => {
        if (event.type !== "EXECUTE") return "none";
        return event.mode;
      },
      agentSessionActive: true,
    }),
    clearMode: assign({
      mode: "none",
      agentSessionActive: false,
    }),
    clearQuestionQueue: assign({
      pendingQuestion: null,
      questionQueue: [],
    }),
  },
}).createMachine({
  id: "tui",
  initial: "idle",
  context: {
    outputLines: [],
    pendingQuestion: null,
    questionQueue: [],
    workspaceRoot: process.cwd(),
    cliManager: null,
    mode: "none",
    agentSessionActive: false,
  },
  states: {
    idle: {
      on: {
        EXECUTE: {
          target: "executing",
          actions: "setMode",
        },
        QUESTION: {
          target: "waiting_for_answer",
          actions: "setQuestion",
        },
        EXIT_MODE: {
          actions: "clearMode",
        },
        CLEAR: {
          actions: "clearOutput",
        },
        OUTPUT: {
          actions: "updateOutput",
        },
      },
    },
    executing: {
      on: {
        OUTPUT: {
          actions: "updateOutput",
        },
        QUESTION: {
          target: "waiting_for_answer",
          actions: "setQuestion",
        },
        COMPLETE: {
          target: "idle",
          actions: "clearQuestionQueue",
          // Don't clear mode - keep it active for follow-up messages
        },
        INTERRUPT: {
          target: "idle",
          actions: ["clearMode", "clearQuestionQueue"],
        },
        EXIT_MODE: {
          target: "idle",
          actions: ["clearMode", "clearQuestionQueue"],
        },
        MESSAGE: {
          actions: "renderMessage",
        },
      },
    },
    waiting_for_answer: {
      on: {
        OUTPUT: {
          actions: "updateOutput",
        },
        QUESTION: {
          // When a new question arrives while already waiting, add to queue
          actions: "setQuestion",
        },
        ANSWER: [
          {
            // Stay in waiting_for_answer if there are more queued questions
            target: "waiting_for_answer",
            guard: ({ context }) => context.questionQueue.length > 0,
            actions: "clearQuestion",
          },
          {
            // Otherwise return to executing
            target: "executing",
            actions: "clearQuestion",
          },
        ],
        COMPLETE: {
          // Execution ended while waiting for answer - clear questions and go to idle
          target: "idle",
          actions: "clearQuestionQueue",
        },
        INTERRUPT: {
          target: "idle",
          actions: ["clearQuestionQueue", "clearMode"],
        },
        EXIT_MODE: {
          target: "idle",
          actions: ["clearQuestionQueue", "clearMode"],
        },
      },
    },
  },
});

export interface AppState {
  // Output state
  outputLines: OutputLine[];
  isRunning: boolean;

  // Question state
  pendingQuestion: QuestionData | null;

  // Mode state
  mode: "none" | "plan" | "build";
  agentSessionActive: boolean;

  // Task/Session state
  sessions: Session[];
  tasks: Task[];
  activeSession: Session | null;
  sessionsLoading: boolean;
  tasksLoading: boolean;
  sessionsError: Error | null;
  tasksError: Error | null;

  // Actions
  executeCommand: (cmd: string) => void;
  sendMessage: (msg: string) => void;
  handleQuestionAnswer: (answers: Record<string, string>) => void;
  clearOutput: () => void;
  interrupt: () => void;
  setActiveSession: (session: Session | null) => void;
  cleanup: () => void;
}

export function useAppState(
  workspaceRoot: string,
  issueTracker?: "linear" | "beads" | null,
): AppState {
  // Use XState machine
  const [state, send] = useMachine(tuiMachine);

  // React Query client for cache invalidation
  const queryClient = useQueryClient();

  // CLI Manager and Conversation Watcher instances
  const cliManager = useRef<CliManager | null>(null);
  const conversationWatcher = useRef<ConversationWatcher | null>(null);

  // Deduplicate QUESTION events from CliManager + ConversationWatcher
  const seenQuestionIds = useRef(new Set<string>());

  // Build loop iteration tracking
  const iterationRef = useRef(0);
  const maxIterationsRef = useRef(10);
  const isIteratingRef = useRef(false);
  const lastCompletionMarkerRef = useRef<
    "task-complete" | "all-tasks-complete" | null
  >(null);

  // Active session tracking
  const [activeSession, setActiveSession] = useState<Session | null>(null);

  // Refs to hold latest values for event listener closures (avoids stale closures)
  const activeSessionRef = useRef<Session | null>(null);
  activeSessionRef.current = activeSession;
  const workspaceRootRef = useRef(workspaceRoot);
  workspaceRootRef.current = workspaceRoot;
  const issueTrackerRef = useRef(issueTracker);
  issueTrackerRef.current = issueTracker;
  // Ref for startBuildIteration so the complete listener always calls the latest version
  const startBuildIterationRef = useRef<(iteration: number) => void>(
    () => {},
  );

  // React Query hooks for task/session data
  const {
    data: sessions = [],
    isLoading: sessionsLoading,
    error: sessionsError,
  } = useSessions();

  const {
    data: tasks = [],
    isLoading: tasksLoading,
    error: tasksError,
  } = useSessionTasks(activeSession?.id ?? null);

  // Real-time Linear sync — polls for sub-issue status changes during builds
  const isRunning =
    state.matches("executing") || state.matches("waiting_for_answer");
  const linearSync = useLinearSync({
    parentIssueId: activeSession?.linearData?.id ?? null,
    enabled: isRunning,
  });
  // Keep a ref to syncNow so the cliManager listener always calls the latest version
  const linearSyncNowRef = useRef(linearSync.syncNow);
  linearSyncNowRef.current = linearSync.syncNow;

  // Initialize CLI Manager and Conversation Watcher
  useEffect(() => {
    if (!cliManager.current) {
      cliManager.current = new CliManager();

      // Listen for output events
      cliManager.current.on("output", (line: OutputLine) => {
        debugLog("useAppState", "Received output line", {
          type: line.type,
          text: line.text?.substring(0, 50),
        });

        // Handle question lines specially
        if (line.type === "question" && line.question) {
          const qid = line.question.toolUseID;
          const hasQuestions = line.question.questions.length > 0;

          // Smart dedup: Only register in seenQuestionIds when questions are
          // non-empty. Allow a later event with complete data to override an
          // earlier empty one (safety net for streaming parser edge cases).
          if (seenQuestionIds.current.has(qid) && hasQuestions) {
            // We saw this ID before but now have real data — allow override
            debugLog("useAppState", "Overriding empty question with complete data from CliManager", {
              toolUseID: qid,
            });
            send({ type: "QUESTION", question: line.question });
          } else if (seenQuestionIds.current.has(qid)) {
            debugLog("useAppState", "Skipping duplicate question from CliManager", {
              toolUseID: qid,
            });
          } else {
            if (hasQuestions) {
              seenQuestionIds.current.add(qid);
            }
            debugLog("useAppState", "Question line detected", {
              toolUseID: qid,
              questionCount: line.question.questions.length,
              registered: hasQuestions,
            });
            send({ type: "QUESTION", question: line.question });
          }
        }

        send({ type: "OUTPUT", line });
      });

      // Listen for completion
      cliManager.current.on("complete", () => {
        debugLog("useAppState", "Execution complete", {
          isIterating: isIteratingRef.current,
          lastMarker: lastCompletionMarkerRef.current,
          iteration: iterationRef.current,
        });

        const lastMarker = lastCompletionMarkerRef.current;
        lastCompletionMarkerRef.current = null;

        // Helper to add system message without stale closure
        const sysMsg = (text: string) => {
          send({
            type: "OUTPUT",
            line: { text, type: "system" },
          });
        };

        // Handle build loop iteration
        if (isIteratingRef.current) {
          if (lastMarker === "task-complete") {
            const nextIteration = iterationRef.current + 1;
            if (nextIteration > maxIterationsRef.current) {
              isIteratingRef.current = false;
              send({ type: "COMPLETE" });
              sysMsg(
                `Build loop reached max iterations (${maxIterationsRef.current}). Stopping.`,
              );
              return;
            }

            send({ type: "COMPLETE" });
            sysMsg(
              `Task complete. Starting iteration ${nextIteration}/${maxIterationsRef.current}...`,
            );

            // Delay before starting next iteration to let state settle
            setTimeout(() => {
              startBuildIterationRef.current(nextIteration);
            }, 1500);
            return;
          }

          if (lastMarker === "all-tasks-complete") {
            isIteratingRef.current = false;
            send({ type: "COMPLETE" });
            sysMsg("All tasks complete. Build loop finished.");
            return;
          }

          // No marker — agent finished without emitting a completion marker
          isIteratingRef.current = false;
          send({ type: "COMPLETE" });
          sysMsg(
            "Agent finished without completion marker. Build loop stopped.",
          );
          return;
        }

        send({ type: "COMPLETE" });
        seenQuestionIds.current.clear();
      });

      // Listen for kill
      cliManager.current.on("killed", () => {
        debugLog("useAppState", "CLI process killed");
        send({ type: "INTERRUPT" });
      });

      // Listen for build loop completion markers
      cliManager.current.on("task-complete", () => {
        debugLog("useAppState", "task-complete marker received");
        lastCompletionMarkerRef.current = "task-complete";
      });

      cliManager.current.on("all-tasks-complete", () => {
        debugLog("useAppState", "all-tasks-complete marker received");
        lastCompletionMarkerRef.current = "all-tasks-complete";
      });

      // Listen for Linear issue updates from the build agent's stream
      // This triggers an immediate sidebar sync without needing hooks in the subprocess
      cliManager.current.on("linear-updated", () => {
        debugLog("useAppState", "Linear update detected in agent stream - syncing");
        linearSyncNowRef.current();
      });

      // Listen for review-complete to prompt user about build transition
      cliManager.current.on("review-complete", () => {
        debugLog("useAppState", "review-complete marker received — prompting for build transition");
        const transitionQuestion: QuestionData = {
          toolUseID: `internal:review-transition-${Date.now()}`,
          questions: [{
            header: "Next Step",
            question: "Review complete! Ready to start building?",
            options: [
              { label: "Start Build", description: "Transition to build mode and begin implementation" },
              { label: "Stay in Review", description: "Continue reviewing or exit" },
            ],
            multiSelect: false,
          }],
        };
        send({ type: "QUESTION", question: transitionQuestion });
      });
    }

    if (!conversationWatcher.current) {
      conversationWatcher.current = new ConversationWatcher();

      // Listen for task spawn events (for Linear refetching)
      conversationWatcher.current.on("task_spawn", (event: any) => {
        debugLog(
          "useAppState",
          "Task spawn detected via conversation watcher",
          {
            subagentType: event.input?.subagent_type,
          },
        );

        // Handle build agent spawn - refetch Linear tasks
        if (event.input?.subagent_type === "build") {
          debugLog("useAppState", "Build agent spawned - refetch Linear tasks");
          // TODO: Trigger Linear task refetch here
          // queryClient.invalidateQueries({ queryKey: ['linear-tasks'] });
        }
      });

      // Listen for AskUserQuestion tool use
      conversationWatcher.current.on("tool_use", (event: any) => {
        if (event.name === "AskUserQuestion") {
          const questionData: QuestionData = {
            toolUseID: event.id,
            questions: event.input.questions || [],
          };
          const hasQuestions = questionData.questions.length > 0;

          // Smart dedup: same logic as CliManager handler above
          if (seenQuestionIds.current.has(questionData.toolUseID) && hasQuestions) {
            // Override empty question with complete data
            debugLog("useAppState", "Overriding empty question with complete data from ConversationWatcher", {
              toolUseID: questionData.toolUseID,
            });
            send({ type: "QUESTION", question: questionData });
          } else if (seenQuestionIds.current.has(questionData.toolUseID)) {
            debugLog("useAppState", "Skipping duplicate question from ConversationWatcher", {
              toolUseID: questionData.toolUseID,
            });
          } else {
            if (hasQuestions) {
              seenQuestionIds.current.add(questionData.toolUseID);
            }
            debugLog(
              "useAppState",
              "AskUserQuestion detected via conversation watcher",
              {
                toolId: event.id,
                input: event.input,
                registered: hasQuestions,
              },
            );
            send({ type: "QUESTION", question: questionData });
          }
        }
      });

      // Listen for Linear tool results to capture project/issue IDs
      conversationWatcher.current.on("linear_tool_result", (event: any) => {
        debugLog("useAppState", "Linear tool result detected", {
          toolName: event.name,
          toolId: event.id,
        });

        // Parse tool result content to extract Linear IDs
        try {
          const content = event.content;
          let parsedContent: any;

          // Content might be a string or already parsed
          if (typeof content === "string") {
            parsedContent = JSON.parse(content);
          } else {
            parsedContent = content;
          }

          // Get current session ID from conversation watcher
          const sessionId = conversationWatcher.current?.getCurrentSessionId();
          if (!sessionId) {
            debugLog(
              "useAppState",
              "No active session ID, skipping metadata storage",
            );
            return;
          }

          debugLog("useAppState", "Storing Linear metadata for session", {
            sessionId,
            toolName: event.name,
          });

          // Store metadata based on tool type
          const program = Effect.gen(function* () {
            const service = yield* SessionMetadataService;

            if (event.name === "mcp__linear__create_project") {
              // Extract project ID and identifier
              const projectId = parsedContent.project?.id || parsedContent.id;
              const projectIdentifier =
                parsedContent.project?.identifier || parsedContent.identifier;

              if (projectId) {
                debugLog("useAppState", "Storing Linear project association", {
                  sessionId,
                  projectId,
                  projectIdentifier,
                });
                yield* service.setLinearProject(
                  sessionId,
                  projectId,
                  projectIdentifier,
                );

                // Trigger refetch of sessions (epics/projects)
                yield* Effect.sync(() => {
                  debugLog(
                    "useAppState",
                    "Invalidating sessions query after project creation",
                  );
                  queryClient.invalidateQueries({
                    queryKey: taskQueryKeys.sessions(),
                  });
                });
              }
            } else if (event.name === "mcp__linear__create_issue") {
              // Extract issue ID and identifier
              const taskId = parsedContent.issue?.id || parsedContent.id;
              const taskIdentifier =
                parsedContent.issue?.identifier || parsedContent.identifier;

              if (taskId) {
                debugLog("useAppState", "Storing Linear task association", {
                  sessionId,
                  taskId,
                  taskIdentifier,
                });
                yield* service.setLinearTask(sessionId, taskId, taskIdentifier);

                // Trigger refetch of tasks for this session
                yield* Effect.sync(() => {
                  debugLog(
                    "useAppState",
                    "Invalidating task queries after issue creation",
                    {
                      sessionId,
                    },
                  );
                  queryClient.invalidateQueries({
                    queryKey: taskQueryKeys.sessionTasks(sessionId),
                  });
                  queryClient.invalidateQueries({
                    queryKey: taskQueryKeys.readyTasks(),
                  });
                });
              }
            } else if (event.name === "mcp__linear__update_issue") {
              // Trigger refetch on issue updates
              yield* Effect.sync(() => {
                debugLog(
                  "useAppState",
                  "Invalidating task queries after issue update",
                );
                queryClient.invalidateQueries({ queryKey: taskQueryKeys.all });
              });
            }
          });

          // Run the Effect program
          Effect.runPromise(
            program.pipe(Effect.provide(SessionMetadataService.Default)),
          ).catch((error: any) => {
            debugLog("useAppState", "Error storing Linear metadata", {
              error: String(error),
            });
          });
        } catch (error) {
          debugLog("useAppState", "Error parsing Linear tool result", {
            error: String(error),
          });
        }
      });

      // Start watching for conversation files
      conversationWatcher.current.start();
    }

    // Cleanup on unmount
    return () => {
      if (cliManager.current) {
        cliManager.current.kill();
        cliManager.current.removeAllListeners();
      }
      if (conversationWatcher.current) {
        conversationWatcher.current.stop();
        conversationWatcher.current.removeAllListeners();
      }
    };
  }, [send, queryClient.invalidateQueries]);

  /**
   * Execute a command (slash command or message)
   */
  const executeCommand = (cmd: string) => {
    if (!cmd.trim() || !cliManager.current) return;

    const isSlashCommand = cmd.startsWith("/");
    const inActiveMode =
      state.context.mode !== "none" && state.context.agentSessionActive;

    // If in active mode and NOT a slash command, continue the conversation
    // The CLI process exits after each turn (--print mode), so follow-up
    // messages spawn a new process with --resume to continue the session.
    if (inActiveMode && !isSlashCommand) {
      if (state.matches("executing")) {
        addSystemMessage("Still processing... please wait for the current turn to complete.");
        return;
      }

      const sessionId = conversationWatcher.current?.getCurrentSessionId();
      const mode = state.context.mode as "plan" | "build";

      // Re-execute with --resume to continue the conversation
      startExecution(
        cmd,
        mode,
        `> ${cmd}`,
        true, // continuingSession — don't clear output
        sessionId ?? undefined, // resume session if available
        false, // loadHistory — UI already has the output
      );
      return;
    }

    // Handle slash commands
    if (isSlashCommand) {
      handleSlashCommand(cmd);
      return;
    }

    // Not in a mode and not a slash command - show hint
    addSystemMessage("No process running. Use /plan or /build to start.");
  };

  /**
   * Handle slash commands
   */
  const handleSlashCommand = (cmd: string) => {
    const parts = cmd.split(" ");
    const command = parts[0]!.toLowerCase();
    const args = parts.slice(1).join(" ").trim();

    switch (command) {
      case "/plan": {
        const currentMode = state.context.mode;
        const inActiveSession = state.context.agentSessionActive;

        // Check for --resume flag
        const resumeMatch = args.match(/--resume=([a-f0-9-]+)/);
        const resumeSessionId = resumeMatch ? resumeMatch[1] : undefined;
        // Remove --resume flag from args to get clean prompt
        const cleanArgs = args.replace(/--resume=[a-f0-9-]+\s*/, "").trim();

        // If resuming a session
        if (resumeSessionId) {
          addSystemMessage(
            `Resuming conversation: ${resumeSessionId.substring(0, 8)}...`,
          );
          const prompt = cleanArgs || "Continue the conversation";
          startExecution(prompt, "plan", `> ${prompt}`, false, resumeSessionId);
          break;
        }

        // If already in plan mode and has active session, continue the conversation
        if (currentMode === "plan" && inActiveSession && cleanArgs) {
          const prompt = cleanArgs;
          const currentSessionId = conversationWatcher.current?.getCurrentSessionId();
          startExecution(prompt, "plan", `> ${cleanArgs}`, true, currentSessionId ?? undefined, false);
          break;
        }

        // If in build mode, need to exit first
        if (currentMode === "build") {
          addSystemMessage(
            "Already in build mode. Use /exit to exit current mode first.",
          );
          break;
        }

        // Start new plan session
        const prompt = cleanArgs || "Create a plan for the current task";
        startExecution(
          prompt,
          "plan",
          cleanArgs ? `> ${cleanArgs}` : undefined,
          false,
        );
        break;
      }

      case "/build": {
        const currentMode = state.context.mode;
        const inActiveSession = state.context.agentSessionActive;

        // Check for --resume flag (same pattern as /plan)
        const buildResumeMatch = args.match(/--resume=([a-f0-9-]+)/);
        const buildResumeSessionId = buildResumeMatch ? buildResumeMatch[1] : undefined;
        const buildCleanArgs = args.replace(/--resume=[a-f0-9-]+\s*/, "").trim();

        // If resuming a session
        if (buildResumeSessionId) {
          addSystemMessage(
            `Resuming build: ${buildResumeSessionId.substring(0, 8)}...`,
          );
          const prompt = buildCleanArgs || "Continue the build";
          startExecution(prompt, "build", `> ${prompt}`, false, buildResumeSessionId);
          break;
        }

        // If already in build mode and has active session, continue the conversation
        if (currentMode === "build" && inActiveSession && buildCleanArgs) {
          const prompt = buildCleanArgs;
          const currentSessionId = conversationWatcher.current?.getCurrentSessionId();
          startExecution(prompt, "build", `> ${buildCleanArgs}`, true, currentSessionId ?? undefined, false);
          break;
        }

        // If in plan mode, need to exit first
        if (currentMode === "plan") {
          addSystemMessage(
            "Already in plan mode. Use /exit to exit current mode first.",
          );
          break;
        }

        // Parse --max-iterations from args
        const maxIterMatch = buildCleanArgs.match(/--max-iterations=(\d+)/);
        const maxIter = maxIterMatch ? parseInt(maxIterMatch[1]!, 10) : 10;
        const buildPromptArgs = buildCleanArgs
          .replace(/--max-iterations=\d+\s*/, "")
          .trim();

        // Initialize build loop state
        iterationRef.current = 1;
        maxIterationsRef.current = maxIter;
        isIteratingRef.current = true;
        lastCompletionMarkerRef.current = null;

        // Start new build session
        const prompt = buildPromptArgs || "Execute the plan";
        startExecution(prompt, "build", buildPromptArgs ? `> ${buildPromptArgs}` : undefined, false);
        break;
      }

      case "/exit":
        if (state.context.mode !== "none") {
          // Kill active agent process
          cliManager.current?.kill();

          // Clear conversation history
          cliManager.current?.clear();

          // Send EXIT_MODE event
          send({ type: "EXIT_MODE" });

          // Show confirmation
          addSystemMessage(`✓ Exited ${state.context.mode} mode`);
        } else {
          addSystemMessage("Not currently in any mode");
        }
        break;

      case "/clear":
        send({ type: "CLEAR" });
        break;

      case "/cancel":
      case "/stop":
        interrupt();
        break;

      case "/help":
        showHelp();
        break;

      default:
        addSystemMessage(`Unknown command: ${command}`);
    }
  };

  /**
   * Start a single build iteration (called by the loop controller)
   */
  const startBuildIteration = async (iteration: number) => {
    if (!cliManager.current) return;

    iterationRef.current = iteration;
    lastCompletionMarkerRef.current = null;

    debugLog("useAppState", "Starting build iteration", {
      iteration,
      maxIterations: maxIterationsRef.current,
    });

    // Use refs to get latest values (avoids stale closure from useEffect)
    const currentSession = activeSessionRef.current;
    const currentWorkspaceRoot = workspaceRootRef.current;
    const currentIssueTracker = issueTrackerRef.current;

    // Resolve epic context from active session
    const epicId = currentSession?.linearData?.id;
    const epicIdentifier = currentSession?.linearData?.identifier;

    // Resolve worktree (reuse existing)
    let effectiveWorkspaceRoot = currentWorkspaceRoot;
    if (epicId && epicIdentifier) {
      const worktreeMetadata = WorktreeService.getWorktreeForEpic(
        currentWorkspaceRoot,
        epicId,
      );
      if (worktreeMetadata) {
        effectiveWorkspaceRoot = worktreeMetadata.worktreePath;

        // Re-sync config files to worktree
        try {
          WorktreeService.syncConfigToWorktree(
            currentWorkspaceRoot,
            worktreeMetadata.worktreePath,
          );
          WorktreeService.copyPlanFile(
            currentWorkspaceRoot,
            epicId,
            worktreeMetadata.worktreePath,
          );
        } catch (syncError) {
          debugLog("useAppState", "Config sync warning (iteration)", {
            error: String(syncError),
          });
        }
      }
    }

    // Build prompt with iteration context
    const buildConfig: BuildConfig = {
      workspaceRoot: effectiveWorkspaceRoot,
      mode: "build",
      issueTracker: currentIssueTracker ?? undefined,
      epicId,
      epicIdentifier,
      iteration,
      maxIterations: maxIterationsRef.current,
    };

    const promptProgram = Effect.gen(function* () {
      const promptService = yield* PromptService;
      return yield* promptService.buildPrompt(buildConfig);
    });

    let systemPrompt: string;
    try {
      systemPrompt = await Runtime.runPromise(Runtime.defaultRuntime)(
        promptProgram.pipe(Effect.provide(PromptServiceLive)),
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      addSystemMessage(`Failed to build prompt for iteration ${iteration}: ${msg}`);
      isIteratingRef.current = false;
      send({ type: "COMPLETE" });
      return;
    }

    // Clear CliManager state for fresh invocation
    cliManager.current.clear();

    // Clear previous task's output so the new iteration starts with a clean slate
    send({ type: "CLEAR" });

    // Load command metadata for tool configuration
    const command = loadCommand("build", effectiveWorkspaceRoot);
    const commandMeta = command?.metadata;

    // Re-enter executing state
    send({ type: "EXECUTE", prompt: `Continue with next task (iteration ${iteration})`, mode: "build" });

    // Show iteration start message so user sees something in the cleared output
    addSystemMessage(`Starting iteration ${iteration}/${maxIterationsRef.current}...`);

    debugLog("useAppState", "Executing iteration CLI", {
      iteration,
      promptLength: systemPrompt.length,
      workspaceRoot: effectiveWorkspaceRoot,
      hasEpicId: !!epicId,
    });

    // Execute fresh CLI invocation
    cliManager.current
      .execute(`Continue with the next task. This is iteration ${iteration} of ${maxIterationsRef.current}.`, {
        workspaceRoot: effectiveWorkspaceRoot,
        model: commandMeta?.model,
        systemPrompt,
        mode: "build",
        allowedTools: commandMeta?.allowedTools,
        disallowedTools: commandMeta?.deniedTools,
        epicId,
        epicIdentifier,
      })
      .catch((error: Error) => {
        debugLog("useAppState", "Iteration execution failed", {
          iteration,
          error: error.message,
        });
        addSystemMessage(`Iteration ${iteration} error: ${error.message}`);
        isIteratingRef.current = false;
        send({ type: "COMPLETE" });
      });
  };

  // Keep ref in sync so the complete listener always calls the latest version
  startBuildIterationRef.current = startBuildIteration;

  /**
   * Start CLI execution with a prompt
   */
  const startExecution = async (
    prompt: string,
    mode: "plan" | "build",
    userMessage?: string,
    continuingSession: boolean = false,
    resumeSessionId?: string,
    loadHistory: boolean = true,
  ) => {
    if (!cliManager.current || state.matches("executing")) return;

    // Only clear output and history if starting a fresh session (and not resuming)
    if (!continuingSession && !resumeSessionId) {
      send({ type: "CLEAR" });
      cliManager.current.clear(); // Clear conversation history
    }

    // Show user's message if provided (without the slash command)
    if (userMessage) {
      send({
        type: "OUTPUT",
        line: {
          text: userMessage,
          type: "user",
        },
      });
    }

    send({ type: "EXECUTE", prompt, mode });

    // Log workspace context
    debugLog("useAppState", "Executing with workspace context", {
      workspaceRoot,
      mode,
      promptLength: prompt.length,
    });

    // Resolve epic context from active session
    const epicId = activeSession?.linearData?.id;
    const epicIdentifier = activeSession?.linearData?.identifier;

    // For build mode, resolve or create worktree for this epic
    let effectiveWorkspaceRoot = workspaceRoot;
    if (mode === "build" && epicId && epicIdentifier) {
      let worktreeMetadata = WorktreeService.getWorktreeForEpic(
        workspaceRoot,
        epicId,
      );

      if (!worktreeMetadata) {
        addSystemMessage(`Creating worktree for ${epicIdentifier}...`);
        const result = WorktreeService.createWorktreeForEpic(
          workspaceRoot,
          epicId,
          epicIdentifier,
        );
        if (result.success && result.metadata) {
          worktreeMetadata = result.metadata;
          addSystemMessage(
            `Worktree created: ${result.metadata.worktreePath} (branch: ${result.metadata.branchName})`,
          );
        } else {
          addSystemMessage(
            `Worktree creation failed: ${result.error}. Falling back to main repo.`,
          );
        }
      }

      if (worktreeMetadata) {
        effectiveWorkspaceRoot = worktreeMetadata.worktreePath;

        // Sync config files (.claude/, .clive/) and plan file to worktree
        // This runs on both new and existing worktrees to pick up config changes
        try {
          WorktreeService.syncConfigToWorktree(
            workspaceRoot,
            worktreeMetadata.worktreePath,
          );
          WorktreeService.copyPlanFile(
            workspaceRoot,
            epicId,
            worktreeMetadata.worktreePath,
          );
          debugLog("useAppState", "Synced config and plan to worktree");
        } catch (syncError) {
          debugLog("useAppState", "Config sync warning", {
            error: String(syncError),
          });
        }

        addSystemMessage(
          `Using worktree: ${worktreeMetadata.worktreePath} (branch: ${worktreeMetadata.branchName})`,
        );
        debugLog("useAppState", "Resolved worktree for build", {
          epicId,
          worktreePath: worktreeMetadata.worktreePath,
          branchName: worktreeMetadata.branchName,
        });
      }
    }

    // Build system prompt using PromptService (single source of truth)
    const previousContext =
      continuingSession && cliManager.current
        ? cliManager.current.getConversationContext()
        : undefined;

    const buildConfig: BuildConfig = {
      workspaceRoot: effectiveWorkspaceRoot,
      mode,
      issueTracker: issueTracker ?? undefined,
      previousContext,
      epicId,
      epicIdentifier,
      // Include iteration context for build loop
      ...(mode === "build" && isIteratingRef.current
        ? {
            iteration: iterationRef.current,
            maxIterations: maxIterationsRef.current,
          }
        : {}),
    };

    // Use Effect to build the prompt
    const promptProgram = Effect.gen(function* () {
      const promptService = yield* PromptService;
      return yield* promptService.buildPrompt(buildConfig);
    });

    let systemPrompt: string;
    try {
      systemPrompt = await Runtime.runPromise(Runtime.defaultRuntime)(
        promptProgram.pipe(Effect.provide(PromptServiceLive)),
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      addSystemMessage(`Failed to build prompt: ${msg}`);
      send({ type: "COMPLETE" });
      return;
    }

    // Load historical conversation if resuming (skip for follow-up messages
    // where history is already displayed in the UI)
    if (resumeSessionId && loadHistory) {
      try {
        const historyProgram = Effect.gen(function* () {
          const conversationService = yield* ConversationService;
          const historyConverter = yield* HistoryConverter;

          const events = yield* conversationService.getConversationDetails(
            resumeSessionId,
            workspaceRoot,
          );
          const historyLines =
            yield* historyConverter.convertToOutputLines(events);

          const separator = historyConverter.createHistorySeparator();
          const resumeSeparator = historyConverter.createResumeSeparator();

          return [separator, ...historyLines, resumeSeparator];
        });

        const historyLines = await Effect.runPromise(
          historyProgram.pipe(
            Effect.provide(ConversationService.Default),
            Effect.provide(HistoryConverter.Default),
          ),
        );

        for (const line of historyLines) {
          send({ type: "OUTPUT", line });
        }
      } catch (_error) {
        // Show warning but continue with resume
        send({
          type: "OUTPUT",
          line: {
            text: `Warning: Could not load conversation history.`,
            type: "system",
          },
        });
      }
    }

    // Load command metadata for tool configuration
    const command = loadCommand(mode, effectiveWorkspaceRoot);
    const commandMeta = command?.metadata;

    // Save session metadata once the watcher discovers the session ID.
    // This creates the conversation record immediately so it appears in the
    // selection view before Claude CLI writes to history.jsonl.
    if (conversationWatcher.current) {
      const saveSessionMetadata = () => {
        const sessionId = conversationWatcher.current?.getCurrentSessionId();
        if (sessionId) {
          conversationWatcher.current?.off("event", saveSessionMetadata);
          Effect.runPromise(
            Effect.gen(function* () {
              const service = yield* SessionMetadataService;
              yield* service.setMetadata(sessionId, {
                mode,
                project: effectiveWorkspaceRoot,
                display: prompt,
              });
            }).pipe(Effect.provide(SessionMetadataService.Default)),
          ).then(() => {
            // Invalidate conversations query so UI picks up the new session
            queryClient.invalidateQueries({
              queryKey: ["conversations"],
            });
          }).catch((error: any) => {
            debugLog("useAppState", "Error saving session metadata", {
              error: String(error),
            });
          });
        }
      };
      // Try immediately (session may already exist for resumed sessions)
      saveSessionMetadata();
      // Also listen for new events in case session ID isn't available yet
      conversationWatcher.current.on("event", saveSessionMetadata);
    }

    // Execute via CLI Manager
    // Model inherits from Claude Code settings; only override if command file specifies one
    cliManager.current
      .execute(prompt, {
        workspaceRoot: effectiveWorkspaceRoot,
        model: commandMeta?.model,
        systemPrompt,
        mode,
        resumeSessionId,
        // Pass tool config from command file frontmatter
        allowedTools: commandMeta?.allowedTools,
        disallowedTools: commandMeta?.deniedTools,
        epicId,
        epicIdentifier,
      })
      .catch((error: Error) => {
        addSystemMessage(`Execution error: ${error.message}`);
        send({ type: "COMPLETE" });
      });
  };

  /**
   * Send a message to the running CLI
   */
  const sendMessage = (msg: string) => {
    if (!cliManager.current || !state.matches("executing")) return;
    cliManager.current.sendMessageToAgent(msg);
    send({ type: "MESSAGE", content: msg });
  };

  /**
   * Handle question answer
   */
  const handleQuestionAnswer = (answers: Record<string, string>) => {
    debugLog("useAppState", "handleQuestionAnswer called", { answers });

    if (!state.context.pendingQuestion) {
      debugLog(
        "useAppState",
        "ERROR: Cannot handle answer - no pendingQuestion",
      );
      console.error(
        "[useAppState] Cannot handle answer - no pendingQuestion",
      );
      return;
    }

    const toolUseID = state.context.pendingQuestion.toolUseID;
    debugLog("useAppState", "Pending question toolUseID", { toolUseID });

    // Handle internal (non-CLI) questions — these don't need a tool_result
    if (toolUseID.startsWith("internal:")) {
      debugLog("useAppState", "Handling internal question", { toolUseID });
      send({ type: "ANSWER", answers });

      if (toolUseID.startsWith("internal:review-transition")) {
        const answer = Object.values(answers)[0];
        if (answer === "Start Build") {
          debugLog("useAppState", "User chose Start Build — transitioning to build mode");
          // Auto-transition to build mode after state settles
          setTimeout(() => executeCommand("/build"), 100);
        }
      }
      return;
    }

    // CLI questions require a cliManager
    if (!cliManager.current) {
      debugLog(
        "useAppState",
        "ERROR: Cannot handle answer - missing cliManager",
      );
      console.error(
        "[useAppState] Cannot handle answer - missing cliManager",
      );
      return;
    }

    // Send tool result back to CLI
    // AskUserQuestion expects answers as a flat object: { "question text": "answer" }
    const answersJSON = JSON.stringify(answers);
    debugLog("useAppState", "Sending answers JSON", { answersJSON });

    cliManager.current.sendToolResult(toolUseID, answersJSON);

    debugLog("useAppState", "Sending ANSWER event to state machine");
    send({ type: "ANSWER", answers });
  };

  /**
   * Clear output
   */
  const clearOutput = () => {
    send({ type: "CLEAR" });
    seenQuestionIds.current.clear();
    if (cliManager.current) {
      cliManager.current.clear();
    }
  };

  /**
   * Interrupt running execution
   */
  const interrupt = () => {
    // Reset build loop state
    isIteratingRef.current = false;
    lastCompletionMarkerRef.current = null;

    if (cliManager.current) {
      cliManager.current.interrupt();
      addSystemMessage("Execution interrupted");
    }
    send({ type: "INTERRUPT" });
  };

  /**
   * Helper: Add system message to output
   */
  const addSystemMessage = (text: string) => {
    send({
      type: "OUTPUT",
      line: {
        text,
        type: "system",
      },
    });
  };

  /**
   * Helper: Show help message
   */
  const showHelp = () => {
    const helpText = [
      "Clive TUI Commands:",
      "",
      "/plan [prompt]  - Create a plan",
      "/build [prompt] - Execute a task",
      "/clear         - Clear output",
      "/cancel        - Stop execution",
      "/help          - Show this help",
      "",
      "Keyboard Shortcuts:",
      "q / Esc        - Quit",
      "Ctrl+C         - Interrupt",
    ].join("\n");

    addSystemMessage(helpText);
  };

  return {
    // Output state
    outputLines: state.context.outputLines,
    isRunning,
    pendingQuestion: state.context.pendingQuestion,

    // Mode state
    mode: state.context.mode,
    agentSessionActive: state.context.agentSessionActive,

    // Task/Session state
    sessions,
    tasks,
    activeSession,
    sessionsLoading,
    tasksLoading,
    sessionsError: sessionsError || null,
    tasksError: tasksError || null,

    // Actions
    executeCommand,
    sendMessage,
    handleQuestionAnswer,
    clearOutput,
    interrupt,
    setActiveSession,

    // Cleanup function for graceful exit
    cleanup: () => {
      if (cliManager.current) {
        cliManager.current.kill();
      }
    },
  };
}
