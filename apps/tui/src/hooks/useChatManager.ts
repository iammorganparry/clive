/**
 * useChatManager Hook
 *
 * Top-level multi-chat state manager for the Conductor-like TUI layout.
 * Manages multiple worktrees, each with multiple chat tabs.
 * Each chat gets its own CliManager instance and XState machine actor.
 */

import { useQueryClient } from "@tanstack/react-query";
import { createActor } from "xstate";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Effect, Runtime } from "effect";
import { CliManager, type CliManagerOptions } from "../services/CliManager";
import { ConversationWatcher } from "../services/ConversationWatcher";
import { WorktreeService } from "../services/WorktreeService";
import type { BuildConfig } from "../services/prompts";
import { PromptService, PromptServiceLive } from "../services/prompts";
import { SessionMetadataService } from "../services/SessionMetadataService";
import { createChatMachine, type ChatMachineContext } from "../machines/chatMachine";
import type {
  ChatContext,
  FocusZone,
  OutputLine,
  QuestionData,
  Session,
  WorktreeContext,
} from "../types";
import { loadCommand } from "../utils/command-loader";
import { debugLog } from "../utils/debug-logger";
import { taskQueryKeys } from "./useTaskQueries";

// Unique ID generator
let nextChatId = 0;
function generateChatId(): string {
  nextChatId += 1;
  return `chat-${Date.now()}-${nextChatId}`;
}

export interface ChatManagerState {
  // Worktree state
  worktrees: WorktreeContext[];
  activeWorktreePath: string | null;

  // Active chat derived state
  activeChat: ChatContext | null;
  activeChatId: string | null;

  // Focus
  focusZone: FocusZone;

  // Convenience derived state for the active chat
  currentOutputLines: OutputLine[];
  currentPendingQuestion: QuestionData | null;
  currentMode: "none" | "plan" | "build" | "review";
  currentIsRunning: boolean;

  // Sessions (Linear issues)
  activeSession: Session | null;

  // Actions
  selectWorktree: (path: string) => void;
  createChat: (worktreePath?: string, mode?: "plan" | "build" | "review") => void;
  selectChat: (chatId: string) => void;
  closeChat: (chatId: string) => void;
  executeCommand: (cmd: string) => void;
  sendMessage: (msg: string) => void;
  handleQuestionAnswer: (answers: Record<string, string>) => void;
  interrupt: () => void;
  cycleMode: () => void;
  setFocusZone: (zone: FocusZone) => void;
  cycleFocusZone: () => void;
  setActiveSession: (session: Session | null) => void;
  cleanup: () => void;
}

