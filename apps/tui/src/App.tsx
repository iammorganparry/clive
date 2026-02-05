/**
 * Root App component for Clive TUI
 * Integrates state management, components, and keyboard handling
 * View flow: Setup -> Mode Selection -> (Worker | Selection -> Main) <-> Help
 */

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DynamicInput } from "./components/DynamicInput";
import { calculateQuestionHeight } from "./components/QuestionPanel";
import { HelpView } from "./components/HelpView";
import { LinearConfigFlow } from "./components/LinearConfigFlow";
import { LinearSettingsView } from "./components/LinearSettingsView";
import { Logo } from "./components/Logo";
import { ModeSelectionView } from "./components/ModeSelectionView";
import { OutputPanel, type OutputPanelRef } from "./components/OutputPanel";
import { SelectionView } from "./components/SelectionView";
import { SetupView } from "./components/SetupView";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TabBar, type TabInfo } from "./components/TabBar";
import { WorkerConfigFlow } from "./components/WorkerConfigFlow";
import { WorktreeSidebar } from "./components/WorktreeSidebar";
import { useAppState } from "./hooks/useAppState";
import { useChatManager } from "./hooks/useChatManager";
import { useAllConversations } from "./hooks/useConversations";
import { useSelectionState } from "./hooks/useSelectionState";
import { useViewMode } from "./hooks/useViewMode";
import { useWorktreeList } from "./hooks/useWorktreeList";
import {
  type InterviewRequest,
  useWorkerConnection,
} from "./hooks/useWorkerConnection";
import type { Conversation } from "./services/ConversationService";
import {
  type ChatMessage,
  WorkerSessionManager,
} from "./services/WorkerSessionManager";
import { OneDarkPro } from "./styles/theme";
import type { FocusZone, OutputLine, QuestionData, Session, Task } from "./types";
import type { WorkerConfig } from "./types/views";

// Create QueryClient instance
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * Convert ChatMessage from WorkerSessionManager to OutputLine for display
 */
function convertChatMessageToOutputLine(msg: ChatMessage): OutputLine {
  switch (msg.type) {
    case "user":
      return { type: "user", text: msg.content };
    case "assistant":
      return { type: "assistant", text: msg.content };
    case "question":
      return {
        type: "question",
        text: msg.content,
        question: msg.questionData
          ? {
              toolUseID: msg.questionData.toolUseID,
              questions: msg.questionData.questions.map((q) => ({
                header: q.header,
                question: q.question,
                options: q.options.map((o) => ({
                  label: o.label,
                  description: o.description,
                })),
                multiSelect: q.multiSelect,
              })),
            }
          : undefined,
        toolUseID: msg.questionData?.toolUseID,
      };
    case "error":
      return { type: "stderr", text: msg.content };
    default:
      return { type: "system", text: msg.content };
  }
}