export function useChatManager(
  mainWorkspaceRoot: string,
  issueTracker?: "linear" | "beads" | null,
): ChatManagerState {
  const queryClient = useQueryClient();

  // Core state
  const [worktrees, setWorktrees] = useState<WorktreeContext[]>(() => [
    {
      path: mainWorkspaceRoot,
      branch: "main",
      isMain: true,
      chats: [],
      activeChatId: null,
    },
  ]);
  const [activeWorktreePath, setActiveWorktreePath] = useState<string | null>(
    mainWorkspaceRoot,
  );
  const [focusZone, setFocusZone] = useState<FocusZone>("main");
  const [activeSession, setActiveSession] = useState<Session | null>(null);

  // Per-chat resources
  const cliManagers = useRef<Map<string, CliManager>>(new Map());
  const chatActors = useRef<
    Map<string, ReturnType<typeof createActor<ReturnType<typeof createChatMachine>>>>
  >(new Map());
  const conversationWatchers = useRef<Map<string, ConversationWatcher>>(new Map());
  const seenQuestionIds = useRef<Map<string, Set<string>>>(new Map());

  // Build loop tracking per-chat
  const buildLoopState = useRef<
    Map<
      string,
      {
        iteration: number;
        maxIterations: number;
        isIterating: boolean;
        lastCompletionMarker: "task-complete" | "all-tasks-complete" | null;
      }
    >
  >(new Map());

  // Refs for latest state in closures
  const activeSessionRef = useRef(activeSession);
  activeSessionRef.current = activeSession;
  const worktreesRef = useRef(worktrees);
  worktreesRef.current = worktrees;

  // Derived: active worktree
  const activeWorktree = useMemo(
    () => worktrees.find((w) => w.path === activeWorktreePath) ?? null,
    [worktrees, activeWorktreePath],
  );

  // Derived: active chat
  const activeChatId = activeWorktree?.activeChatId ?? null;
  const activeChat = useMemo(() => {
    if (!activeWorktree || !activeChatId) return null;
    return activeWorktree.chats.find((c) => c.id === activeChatId) ?? null;
  }, [activeWorktree, activeChatId]);

  // Derived: current chat state
  const currentOutputLines = activeChat?.outputLines ?? [];
  const currentPendingQuestion = activeChat?.pendingQuestion ?? null;
  const currentMode = activeChat?.mode ?? "none";
  const currentIsRunning = activeChat?.isRunning ?? false;

  // Helper to update a specific chat's state
  const updateChat = useCallback(
    (chatId: string, updater: (chat: ChatContext) => ChatContext) => {
      setWorktrees((prev) =>
        prev.map((wt) => ({
          ...wt,
          chats: wt.chats.map((c) => (c.id === chatId ? updater(c) : c)),
        })),
      );
    },
    [],
  );

  // Helper to add output line to a chat
  const addOutputToChat = useCallback(
    (chatId: string, line: OutputLine) => {
      updateChat(chatId, (c) => ({
        ...c,
        outputLines: [...c.outputLines, line],
      }));
    },
    [updateChat],
  );

  // Helper to add system message
  const addSystemMessage = useCallback(
    (chatId: string, text: string) => {
      addOutputToChat(chatId, { text, type: "system" });
    },
    [addOutputToChat],
  );

  /**
   * Initialize a CliManager for a chat and wire up events
   */
  const initCliManager = useCallback(
    (chatId: string) => {
      const cli = new CliManager();
      cliManagers.current.set(chatId, cli);
      seenQuestionIds.current.set(chatId, new Set());

      // Route output events to the specific chat
      cli.on("output", (line: OutputLine) => {
        if (line.type === "question" && line.question) {
          const seen = seenQuestionIds.current.get(chatId);
          const qid = line.question.toolUseID;
          const hasQuestions = line.question.questions.length > 0;

          if (seen?.has(qid) && hasQuestions) {
            // Override empty question with complete data
            updateChat(chatId, (c) => ({
              ...c,
              pendingQuestion:
                c.pendingQuestion?.toolUseID === qid
                  ? line.question!
                  : c.pendingQuestion,
            }));
          } else if (!seen?.has(qid)) {
            if (hasQuestions) seen?.add(qid);
            updateChat(chatId, (c) => {
              if (c.pendingQuestion) {
                return {
                  ...c,
                  questionQueue: [...c.questionQueue, line.question!],
                };
              }
              return { ...c, pendingQuestion: line.question! };
            });
          }
        }

        addOutputToChat(chatId, line);
      });

      cli.on("complete", () => {
        const loop = buildLoopState.current.get(chatId);
        if (loop?.isIterating) {
          if (loop.lastCompletionMarker === "task-complete") {
            const nextIteration = loop.iteration + 1;
            if (nextIteration > loop.maxIterations) {
              loop.isIterating = false;
              updateChat(chatId, (c) => ({
                ...c,
                isRunning: false,
                pendingQuestion: null,
                questionQueue: [],
              }));
              addSystemMessage(
                chatId,
                `Build loop reached max iterations (${loop.maxIterations}). Stopping.`,
              );
              return;
            }

            updateChat(chatId, (c) => ({ ...c, isRunning: false }));
            addSystemMessage(
              chatId,
              `Task complete. Starting iteration ${nextIteration}/${loop.maxIterations}...`,
            );

            setTimeout(() => {
              startBuildIteration(chatId, nextIteration);
            }, 1500);
            return;
          }

          if (loop.lastCompletionMarker === "all-tasks-complete") {
            loop.isIterating = false;
            updateChat(chatId, (c) => ({
              ...c,
              isRunning: false,
              pendingQuestion: null,
              questionQueue: [],
            }));
            addSystemMessage(chatId, "All tasks complete. Build loop finished.");
            return;
          }

          // No marker
          loop.isIterating = false;
          updateChat(chatId, (c) => ({
            ...c,
            isRunning: false,
            pendingQuestion: null,
            questionQueue: [],
          }));
          addSystemMessage(
            chatId,
            "Agent finished without completion marker. Build loop stopped.",
          );
          return;
        }

        updateChat(chatId, (c) => ({
          ...c,
          isRunning: false,
          pendingQuestion: null,
          questionQueue: [],
        }));
        seenQuestionIds.current.get(chatId)?.clear();
      });

      cli.on("killed", () => {
        updateChat(chatId, (c) => ({
          ...c,
          isRunning: false,
          pendingQuestion: null,
          questionQueue: [],
        }));
      });

      cli.on("task-complete", () => {
        const loop = buildLoopState.current.get(chatId);
        if (loop) loop.lastCompletionMarker = "task-complete";
      });

      cli.on("all-tasks-complete", () => {
        const loop = buildLoopState.current.get(chatId);
        if (loop) loop.lastCompletionMarker = "all-tasks-complete";
      });

      return cli;
    },
    [updateChat, addOutputToChat, addSystemMessage],
  );

  /**
   * Start a build iteration for a specific chat
   */
  const startBuildIteration = useCallback(
    async (chatId: string, iteration: number) => {
      const cli = cliManagers.current.get(chatId);
      if (!cli) return;

      const loop = buildLoopState.current.get(chatId);
      if (!loop) return;

      loop.iteration = iteration;
      loop.lastCompletionMarker = null;

      // Find the chat's worktree
      const chat = worktreesRef.current
        .flatMap((w) => w.chats)
        .find((c) => c.id === chatId);
      if (!chat) return;

      const effectiveWorkspaceRoot = chat.worktreePath;
      const currentSession = activeSessionRef.current;
      const epicId = currentSession?.linearData?.id;
      const epicIdentifier = currentSession?.linearData?.identifier;

      const buildConfig: BuildConfig = {
        workspaceRoot: effectiveWorkspaceRoot,
        mode: "build",
        issueTracker: issueTracker ?? undefined,
        epicId,
        epicIdentifier,
        iteration,
        maxIterations: loop.maxIterations,
      };

      let systemPrompt: string;
      try {
        const promptProgram = Effect.gen(function* () {
          const promptService = yield* PromptService;
          return yield* promptService.buildPrompt(buildConfig);
        });
        systemPrompt = await Runtime.runPromise(Runtime.defaultRuntime)(
          promptProgram.pipe(Effect.provide(PromptServiceLive)),
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        addSystemMessage(
          chatId,
          `Failed to build prompt for iteration ${iteration}: ${msg}`,
        );
        loop.isIterating = false;
        updateChat(chatId, (c) => ({ ...c, isRunning: false }));
        return;
      }

      cli.clear();
      updateChat(chatId, (c) => ({
        ...c,
        outputLines: [],
        isRunning: true,
      }));

      const command = loadCommand("build", effectiveWorkspaceRoot);
      const commandMeta = command?.metadata;

      addSystemMessage(
        chatId,
        `Starting iteration ${iteration}/${loop.maxIterations}...`,
      );

      cli
        .execute(
          `Continue with the next task. This is iteration ${iteration} of ${loop.maxIterations}.`,
          {
            workspaceRoot: effectiveWorkspaceRoot,
            model: commandMeta?.model,
            systemPrompt,
            mode: "build",
            allowedTools: commandMeta?.allowedTools,
            disallowedTools: commandMeta?.deniedTools,
            epicId,
            epicIdentifier,
          },
        )
        .catch((error: Error) => {
          addSystemMessage(
            chatId,
            `Iteration ${iteration} error: ${error.message}`,
          );
          loop.isIterating = false;
          updateChat(chatId, (c) => ({ ...c, isRunning: false }));
        });
    },
    [issueTracker, updateChat, addSystemMessage],
  );

  /**
   * Start execution in a specific chat
   */
  const startExecution = useCallback(
    async (
      chatId: string,
      prompt: string,
      mode: "plan" | "build" | "review",
      userMessage?: string,
      continuingSession = false,
      resumeSessionId?: string,
    ) => {
      const cli = cliManagers.current.get(chatId);
      if (!cli) return;

      const chat = worktreesRef.current
        .flatMap((w) => w.chats)
        .find((c) => c.id === chatId);
      if (!chat) return;

      if (!continuingSession && !resumeSessionId) {
        updateChat(chatId, (c) => ({ ...c, outputLines: [] }));
        cli.clear();
      }

      if (userMessage) {
        addOutputToChat(chatId, { text: userMessage, type: "user" });
      }

      updateChat(chatId, (c) => ({
        ...c,
        isRunning: true,
        mode,
      }));

      const effectiveWorkspaceRoot = chat.worktreePath;
      const epicId = activeSession?.linearData?.id;
      const epicIdentifier = activeSession?.linearData?.identifier;

      // Build system prompt
      const buildConfig: BuildConfig = {
        workspaceRoot: effectiveWorkspaceRoot,
        mode,
        issueTracker: issueTracker ?? undefined,
        epicId,
        epicIdentifier,
      };

      let systemPrompt: string;
      try {
        const promptProgram = Effect.gen(function* () {
          const promptService = yield* PromptService;
          return yield* promptService.buildPrompt(buildConfig);
        });
        systemPrompt = await Runtime.runPromise(Runtime.defaultRuntime)(
          promptProgram.pipe(Effect.provide(PromptServiceLive)),
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        addSystemMessage(chatId, `Failed to build prompt: ${msg}`);
        updateChat(chatId, (c) => ({ ...c, isRunning: false }));
        return;
      }

      const command = loadCommand(mode, effectiveWorkspaceRoot);
      const commandMeta = command?.metadata;

      cli
        .execute(prompt, {
          workspaceRoot: effectiveWorkspaceRoot,
          model: commandMeta?.model,
          systemPrompt,
          mode,
          resumeSessionId,
          allowedTools: commandMeta?.allowedTools,
          disallowedTools: commandMeta?.deniedTools,
          epicId,
          epicIdentifier,
        })
        .catch((error: Error) => {
          addSystemMessage(chatId, `Execution error: ${error.message}`);
          updateChat(chatId, (c) => ({ ...c, isRunning: false }));
        });
    },
    [
      activeSession,
      issueTracker,
      updateChat,
      addOutputToChat,
      addSystemMessage,
    ],
  );

  // ── Actions ──

  const selectWorktree = useCallback((path: string) => {
    setActiveWorktreePath(path);
  }, []);

  const createChat = useCallback(
    (worktreePath?: string, mode?: "plan" | "build" | "review") => {
      let targetPath = worktreePath || activeWorktreePath;

      // If no specific worktree and the active one is main, create a standalone worktree
      if (!worktreePath) {
        const activeWt = worktreesRef.current.find(
          (w) => w.path === activeWorktreePath,
        );
        if (activeWt?.isMain) {
          const result = WorktreeService.createStandaloneWorktree(mainWorkspaceRoot);
          if (result.success && result.metadata) {
            targetPath = result.metadata.worktreePath;

            // Add the new worktree to state
            const newWt: WorktreeContext = {
              path: result.metadata.worktreePath,
              branch: result.metadata.branchName,
              isMain: false,
              chats: [],
              activeChatId: null,
            };

            setWorktrees((prev) => [...prev, newWt]);
            setActiveWorktreePath(targetPath);

            // Invalidate worktree list
            queryClient.invalidateQueries({ queryKey: ["worktrees"] });
          } else {
            // Fallback: create chat in main worktree
            targetPath = mainWorkspaceRoot;
          }
        }
      }

      if (!targetPath) targetPath = mainWorkspaceRoot;

      const chatId = generateChatId();
      const newChat: ChatContext = {
        id: chatId,
        worktreePath: targetPath,
        mode: mode || "none",
        label: "New chat",
        outputLines: [],
        pendingQuestion: null,
        questionQueue: [],
        isRunning: false,
        createdAt: new Date(),
      };

      // Initialize CliManager for this chat
      initCliManager(chatId);

      // Add chat to the target worktree
      setWorktrees((prev) =>
        prev.map((wt) => {
          if (wt.path === targetPath) {
            return {
              ...wt,
              chats: [...wt.chats, newChat],
              activeChatId: chatId,
            };
          }
          return wt;
        }),
      );

      // Ensure the target worktree is active
      setActiveWorktreePath(targetPath);

      debugLog("useChatManager", "Created chat", {
        chatId,
        worktreePath: targetPath,
        mode,
      });
    },
    [activeWorktreePath, mainWorkspaceRoot, initCliManager, queryClient],
  );

  const selectChat = useCallback(
    (chatId: string) => {
      setWorktrees((prev) =>
        prev.map((wt) => {
          if (wt.chats.some((c) => c.id === chatId)) {
            return { ...wt, activeChatId: chatId };
          }
          return wt;
        }),
      );
    },
    [],
  );

  const closeChat = useCallback(
    (chatId: string) => {
      // Kill the CliManager
      const cli = cliManagers.current.get(chatId);
      if (cli) {
        cli.kill();
        cli.removeAllListeners();
        cliManagers.current.delete(chatId);
      }

      // Clean up other resources
      seenQuestionIds.current.delete(chatId);
      buildLoopState.current.delete(chatId);

      const watcher = conversationWatchers.current.get(chatId);
      if (watcher) {
        watcher.stop();
        watcher.removeAllListeners();
        conversationWatchers.current.delete(chatId);
      }

      // Remove from state and select next available chat
      setWorktrees((prev) =>
        prev.map((wt) => {
          const idx = wt.chats.findIndex((c) => c.id === chatId);
          if (idx === -1) return wt;

          const newChats = wt.chats.filter((c) => c.id !== chatId);
          let newActiveChatId = wt.activeChatId;

          if (wt.activeChatId === chatId) {
            // Select the previous tab, or the next one, or null
            const newIdx = Math.min(idx, newChats.length - 1);
            newActiveChatId = newIdx >= 0 ? newChats[newIdx]!.id : null;
          }

          return {
            ...wt,
            chats: newChats,
            activeChatId: newActiveChatId,
          };
        }),
      );
    },
    [],
  );

  const executeCommand = useCallback(
    (cmd: string) => {
      if (!cmd.trim()) return;

      const currentChatId = activeChatId;
      if (!currentChatId) {
        // Auto-create a chat if none exists
        createChat();
        // The command will be re-issued after the chat is created
        return;
      }

      const chat = worktreesRef.current
        .flatMap((w) => w.chats)
        .find((c) => c.id === currentChatId);
      if (!chat) return;

      const isSlashCommand = cmd.startsWith("/");
      const inActiveMode = chat.mode !== "none";

      // If in active mode and not a slash command, continue conversation
      if (inActiveMode && !isSlashCommand) {
        if (chat.isRunning) {
          addSystemMessage(
            currentChatId,
            "Still processing... please wait for the current turn to complete.",
          );
          return;
        }

        startExecution(
          currentChatId,
          cmd,
          chat.mode as "plan" | "build" | "review",
          `> ${cmd}`,
          true,
        );
        return;
      }

      if (isSlashCommand) {
        handleSlashCommand(currentChatId, cmd);
        return;
      }

      addSystemMessage(
        currentChatId,
        "No process running. Use /plan or /build to start, or press Shift+Tab to set a mode.",
      );
    },
    [activeChatId, createChat, startExecution, addSystemMessage],
  );

  const handleSlashCommand = useCallback(
    (chatId: string, cmd: string) => {
      const parts = cmd.split(" ");
      const command = parts[0]!.toLowerCase();
      const args = parts.slice(1).join(" ").trim();

      switch (command) {
        case "/plan": {
          const resumeMatch = args.match(/--resume=([a-f0-9-]+)/);
          const resumeSessionId = resumeMatch ? resumeMatch[1] : undefined;
          const cleanArgs = args.replace(/--resume=[a-f0-9-]+\s*/, "").trim();

          if (resumeSessionId) {
            addSystemMessage(
              chatId,
              `Resuming conversation: ${resumeSessionId.substring(0, 8)}...`,
            );
            startExecution(
              chatId,
              cleanArgs || "Continue the conversation",
              "plan",
              `> ${cleanArgs || "Continue the conversation"}`,
              false,
              resumeSessionId,
            );
            break;
          }

          const prompt = cleanArgs || "Create a plan for the current task";
          startExecution(chatId, prompt, "plan", cleanArgs ? `> ${cleanArgs}` : undefined);
          break;
        }

        case "/build": {
          const buildResumeMatch = args.match(/--resume=([a-f0-9-]+)/);
          const buildResumeSessionId = buildResumeMatch ? buildResumeMatch[1] : undefined;
          const buildCleanArgs = args.replace(/--resume=[a-f0-9-]+\s*/, "").trim();

          if (buildResumeSessionId) {
            addSystemMessage(
              chatId,
              `Resuming build: ${buildResumeSessionId.substring(0, 8)}...`,
            );
            startExecution(
              chatId,
              buildCleanArgs || "Continue the build",
              "build",
              `> ${buildCleanArgs || "Continue the build"}`,
              false,
              buildResumeSessionId,
            );
            break;
          }

          const maxIterMatch = buildCleanArgs.match(/--max-iterations=(\d+)/);
          const maxIter = maxIterMatch ? parseInt(maxIterMatch[1]!, 10) : 10;
          const buildPromptArgs = buildCleanArgs
            .replace(/--max-iterations=\d+\s*/, "")
            .trim();

          buildLoopState.current.set(chatId, {
            iteration: 1,
            maxIterations: maxIter,
            isIterating: true,
            lastCompletionMarker: null,
          });

          const buildPrompt = buildPromptArgs || "Execute the plan";
          startExecution(
            chatId,
            buildPrompt,
            "build",
            buildPromptArgs ? `> ${buildPromptArgs}` : undefined,
          );
          break;
        }

        case "/exit": {
          const chat = worktreesRef.current
            .flatMap((w) => w.chats)
            .find((c) => c.id === chatId);
          if (chat && chat.mode !== "none") {
            const cli = cliManagers.current.get(chatId);
            cli?.kill();
            cli?.clear();
            updateChat(chatId, (c) => ({
              ...c,
              mode: "none",
              isRunning: false,
              pendingQuestion: null,
              questionQueue: [],
            }));
            addSystemMessage(chatId, `Exited ${chat.mode} mode`);
          } else {
            addSystemMessage(chatId, "Not currently in any mode");
          }
          break;
        }

        case "/clear":
          updateChat(chatId, (c) => ({ ...c, outputLines: [] }));
          break;

        case "/cancel":
        case "/stop": {
          const cli = cliManagers.current.get(chatId);
          if (cli) {
            cli.interrupt();
            addSystemMessage(chatId, "Execution interrupted");
          }
          const loop = buildLoopState.current.get(chatId);
          if (loop) loop.isIterating = false;
          updateChat(chatId, (c) => ({
            ...c,
            isRunning: false,
            pendingQuestion: null,
            questionQueue: [],
          }));
          break;
        }

        case "/help":
          addSystemMessage(
            chatId,
            [
              "Clive TUI Commands:",
              "",
              "/plan [prompt]  - Create a plan",
              "/build [prompt] - Execute a task",
              "/clear         - Clear output",
              "/cancel        - Stop execution",
              "/help          - Show this help",
              "",
              "Shortcuts:",
              "Shift+Tab      - Cycle mode (plan/build/review)",
              "Tab            - Cycle focus zone",
              "Ctrl+1-9       - Direct tab selection",
            ].join("\n"),
          );
          break;

        default:
          addSystemMessage(chatId, `Unknown command: ${command}`);
      }
    },
    [startExecution, updateChat, addSystemMessage],
  );

  const sendMessage = useCallback(
    (msg: string) => {
      if (!activeChatId) return;
      const cli = cliManagers.current.get(activeChatId);
      if (!cli) return;
      cli.sendMessageToAgent(msg);
      addOutputToChat(activeChatId, { text: `> ${msg}`, type: "user" });
    },
    [activeChatId, addOutputToChat],
  );

  const handleQuestionAnswer = useCallback(
    (answers: Record<string, string>) => {
      if (!activeChatId) return;

      const chat = worktreesRef.current
        .flatMap((w) => w.chats)
        .find((c) => c.id === activeChatId);
      if (!chat?.pendingQuestion) return;

      const toolUseID = chat.pendingQuestion.toolUseID;

      // Handle internal questions
      if (toolUseID.startsWith("internal:")) {
        updateChat(activeChatId, (c) => {
          const nextQuestion = c.questionQueue[0] ?? null;
          return {
            ...c,
            pendingQuestion: nextQuestion,
            questionQueue: c.questionQueue.slice(nextQuestion ? 1 : 0),
          };
        });

        if (toolUseID.startsWith("internal:review-transition")) {
          const answer = Object.values(answers)[0];
          if (answer === "Start Build") {
            setTimeout(() => executeCommand("/build"), 100);
          }
        }
        return;
      }

      const cli = cliManagers.current.get(activeChatId);
      if (!cli) return;

      cli.sendToolResult(toolUseID, JSON.stringify(answers));

      updateChat(activeChatId, (c) => {
        const nextQuestion = c.questionQueue[0] ?? null;
        return {
          ...c,
          pendingQuestion: nextQuestion,
          questionQueue: c.questionQueue.slice(nextQuestion ? 1 : 0),
        };
      });
    },
    [activeChatId, updateChat, executeCommand],
  );

  const interrupt = useCallback(() => {
    if (!activeChatId) return;
    const cli = cliManagers.current.get(activeChatId);
    if (cli) {
      cli.interrupt();
      addSystemMessage(activeChatId, "Execution interrupted");
    }
    const loop = buildLoopState.current.get(activeChatId);
    if (loop) loop.isIterating = false;
    updateChat(activeChatId, (c) => ({
      ...c,
      isRunning: false,
      pendingQuestion: null,
      questionQueue: [],
    }));
  }, [activeChatId, updateChat, addSystemMessage]);

  const cycleMode = useCallback(() => {
    if (!activeChatId) return;

    const modeOrder: Array<"none" | "plan" | "build" | "review"> = [
      "none",
      "plan",
      "build",
      "review",
    ];

    updateChat(activeChatId, (c) => {
      const currentIdx = modeOrder.indexOf(c.mode);
      const nextMode = modeOrder[(currentIdx + 1) % modeOrder.length]!;

      if (c.isRunning) {
        // Don't actually change mode while running, just warn
        return c;
      }

      return { ...c, mode: nextMode };
    });

    // Show feedback
    const chat = worktreesRef.current
      .flatMap((w) => w.chats)
      .find((c) => c.id === activeChatId);
    if (chat?.isRunning) {
      addSystemMessage(activeChatId, "Cannot change mode while running");
    }
  }, [activeChatId, updateChat, addSystemMessage]);

  const cycleFocusZone = useCallback(() => {
    setFocusZone((prev) => {
      const order: FocusZone[] = ["sidebar", "tabs", "main"];
      const idx = order.indexOf(prev);
      return order[(idx + 1) % order.length]!;
    });
  }, []);

  const cleanup = useCallback(() => {
    for (const [, cli] of cliManagers.current) {
      cli.kill();
      cli.removeAllListeners();
    }
    cliManagers.current.clear();

    for (const [, watcher] of conversationWatchers.current) {
      watcher.stop();
      watcher.removeAllListeners();
    }
    conversationWatchers.current.clear();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    worktrees,
    activeWorktreePath,
    activeChat,
    activeChatId,
    focusZone,
    currentOutputLines,
    currentPendingQuestion,
    currentMode,
    currentIsRunning,
    activeSession,

    selectWorktree,
    createChat,
    selectChat,
    closeChat,
    executeCommand,
    sendMessage,
    handleQuestionAnswer,
    interrupt,
    cycleMode,
    setFocusZone,
    cycleFocusZone,
    setActiveSession,
    cleanup,
  };
}