function AppContent() {
  // Terminal dimensions (responsive to terminal size)
  const { width, height } = useTerminalDimensions();

  // View mode management
  const {
    viewMode,
    config,
    goToSetup,
    goToModeSelection,
    goToWorkerSetup,
    goToWorker,
    goToSelection,
    goToMain,
    goToHelp,
    goToLinearSettings,
    goBack,
    updateConfig,
  } = useViewMode();

  // Mode selection state
  const [modeSelectedIndex, setModeSelectedIndex] = useState(0);
  // Check if Linear is configured - either by issueTracker field or presence of linear config
  const isLinearConfigured =
    config?.issueTracker === "linear" ||
    !!(config?.linear?.apiKey && config?.linear?.teamID);
  const modeOptions = isLinearConfigured
    ? ["interactive", "worker", "linear_settings"]
    : ["interactive", "worker"];

  // Setup view state
  const [setupSelectedIndex, setSetupSelectedIndex] = useState(0);
  const setupOptions = ["linear", "beads"];
  const [configFlow, setConfigFlow] = useState<"linear" | "beads" | null>(null);

  // Input focus state — managed by viewMode effect below
  const [inputFocused, setInputFocused] = useState(false);
  const [preFillValue, setPreFillValue] = useState<string | undefined>(
    undefined,
  );

  // Output panel ref for scroll control
  const outputPanelRef = useRef<OutputPanelRef>(null);

  // Pending resume command (set when resuming a conversation before chat exists)
  const pendingResumeRef = useRef<string | null>(null);

  // Worker mode state - per-session tracking for multi-session support
  const [workerSessionOutputs, setWorkerSessionOutputs] = useState<
    Map<string, OutputLine[]>
  >(new Map());
  const [workerSessionRunning, setWorkerSessionRunning] = useState<
    Map<string, boolean>
  >(new Map());
  const [activeWorkerSessionId, setActiveWorkerSessionId] = useState<
    string | null
  >(null);
  const sessionManagerRef = useRef<WorkerSessionManager | null>(null);

  // Worker mode: dedicated question state per session (avoids fragile last-output-line derivation)
  const [workerPendingQuestions, setWorkerPendingQuestions] = useState<
    Map<string, { question: QuestionData; toolUseID: string }>
  >(new Map());

  // Clear preFillValue after it's been used
  useEffect(() => {
    if (preFillValue && inputFocused) {
      // Clear it on next tick so DynamicInput can read it
      const timer = setTimeout(() => setPreFillValue(undefined), 100);
      return () => clearTimeout(timer);
    }
  }, [preFillValue, inputFocused]);

  // State management
  // Get workspace root from user's current terminal directory
  // In development, this can be overridden via --workspace flag
  const workspaceRoot = process.env.CLIVE_WORKSPACE || process.cwd();

  // Chat manager for multi-chat/worktree support (used in main view)
  const chatManager = useChatManager(workspaceRoot, config?.issueTracker);

  // Auto-focus input on main view (follows focus zone), unfocus on other views
  useEffect(() => {
    if (viewMode === "main") {
      setInputFocused(chatManager.focusZone === "main");
    } else if (viewMode === "worker") {
      setInputFocused(true);
    } else {
      setInputFocused(false);
    }
  }, [viewMode, chatManager.focusZone]);

  // Worktree list for sidebar
  const { data: worktreeList = [] } = useWorktreeList(workspaceRoot);

  // Sidebar navigation state
  const [sidebarSelectedIndex, setSidebarSelectedIndex] = useState(0);
  const [sidebarExpandedPaths, setSidebarExpandedPaths] = useState<Set<string>>(
    () => new Set([workspaceRoot]),
  );
  const [tabSelectedIndex, setTabSelectedIndex] = useState(0);

  // Worker callbacks for handling messages from central service
  const handleWorkerInterviewRequest = useCallback(
    (request: InterviewRequest) => {
      const sessionId = request.sessionId;
      // Initialize session output and mark as running
      setWorkerSessionOutputs((prev) => {
        const next = new Map(prev);
        next.set(sessionId, []);
        return next;
      });
      setWorkerSessionRunning((prev) => {
        const next = new Map(prev);
        next.set(sessionId, true);
        return next;
      });
      // Auto-select new session if no active session
      setActiveWorkerSessionId((current) => current ?? sessionId);
      sessionManagerRef.current?.startInterview(request, (event) => {
        workerConnectionRef.current?.sendEvent(event);
      }).catch((error) => {
        // Handle any unhandled errors from startInterview
        console.error(`[App] Interview ${sessionId} failed to start:`, error);
        setWorkerSessionRunning((prev) => {
          const next = new Map(prev);
          next.set(sessionId, false);
          return next;
        });
        // Notify central service of the error
        workerConnectionRef.current?.sendEvent({
          sessionId,
          type: "error",
          payload: {
            type: "error",
            message: `Failed to start interview: ${String(error)}`,
          },
          timestamp: new Date().toISOString(),
        });
        workerConnectionRef.current?.completeSession(sessionId);
      });
    },
    [],
  );

  const handleWorkerAnswer = useCallback(
    (sessionId: string, toolUseId: string, answers: Record<string, string>) => {
      const success = sessionManagerRef.current?.sendAnswer(sessionId, toolUseId, answers) ?? false;
      if (!success && workerConnectionRef.current) {
        // Send error event to central service before cleaning up
        workerConnectionRef.current.sendEvent({
          sessionId,
          type: "error",
          payload: {
            type: "error",
            message: "Failed to send answer - CLI session may have crashed",
          },
          timestamp: new Date().toISOString(),
        });
        workerConnectionRef.current.completeSession(sessionId);
      }
    },
    [],
  );

  const handleWorkerMessage = useCallback(
    (sessionId: string, message: string) => {
      const success = sessionManagerRef.current?.sendMessage(sessionId, message) ?? false;
      if (!success && workerConnectionRef.current) {
        // Send error event to central service before cleaning up
        workerConnectionRef.current.sendEvent({
          sessionId,
          type: "error",
          payload: {
            type: "error",
            message: "Failed to send message - CLI session may have crashed",
          },
          timestamp: new Date().toISOString(),
        });
        workerConnectionRef.current.completeSession(sessionId);
      }
    },
    [],
  );

  const handleWorkerCancel = useCallback((sessionId: string) => {
    sessionManagerRef.current?.cancelSession(sessionId);
    setWorkerSessionRunning((prev) => {
      const next = new Map(prev);
      next.set(sessionId, false);
      return next;
    });
  }, []);

  // Worker connection (only active when in worker mode or when config.worker.enabled)
  const workerConnection = useWorkerConnection(
    viewMode === "worker" ? config?.worker : undefined,
    workspaceRoot,
    {
      onInterviewRequest: handleWorkerInterviewRequest,
      onAnswer: handleWorkerAnswer,
      onMessage: handleWorkerMessage,
      onCancel: handleWorkerCancel,
    },
  );

  // Ref to access workerConnection in callbacks (avoid circular dependency)
  const workerConnectionRef = useRef(workerConnection);
  useEffect(() => {
    workerConnectionRef.current = workerConnection;
  }, [workerConnection]);

  // Cycle between worker sessions (must be after workerConnection is declared)
  const cycleWorkerSession = useCallback(
    (direction: "next" | "prev") => {
      const sessions = workerConnection.activeSessions;
      if (sessions.length <= 1) return;

      const currentIndex = activeWorkerSessionId
        ? sessions.indexOf(activeWorkerSessionId)
        : -1;

      const nextIndex =
        direction === "next"
          ? (currentIndex + 1) % sessions.length
          : (currentIndex - 1 + sessions.length) % sessions.length;

      setActiveWorkerSessionId(sessions[nextIndex] ?? null);
    },
    [workerConnection.activeSessions, activeWorkerSessionId],
  );

  // Get output lines for the active session
  const activeWorkerOutputLines = activeWorkerSessionId
    ? (workerSessionOutputs.get(activeWorkerSessionId) ?? [])
    : [];
  const activeWorkerIsRunning = activeWorkerSessionId
    ? (workerSessionRunning.get(activeWorkerSessionId) ?? false)
    : false;

  // Initialize WorkerSessionManager when in worker mode
  useEffect(() => {
    if (viewMode === "worker") {
      const sessionManager = new WorkerSessionManager(workspaceRoot);
      sessionManagerRef.current = sessionManager;

      // Listen for messages from session manager - store per-session
      const handleMessage = (sessionId: string, msg: ChatMessage) => {
        const outputLine = convertChatMessageToOutputLine(msg);
        setWorkerSessionOutputs((prev) => {
          const next = new Map(prev);
          const existing = next.get(sessionId) ?? [];
          next.set(sessionId, [...existing, outputLine]);
          return next;
        });

        // Track question state separately so it persists even if more output arrives
        if (msg.type === "question" && msg.questionData) {
          setWorkerPendingQuestions((prev) => {
            const next = new Map(prev);
            next.set(sessionId, {
              question: msg.questionData!,
              toolUseID: msg.questionData!.toolUseID,
            });
            return next;
          });
        }
      };

      const handleComplete = (sessionId: string) => {
        setWorkerSessionRunning((prev) => {
          const next = new Map(prev);
          next.set(sessionId, false);
          return next;
        });
        setWorkerPendingQuestions((prev) => {
          const next = new Map(prev);
          next.delete(sessionId);
          return next;
        });
        workerConnectionRef.current?.completeSession(sessionId);
      };

      const handleError = (sessionId: string, error: string) => {
        setWorkerSessionOutputs((prev) => {
          const next = new Map(prev);
          const existing = next.get(sessionId) ?? [];
          next.set(sessionId, [
            ...existing,
            { type: "stderr" as const, text: error },
          ]);
          return next;
        });
        setWorkerPendingQuestions((prev) => {
          const next = new Map(prev);
          next.delete(sessionId);
          return next;
        });
        // Notify central service of the error
        if (workerConnectionRef.current) {
          workerConnectionRef.current.sendEvent({
            sessionId,
            type: "error",
            payload: {
              type: "error",
              message: error,
            },
            timestamp: new Date().toISOString(),
          });
          workerConnectionRef.current.completeSession(sessionId);
        }
      };

      sessionManager.on("message", handleMessage);
      sessionManager.on("complete", handleComplete);
      sessionManager.on("error", handleError);

      return () => {
        sessionManager.off("message", handleMessage);
        sessionManager.off("complete", handleComplete);
        sessionManager.off("error", handleError);
        sessionManager.closeAll();
        sessionManagerRef.current = null;
      };
    }
    return undefined;
  }, [viewMode, workspaceRoot]);

  // Log workspace context on startup
  useEffect(() => {
    console.log("[Clive TUI] Starting in workspace:", workspaceRoot);
    console.log("[Clive TUI] Claude will have context of this directory");
    if (process.env.CLIVE_WORKSPACE) {
      console.log(
        "[Clive TUI] Workspace overridden via --workspace flag (dev mode)",
      );
    }
  }, [workspaceRoot]);

  // Fetch ALL conversations across all projects
  const { data: allConversations = [], isLoading: conversationsLoading } =
    useAllConversations(100);

  // Scope conversations: keep all Linear-attached conversations (matched by issue),
  // but limit unattached conversations to the current workspace
  const conversations = useMemo(
    () =>
      allConversations.filter(
        (c) => c.linearProjectId || c.linearTaskId || c.project === workspaceRoot,
      ),
    [allConversations, workspaceRoot],
  );

  const {
    outputLines,
    isRunning,
    pendingQuestion,
    mode,
    agentSessionActive,
    sessions,
    sessionsLoading,
    sessionsError,
    tasks,
    tasksLoading,
    activeSession,
    setActiveSession,
    executeCommand,
    sendMessage,
    handleQuestionAnswer,
    interrupt,
    cleanup,
  } = useAppState(workspaceRoot, config?.issueTracker);

  // Tasks per worktree (for sidebar display)
  const tasksPerWorktree = useMemo(() => {
    const map = new Map<string, Task[]>();
    // For now, associate all tasks with the active worktree
    if (chatManager.activeWorktreePath) {
      map.set(chatManager.activeWorktreePath, tasks);
    }
    return map;
  }, [chatManager.activeWorktreePath, tasks]);

  // Note: Auto-scrolling is handled by scrollbox's stickyScroll prop in OutputPanel

  // Selection state using XState machine
  const selectionState = useSelectionState(sessions, conversations);

  // Handler for conversation resume (defined early for auto-resume useEffect)
  const handleConversationResume = useCallback(
    (conversation: Conversation) => {
      console.log("[Clive TUI] Resuming conversation:", conversation.sessionId);
      const resumeMode = conversation.mode || "plan"; // fallback for old sessions
      const resumeCmd = `/${resumeMode} --resume=${conversation.sessionId}`;

      if (chatManager.activeChatId) {
        chatManager.executeCommand(resumeCmd);
      } else {
        chatManager.createChat();
        pendingResumeRef.current = resumeCmd;
      }
      goToMain();
    },
    [chatManager, goToMain],
  );

  // Execute pending resume command when a chat becomes available
  useEffect(() => {
    if (pendingResumeRef.current && chatManager.activeChatId) {
      const cmd = pendingResumeRef.current;
      pendingResumeRef.current = null;
      chatManager.executeCommand(cmd);
    }
  }, [chatManager.activeChatId, chatManager.executeCommand]);

  // Cleanup on process exit (only 'exit' event, SIGINT/SIGTERM handled by main.tsx)
  useEffect(() => {
    const handleExit = () => {
      cleanup();
      chatManager.cleanup();
    };

    process.on("exit", handleExit);

    return () => {
      process.off("exit", handleExit);
    };
  }, [cleanup, chatManager.cleanup]);

  // Keyboard handling using OpenTUI's useKeyboard hook
  // This properly integrates with OpenTUI's stdin management
  useKeyboard((event) => {
    // Skip ALL keyboard handling when input is focused - let input handle everything
    if (inputFocused) {
      // ONLY handle unfocus events
      if (event.name === "escape") {
        setInputFocused(false);
      }
      return; // Exit early, don't process any other keys
    }

    // Skip keyboard handling in config flows
    if (
      configFlow === "linear" ||
      configFlow === "beads" ||
      viewMode === "worker_setup"
    ) {
      return;
    }

    // Global shortcuts
    if (
      event.sequence === "q" &&
      viewMode !== "main" &&
      viewMode !== "worker"
    ) {
      process.exit(0);
    }

    if (event.sequence === "?") {
      if (viewMode === "help") {
        goBack();
      } else {
        goToHelp();
      }
      return;
    }

    // Global shortcut for Linear settings (comma key, like many apps use for settings)
    if (event.sequence === "," && isLinearConfigured) {
      if (viewMode === "linear_settings") {
        goToModeSelection();
      } else if (
        viewMode !== "setup" &&
        viewMode !== "help"
      ) {
        goToLinearSettings();
      }
      return;
    }

    // Scroll to bottom (Ctrl+B, Cmd+B, or End key)
    if (
      ((event.ctrl || event.meta) && event.sequence === "b") ||
      event.name === "end"
    ) {
      if (outputPanelRef.current) {
        outputPanelRef.current.scrollToBottom();
      }
      return;
    }

    // View-specific shortcuts
    if (viewMode === "setup" && !configFlow) {
      if (event.name === "escape") {
        process.exit(0);
      }
      // Arrow key navigation for setup options
      if (event.name === "up" || event.sequence === "k") {
        setSetupSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : setupOptions.length - 1,
        );
      }
      if (event.name === "down" || event.sequence === "j") {
        setSetupSelectedIndex((prev) =>
          prev < setupOptions.length - 1 ? prev + 1 : 0,
        );
      }
      // Number key selection (1, 2, etc.)
      if (event.sequence && /^[1-9]$/.test(event.sequence)) {
        const index = parseInt(event.sequence, 10) - 1;
        if (index < setupOptions.length) {
          const selectedOption = setupOptions[index];
          if (selectedOption === "linear") {
            setConfigFlow("linear");
          } else if (selectedOption === "beads") {
            setConfigFlow("beads");
          }
        }
      }
      if (event.name === "return") {
        const selectedOption = setupOptions[setupSelectedIndex];
        if (selectedOption === "linear") {
          setConfigFlow("linear");
        } else if (selectedOption === "beads") {
          setConfigFlow("beads");
        }
      }
    } else if (viewMode === "mode_selection") {
      if (event.name === "escape") {
        goBack();
        return;
      }
      // Arrow key navigation
      if (event.name === "up" || event.sequence === "k") {
        setModeSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : modeOptions.length - 1,
        );
      }
      if (event.name === "down" || event.sequence === "j") {
        setModeSelectedIndex((prev) =>
          prev < modeOptions.length - 1 ? prev + 1 : 0,
        );
      }
      // Number key selection (1-3 depending on options)
      if (event.sequence && /^[1-3]$/.test(event.sequence)) {
        const index = parseInt(event.sequence, 10) - 1;
        if (index < modeOptions.length) {
          handleModeSelect(modeOptions[index]);
        }
      }
      if (event.name === "return") {
        handleModeSelect(modeOptions[modeSelectedIndex]);
      }
    } else if (viewMode === "linear_settings") {
      // LinearSettingsView handles its own keyboard events
      return;
    } else if (viewMode === "worker") {
      // Allow escape to unfocus input OR exit worker mode
      if (event.name === "escape") {
        goToModeSelection();
        return;
      }
      if (event.sequence === "q") {
        goToModeSelection();
        return;
      }
      if (
        event.sequence === "r" &&
        workerConnection.status === "disconnected"
      ) {
        workerConnection.connect();
        return;
      }
      if (event.ctrl && event.name === "c") {
        cleanup();
        workerConnection.disconnect();
        process.exit(0);
      }
      // Session cycling: Tab or n for next, Shift+Tab or p for previous
      if (event.name === "tab" || event.sequence === "n") {
        cycleWorkerSession("next");
        return;
      }
      if ((event.shift && event.name === "tab") || event.sequence === "p") {
        cycleWorkerSession("prev");
        return;
      }
      // Number keys 1-9 for direct session jump
      if (event.sequence && /^[1-9]$/.test(event.sequence)) {
        const index = parseInt(event.sequence, 10) - 1;
        if (index < workerConnection.activeSessions.length) {
          setActiveWorkerSessionId(
            workerConnection.activeSessions[index] ?? null,
          );
        }
        return;
      }
      // Allow input focus when there's a pending question (i or : to focus)
      if (event.sequence === "i" || event.sequence === ":") {
        setInputFocused(true);
        return;
      }
    } else if (viewMode === "selection") {
      // Escape - clear search, go back to level 1, or go back
      if (event.name === "escape") {
        if (selectionState.searchQuery) {
          // Clear search
          selectionState.clearSearch();
        } else if (selectionState.isLevel2) {
          // Go back to level 1 (issues)
          selectionState.goBack();
        } else {
          // Go back to previous view
          goBack();
        }
        return;
      }

      // Backspace - remove last character from search
      if (event.name === "backspace") {
        if (selectionState.searchQuery) {
          selectionState.search(selectionState.searchQuery.slice(0, -1));
        }
        return;
      }

      // Printable characters - add to search query
      if (
        event.sequence &&
        event.sequence.length === 1 &&
        !event.ctrl &&
        !event.meta &&
        event.name !== "up" &&
        event.name !== "down" &&
        event.name !== "return" &&
        event.name !== "enter" &&
        event.name !== "escape" &&
        event.name !== "backspace"
      ) {
        selectionState.search(selectionState.searchQuery + event.sequence);
        return;
      }

      // Arrow key navigation
      if (event.name === "up" || event.sequence === "k") {
        selectionState.navigateUp();
        return;
      }
      if (event.name === "down" || event.sequence === "j") {
        selectionState.navigateDown();
        return;
      }

      // Enter to select
      if (event.name === "return" || event.name === "enter") {
        if (selectionState.isLevel1) {
          // Level 1: Selecting an issue
          if (selectionState.selectedIndex === -1) {
            // Create new session without issue
            handleCreateNewWithoutIssue();
            return;
          }

          // Include "Other Conversations" group in the list (at the TOP to match SelectionView)
          const issuesWithOther: Session[] = [];
          const unattachedCount = conversations.filter(
            (c) => !c.linearProjectId && !c.linearTaskId,
          ).length;
          if (unattachedCount > 0) {
            // Add "Other Conversations" at the TOP
            issuesWithOther.push({
              id: "__unattached__",
              name: `Other Conversations (${unattachedCount})`,
              createdAt: new Date(),
              source: "linear" as const,
            });
          }
          // Add all Linear sessions after
          issuesWithOther.push(...sessions);

          const filteredSessions = selectionState.searchQuery
            ? issuesWithOther.filter((s) => {
                const query = selectionState.searchQuery.toLowerCase();
                const identifier =
                  s.linearData?.identifier?.toLowerCase() || "";
                const title = s.name.toLowerCase();
                return identifier.includes(query) || title.includes(query);
              })
            : issuesWithOther;

          const displayIssues = filteredSessions.slice(0, 10);
          const issue = displayIssues[selectionState.selectedIndex];
          if (issue) {
            if (issue.id === "__unattached__") {
              // "Other Conversations" → go to Level 2 to browse
              selectionState.selectIssue(issue);
            } else {
              // Linear issue → start fresh session immediately
              handleCreateNewForIssue(issue);
            }
          }
        } else if (selectionState.isLevel2) {
          // Level 2: Selecting a conversation for the issue
          if (selectionState.selectedIndex === -1) {
            // Create new session for this issue
            if (selectionState.selectedIssue) {
              handleCreateNewForIssue(selectionState.selectedIssue);
            }
            return;
          }

          if (!selectionState.selectedIssue) return;

          // Check if this is the "Other Conversations" group
          const selectedIssue = selectionState.selectedIssue;
          const isUnattachedGroup = selectedIssue.id === "__unattached__";

          const conversationsForIssue = isUnattachedGroup
            ? conversations.filter((c) => !c.linearProjectId && !c.linearTaskId)
            : conversations.filter((c) => {
                const issueLinearId = selectedIssue.linearData?.id;
                return (
                  c.linearProjectId === issueLinearId ||
                  c.linearTaskId === issueLinearId
                );
              });

          const filteredConversations = selectionState.searchQuery
            ? conversationsForIssue.filter((c) => {
                const query = selectionState.searchQuery.toLowerCase();
                const display = c.display.toLowerCase();
                const slug = c.slug?.toLowerCase() || "";
                return display.includes(query) || slug.includes(query);
              })
            : conversationsForIssue;

          const displayConversations = filteredConversations.slice(0, 10);
          const conversation =
            displayConversations[selectionState.selectedIndex];
          if (conversation) {
            handleConversationResume(conversation);
          }
        }
        return;
      }
    } else if (viewMode === "main") {
      // Shift+Tab: cycle mode (plan → build → review → none)
      if (event.shift && event.name === "tab") {
        chatManager.cycleMode();
        return;
      }

      // Tab: cycle focus zone (sidebar → tabs → main)
      if (event.name === "tab") {
        chatManager.cycleFocusZone();
        return;
      }

      // Ctrl+C: two-stage handling
      if (event.ctrl && event.name === "c") {
        if (chatManager.currentIsRunning) {
          chatManager.interrupt();
        } else {
          chatManager.cleanup();
          cleanup();
          process.exit(0);
        }
        return;
      }

      // Ctrl+1-9: direct tab selection
      if (event.ctrl && event.sequence && /^[1-9]$/.test(event.sequence)) {
        const index = parseInt(event.sequence, 10) - 1;
        const activeWt = chatManager.worktrees.find(
          (w) => w.path === chatManager.activeWorktreePath,
        );
        const chats = activeWt?.chats ?? [];
        if (index < chats.length) {
          chatManager.selectChat(chats[index]!.id);
        }
        return;
      }

      // Escape: context-dependent
      if (event.name === "escape") {
        if (chatManager.focusZone !== "main") {
          chatManager.setFocusZone("main");
        } else {
          goToSelection();
        }
        return;
      }

      // Input focus shortcuts (only when main zone is active)
      if (chatManager.focusZone === "main") {
        if (event.sequence === "/") {
          setInputFocused(true);
          setPreFillValue("/");
          return;
        }
        if (event.sequence === "i" || event.sequence === ":") {
          setInputFocused(true);
          setPreFillValue(event.sequence === ":" ? ":" : undefined);
          return;
        }
      }
    } else if (viewMode === "help") {
      if (event.name === "escape") {
        goBack();
      }
    }
  });

  // Handler for mode selection
  const handleModeSelect = (mode: string | undefined) => {
    if (!mode) return;
    if (mode === "interactive") {
      goToSelection();
    } else if (mode === "worker") {
      // Check if worker is already configured
      if (config?.worker?.enabled && config?.worker?.token) {
        goToWorker();
      } else {
        goToWorkerSetup();
      }
    } else if (mode === "linear_settings") {
      goToLinearSettings();
    }
  };

  // Handler for worker config completion
  const handleWorkerConfigComplete = (workerConfig: WorkerConfig) => {
    updateConfig({
      ...config!,
      worker: workerConfig,
    });
    if (workerConfig.enabled) {
      goToWorker();
    } else {
      goToModeSelection();
    }
  };

  // Handler for creating new session without issue
  const handleCreateNewWithoutIssue = () => {
    chatManager.createChat();
    chatManager.setFocusZone("main");
    goToMain();
  };

  // Handler for creating new session for specific issue
  const handleCreateNewForIssue = (issue: Session) => {
    chatManager.setActiveSession(issue);
    chatManager.createChat();
    chatManager.setFocusZone("main");
    goToMain();
  };

  // Wrapper for executeCommand to handle special commands and message forwarding
  const handleExecuteCommand = (cmd: string) => {
    const trimmed = cmd.trim();

    // Always handle slash commands
    if (trimmed.startsWith("/")) {
      const lower = trimmed.toLowerCase();
      if (lower === "/resume" || lower.startsWith("/resume ")) {
        goToSelection();
        return;
      }
      chatManager.executeCommand(cmd);
      return;
    }

    // If running, send as message to guide the agent
    if (chatManager.currentIsRunning) {
      chatManager.sendMessage(trimmed);
      return;
    }

    // Otherwise, execute as new command
    chatManager.executeCommand(cmd);
  };

  // Handler for config flow completion
  const handleConfigComplete = (configData: {
    apiKey: string;
    teamID: string;
  }) => {
    updateConfig({
      ...config,
      issueTracker: configFlow as "linear" | "beads",
      [configFlow as string]: configData,
    });
    setConfigFlow(null);
    goToModeSelection();
  };

  // Render appropriate view based on viewMode
  if (viewMode === "setup") {
    // Show config flow if a tracker was selected
    if (configFlow === "linear") {
      return (
        <LinearConfigFlow
          width={width}
          height={height}
          onComplete={handleConfigComplete}
          onCancel={() => setConfigFlow(null)}
        />
      );
    }

    if (configFlow === "beads") {
      // Beads doesn't need configuration, just update config and go to mode selection
      updateConfig({
        ...config,
        issueTracker: "beads",
        beads: {},
      });
      setConfigFlow(null);
      goToModeSelection();
      return null;
    }

    // Show setup view
    return (
      <SetupView
        width={width}
        height={height}
        onComplete={updateConfig}
        onCancel={() => process.exit(0)}
        selectedIndex={setupSelectedIndex}
        onNavigate={setSetupSelectedIndex}
      />
    );
  }

  // Mode selection view
  if (viewMode === "mode_selection") {
    return (
      <ModeSelectionView
        width={width}
        height={height}
        selectedIndex={modeSelectedIndex}
        onNavigate={setModeSelectedIndex}
        onSelectWorker={() => {
          if (config?.worker?.enabled && config?.worker?.token) {
            goToWorker();
          } else {
            goToWorkerSetup();
          }
        }}
        onSelectInteractive={goToSelection}
        onSelectLinearSettings={goToLinearSettings}
        workerConfigured={!!(config?.worker?.enabled && config?.worker?.token)}
        linearConfigured={isLinearConfigured}
      />
    );
  }

  // Worker setup view
  if (viewMode === "worker_setup") {
    return (
      <WorkerConfigFlow
        width={width}
        height={height}
        existingConfig={config?.worker}
        onComplete={handleWorkerConfigComplete}
        onCancel={goToModeSelection}
      />
    );
  }

  // Linear settings view
  if (viewMode === "linear_settings") {
    return (
      <LinearSettingsView
        width={width}
        height={height}
        currentConfig={{
          apiKey: config?.linear?.apiKey || "",
          teamID: config?.linear?.teamID || "",
        }}
        onSave={(linearConfig) => {
          updateConfig({
            ...config!,
            issueTracker: "linear",
            linear: linearConfig,
          });
          goToModeSelection();
        }}
        onCancel={goToModeSelection}
      />
    );
  }

  // Worker mode is now handled in the main view with unified layout

  if (viewMode === "selection") {
    return (
      <SelectionView
        width={width}
        height={height}
        sessions={sessions}
        conversations={conversations}
        sessionsLoading={sessionsLoading}
        conversationsLoading={conversationsLoading}
        sessionsError={sessionsError}
        conversationsError={null}
        selectedIndex={selectionState.selectedIndex}
        searchQuery={selectionState.searchQuery}
        selectedIssue={selectionState.selectedIssue}
        onSelectIssue={(issue) => {
          selectionState.selectIssue(issue);
        }}
        onResumeConversation={handleConversationResume}
        onCreateNew={(issue) => {
          if (issue) {
            handleCreateNewForIssue(issue);
          } else {
            handleCreateNewWithoutIssue();
          }
        }}
        onBack={() => {
          if (selectionState.isLevel2) {
            // Go back to Level 1
            selectionState.goBack();
          } else {
            // Go back to previous view
            goBack();
          }
        }}
      />
    );
  }

  if (viewMode === "help") {
    return <HelpView width={width} height={height} onClose={goBack} />;
  }

  // ── Worker Mode (separate early return) ──
  if (viewMode === "worker") {
    const workerQuestion = activeWorkerSessionId
      ? workerPendingQuestions.get(activeWorkerSessionId)
      : undefined;
    const workerDisplayQuestion = workerQuestion?.question ?? null;

    const baseInputHeight = 3;
    const statusHeight = 1;
    const wQuestionHeight = workerDisplayQuestion
      ? calculateQuestionHeight(workerDisplayQuestion)
      : 0;
    const wDynamicInputHeight = baseInputHeight + wQuestionHeight;
    const wInnerWidth = width;
    const wInnerHeight = height;
    const wBodyHeight = wInnerHeight - wDynamicInputHeight - statusHeight;

    const COMPACT_BREAKPOINT = 80;
    const wIsCompact = wInnerWidth < COMPACT_BREAKPOINT;
    const wSidebarWidth = wIsCompact ? wInnerWidth : 30;
    const wSidebarHeight = wIsCompact ? Math.min(8, Math.floor(wBodyHeight * 0.3)) : wBodyHeight;
    const wOutputWidth = wIsCompact ? wInnerWidth : wInnerWidth - wSidebarWidth;
    const wOutputHeight = wIsCompact ? wBodyHeight - wSidebarHeight : wBodyHeight;

    const handleWorkerQuestionAnswer = (answers: Record<string, string>) => {
      if (workerQuestion && activeWorkerSessionId) {
        sessionManagerRef.current?.sendAnswer(
          activeWorkerSessionId,
          workerQuestion.toolUseID,
          answers,
        );
        setWorkerPendingQuestions((prev) => {
          const next = new Map(prev);
          next.delete(activeWorkerSessionId);
          return next;
        });
      }
    };

    return (
      <box
        width={width}
        height={height}
        backgroundColor={OneDarkPro.background.primary}
        flexDirection="column"
      >
        <box width={wInnerWidth} height={wBodyHeight} flexDirection={wIsCompact ? "column" : "row"}>
          <Sidebar
            width={wSidebarWidth}
            height={wSidebarHeight}
            tasks={tasks}
            activeSession={activeSession}
            layout={wIsCompact ? "horizontal" : "vertical"}
          />
          {activeWorkerOutputLines.length > 0 ? (
            <OutputPanel
              ref={outputPanelRef}
              width={wOutputWidth}
              height={wOutputHeight}
              lines={activeWorkerOutputLines}
              isRunning={activeWorkerIsRunning}
              mode="none"
            />
          ) : (
            <box
              width={wOutputWidth}
              height={wOutputHeight}
              alignItems="center"
              justifyContent="center"
              flexDirection="column"
              backgroundColor={OneDarkPro.background.primary}
            >
              <Logo />
              <text fg={OneDarkPro.foreground.muted} marginTop={2}>
                Worker Mode
              </text>
              <text fg={OneDarkPro.foreground.muted} marginTop={3}>
                Waiting for Slack requests...
              </text>
              <text fg={OneDarkPro.foreground.muted} marginTop={1}>
                Mention @clive in Slack to start a planning session
              </text>
              {workerConnection.status === "ready" && (
                <box marginTop={3} padding={1} backgroundColor={OneDarkPro.background.secondary}>
                  <text fg={OneDarkPro.syntax.green}>Ready to receive requests</text>
                </box>
              )}
              {workerConnection.error && (
                <text fg={OneDarkPro.syntax.red} marginTop={2}>
                  Error: {workerConnection.error}
                </text>
              )}
            </box>
          )}
        </box>
        <DynamicInput
          width={wInnerWidth}
          onSubmit={(msg) => {
            if (activeWorkerSessionId) {
              sessionManagerRef.current?.sendMessage(activeWorkerSessionId, msg);
            }
          }}
          disabled={!workerQuestion}
          isRunning={activeWorkerIsRunning}
          inputFocused={inputFocused}
          onFocusChange={setInputFocused}
          preFillValue={preFillValue}
          pendingQuestion={workerDisplayQuestion}
          onQuestionAnswer={handleWorkerQuestionAnswer}
          onQuestionCancel={() => {
            if (activeWorkerSessionId) {
              sessionManagerRef.current?.cancelSession(activeWorkerSessionId);
            }
          }}
          mode="none"
        />
        <StatusBar
          width={wInnerWidth}
          height={statusHeight}
          isRunning={activeWorkerIsRunning}
          inputFocused={inputFocused}
          workspaceRoot={workspaceRoot}
          workerMode={true}
          workerStatus={workerConnection.status}
          workerId={workerConnection.workerId}
          activeSessions={workerConnection.activeSessions}
          activeSessionId={activeWorkerSessionId}
          workerError={workerConnection.error}
        />
      </box>
    );
  }

  // ── Main View — Conductor-like layout ──

  const displayMode = chatManager.currentMode;
  const isInMode = displayMode !== "none";

  const baseInputHeight = 3;
  const statusHeight = 1;
  const tabBarHeight = 1;

  // Calculate dynamic input height based on pending question
  const questionHeight = chatManager.currentPendingQuestion
    ? calculateQuestionHeight(chatManager.currentPendingQuestion)
    : 0;
  const dynamicInputHeight = baseInputHeight + questionHeight;

  // When border is present, it takes 2 rows (top+bottom) and 2 cols (left+right)
  const borderAdjustment = isInMode ? 2 : 0;
  const innerWidth = width - borderAdjustment;
  const innerHeight = height - borderAdjustment;
  const bodyHeight = innerHeight - dynamicInputHeight - statusHeight;

  // Sidebar layout — responsive breakpoint
  const COMPACT_BREAKPOINT = 80;
  const isCompact = innerWidth < COMPACT_BREAKPOINT;

  const sidebarWidth = isCompact ? 0 : 30;
  const mainWidth = innerWidth - sidebarWidth;
  const mainOutputHeight = bodyHeight - tabBarHeight;

  // Mode colors
  const getModeColor = () => {
    if (displayMode === "plan") return "#3B82F6"; // blue-500
    if (displayMode === "build") return "#F59E0B"; // amber-500
    if (displayMode === "review") return "#10B981"; // green-500
    return undefined;
  };

  // Derive tab info from chatManager
  const activeWorktreeObj = chatManager.worktrees.find(
    (w) => w.path === chatManager.activeWorktreePath,
  );
  const currentBranchName = activeWorktreeObj?.branch;
  const chatTabs: TabInfo[] = (activeWorktreeObj?.chats ?? []).map((c) => ({
    id: c.id,
    label: c.label,
    mode: c.mode,
    isRunning: c.isRunning,
    hasQuestion: c.pendingQuestion !== null,
  }));

  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.primary}
      flexDirection="column"
      borderStyle={isInMode ? "rounded" : undefined}
      borderColor={isInMode ? getModeColor() : undefined}
    >
      {/* Body: Sidebar + (TabBar + Output) */}
      <box width={innerWidth} height={bodyHeight} flexDirection="row">
        {/* WorktreeSidebar (hidden on compact) */}
        {!isCompact && (
          <WorktreeSidebar
            width={sidebarWidth}
            height={bodyHeight}
            worktrees={worktreeList}
            tasksPerWorktree={tasksPerWorktree}
            activeWorktreePath={chatManager.activeWorktreePath}
            focused={chatManager.focusZone === "sidebar"}
            selectedIndex={sidebarSelectedIndex}
            expandedPaths={sidebarExpandedPaths}
            onSelect={(path) => {
              chatManager.selectWorktree(path);
              chatManager.setFocusZone("main");
            }}
            onCreateNew={() => chatManager.createChat()}
            onNavigate={setSidebarSelectedIndex}
            onToggleExpand={(path) => {
              setSidebarExpandedPaths((prev) => {
                const next = new Set(prev);
                if (next.has(path)) next.delete(path);
                else next.add(path);
                return next;
              });
            }}
          />
        )}

        {/* Main column: Tabs + Output */}
        <box width={mainWidth} height={bodyHeight} flexDirection="column">
          {/* Tab Bar */}
          <TabBar
            width={mainWidth}
            tabs={chatTabs}
            activeTabId={chatManager.activeChatId}
            focused={chatManager.focusZone === "tabs"}
            selectedIndex={tabSelectedIndex}
            onSelectTab={(id) => {
              chatManager.selectChat(id);
              chatManager.setFocusZone("main");
            }}
            onCloseTab={chatManager.closeChat}
            onNewTab={() => chatManager.createChat()}
            onNavigate={setTabSelectedIndex}
          />

          {/* Output Panel */}
          <OutputPanel
            ref={outputPanelRef}
            width={mainWidth}
            height={mainOutputHeight}
            lines={chatManager.currentOutputLines}
            isRunning={chatManager.currentIsRunning}
            mode={displayMode}
            modeColor={getModeColor()}
          />
        </box>
      </box>

      {/* Input Bar */}
      <DynamicInput
        width={innerWidth}
        onSubmit={handleExecuteCommand}
        disabled={!!chatManager.currentPendingQuestion}
        isRunning={chatManager.currentIsRunning}
        inputFocused={inputFocused}
        onFocusChange={setInputFocused}
        preFillValue={preFillValue}
        pendingQuestion={chatManager.currentPendingQuestion}
        onQuestionAnswer={chatManager.handleQuestionAnswer}
        onQuestionCancel={() => chatManager.interrupt()}
        mode={displayMode}
      />

      {/* Status Bar */}
      <StatusBar
        width={innerWidth}
        height={statusHeight}
        isRunning={chatManager.currentIsRunning}
        inputFocused={inputFocused}
        workspaceRoot={chatManager.activeWorktreePath || workspaceRoot}
        branchName={currentBranchName}
        mode={displayMode}
        focusZone={chatManager.focusZone}
      />
    </box>
  );
}

// Main App with QueryClient provider
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
