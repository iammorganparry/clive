/**
 * Root App component for Clive TUI
 * Integrates state management, components, and keyboard handling
 * View flow: Setup -> Mode Selection -> (Worker | Selection) <-> Help
 * Sessions run as interactive Claude CLI in tmux windows.
 */

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HelpView } from "./components/HelpView";
import { LinearConfigFlow } from "./components/LinearConfigFlow";
import { LinearSettingsView } from "./components/LinearSettingsView";
import { Logo } from "./components/Logo";
import { ModeSelectionView } from "./components/ModeSelectionView";
import { SelectionView } from "./components/SelectionView";
import { SetupView } from "./components/SetupView";
import { StatusBar } from "./components/StatusBar";
import { WorkerConfigFlow } from "./components/WorkerConfigFlow";
import { useAllConversations } from "./hooks/useConversations";
import { useSessions } from "./hooks/useTaskQueries";
import { useSelectionState } from "./hooks/useSelectionState";
import { useViewMode } from "./hooks/useViewMode";
import {
  type InterviewRequest,
  useWorkerConnection,
} from "./hooks/useWorkerConnection";
import type { Conversation } from "./services/ConversationService";
import { TmuxSessionManager } from "./services/TmuxSessionManager";
import { WorktreeManager } from "./services/WorktreeManager";
import { OneDarkPro } from "./styles/theme";
import type { Session } from "./types";
import type { WorkerConfig } from "./types/views";
import { buildClaudeCommand, type SessionMode } from "./utils/build-claude-command";

// Create QueryClient instance
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function AppContent() {
  // Terminal dimensions (responsive to terminal size)
  const { width, height } = useTerminalDimensions();

  // View mode management
  const {
    viewMode,
    config,
    goToModeSelection,
    goToWorkerSetup,
    goToWorker,
    goToSelection,
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

  // Tmux session manager (shared between worker and interactive modes)
  const tmuxRef = useRef<TmuxSessionManager | null>(null);
  const worktreeManagerRef = useRef<WorktreeManager | null>(null);

  // Worker mode: track active sessions by ID → { mode, worktreePath }
  const [workerSessions, setWorkerSessions] = useState<
    Map<string, { mode: SessionMode; worktreePath: string }>
  >(new Map());

  // Worker mode: log lines for the orchestrator status view
  const [workerLogLines, setWorkerLogLines] = useState<string[]>([]);

  // State management
  // Get workspace root from user's current terminal directory
  // In development, this can be overridden via --workspace flag
  const workspaceRoot = process.env.CLIVE_WORKSPACE || process.cwd();

  // Helper: add a log line to the orchestrator status view
  const addWorkerLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setWorkerLogLines((prev) => [...prev.slice(-100), `[${ts}] ${msg}`]);
  }, []);

  // Worker callback: handle interview request by creating a tmux window
  const handleWorkerInterviewRequest = useCallback(
    (request: InterviewRequest) => {
      const sessionId = request.sessionId;
      const mode: SessionMode = (request.mode === "greeting" || !request.mode)
        ? "plan"
        : (request.mode as SessionMode);

      addWorkerLog(`New ${mode} session: ${sessionId.slice(0, 8)}...`);

      // Create worktree for isolation
      let worktreePath = workspaceRoot;
      try {
        if (worktreeManagerRef.current) {
          worktreePath = worktreeManagerRef.current.create(sessionId);
          addWorkerLog(`Worktree created at ${worktreePath}`);
        }
      } catch (error) {
        addWorkerLog(`Worktree failed, using main workspace: ${error}`);
      }

      // Build the claude command
      const prompt = mode === "build"
        ? "Execute the next pending task from Claude Tasks."
        : mode === "review"
        ? "Review the completed work against acceptance criteria."
        : request.initialPrompt
        ? `Plan the following: ${request.initialPrompt}`
        : "Help me plan a new feature. What would you like to build?";

      const claudeCmd = buildClaudeCommand({
        mode,
        prompt,
        workspaceRoot: worktreePath,
        model: request.model,
        permissionMode: "bypassPermissions",
      });

      // Create tmux window
      try {
        const shortId = sessionId.slice(0, 8);
        tmuxRef.current?.createWindow({
          id: sessionId,
          name: `${mode}-${shortId}`,
          cwd: worktreePath,
          command: claudeCmd,
        });
        addWorkerLog(`tmux window created for ${mode}-${shortId}`);
      } catch (error) {
        addWorkerLog(`Failed to create tmux window: ${error}`);
        workerConnectionRef.current?.sendEvent({
          sessionId,
          type: "error",
          payload: { type: "error", message: `Failed to create tmux window: ${String(error)}` },
          timestamp: new Date().toISOString(),
        });
        workerConnectionRef.current?.completeSession(sessionId);
        return;
      }

      // Track the session
      setWorkerSessions((prev) => {
        const next = new Map(prev);
        next.set(sessionId, { mode, worktreePath });
        return next;
      });

      // Send started event to Slack
      workerConnectionRef.current?.sendEvent({
        sessionId,
        type: "text",
        payload: { type: "text", content: `Started ${mode} session in tmux window` },
        timestamp: new Date().toISOString(),
      });
    },
    [workspaceRoot, addWorkerLog],
  );

  // Worker callback stubs — interactive Claude handles questions/messages directly
  const handleWorkerAnswer = useCallback(
    (_sessionId: string, _toolUseId: string, _answers: Record<string, string>) => {
      // No-op: Claude runs interactively in tmux, questions are handled in-terminal
    },
    [],
  );

  const handleWorkerMessage = useCallback(
    (_sessionId: string, _message: string) => {
      // No-op: Claude runs interactively in tmux
    },
    [],
  );

  const handleWorkerCancel = useCallback((sessionId: string) => {
    tmuxRef.current?.closeWindow(sessionId);
    setWorkerSessions((prev) => {
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
    // Clean up worktree
    try {
      worktreeManagerRef.current?.remove(sessionId);
    } catch { /* ignore */ }
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

  // Initialize TmuxSessionManager and WorktreeManager for worker and interactive modes
  useEffect(() => {
    const needsTmux = viewMode === "worker" || viewMode === "selection";
    if (!needsTmux) return undefined;

    // Only create once (refs persist across renders)
    if (!tmuxRef.current) {
      const tmux = new TmuxSessionManager("clive");
      tmuxRef.current = tmux;
      tmux.ensureSession();
      addWorkerLog("tmux session 'clive' ready");
    }

    if (!worktreeManagerRef.current) {
      const homedir = process.env.HOME || process.env.USERPROFILE || "~";
      const worktreeBaseDir = `${homedir}/.clive/worktrees`;
      worktreeManagerRef.current = new WorktreeManager(workspaceRoot, worktreeBaseDir);
    }

    return undefined;
  }, [viewMode, workspaceRoot, addWorkerLog]);

  // Worker mode: listen for tmux window exits to notify Slack and clean up
  useEffect(() => {
    if (viewMode !== "worker" || !tmuxRef.current) return undefined;

    const tmux = tmuxRef.current;

    const handleWindowExit = (sessionId: string) => {
      addWorkerLog(`Session ${sessionId.slice(0, 8)} completed`);

      // Clean up worktree (WorktreeManager derives path from sessionId)
      try {
        worktreeManagerRef.current?.remove(sessionId);
      } catch { /* ignore */ }

      setWorkerSessions((prev) => {
        const next = new Map(prev);
        next.delete(sessionId);
        return next;
      });

      // Notify Slack
      workerConnectionRef.current?.sendEvent({
        sessionId,
        type: "complete",
        payload: { type: "complete" },
        timestamp: new Date().toISOString(),
      });
      workerConnectionRef.current?.completeSession(sessionId);
    };

    tmux.on("windowExited", handleWindowExit);

    return () => {
      tmux.off("windowExited", handleWindowExit);
    };
  }, [viewMode, addWorkerLog]);

  // Redirect "main" view to selection — there's no in-process main view with tmux
  useEffect(() => {
    if (viewMode === "main") {
      goToSelection();
    }
  }, [viewMode, goToSelection]);

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

  // Fetch sessions (Linear issues) for the selection view
  const {
    data: sessions = [],
    isLoading: sessionsLoading,
    error: sessionsError,
  } = useSessions();

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

  // Selection state using XState machine
  const selectionState = useSelectionState(sessions, conversations);

  // Handler for conversation resume — creates a tmux window with --resume
  const handleConversationResume = useCallback(
    (conversation: Conversation) => {
      const sessionId = conversation.sessionId;
      const resumeMode = (conversation.mode as SessionMode) || "plan";

      let worktreePath = workspaceRoot;
      try {
        if (worktreeManagerRef.current) {
          worktreePath = worktreeManagerRef.current.create(sessionId);
        }
      } catch { /* use main workspace */ }

      const claudeCmd = buildClaudeCommand({
        mode: resumeMode,
        workspaceRoot: worktreePath,
        resume: sessionId,
        permissionMode: "bypassPermissions",
      });

      try {
        tmuxRef.current?.createWindow({
          id: sessionId,
          name: `resume-${sessionId.slice(0, 8)}`,
          cwd: worktreePath,
          command: claudeCmd,
        });
      } catch (error) {
        console.error("Failed to create tmux window for resume:", error);
      }
    },
    [workspaceRoot],
  );

  // Cleanup on process exit (only 'exit' event, SIGINT/SIGTERM handled by main.tsx)
  useEffect(() => {
    const handleExit = () => {
      tmuxRef.current?.stop();
      try { worktreeManagerRef.current?.prune(); } catch { /* ignore */ }
    };

    process.on("exit", handleExit);
    return () => {
      process.off("exit", handleExit);
    };
  }, []);

  // Keyboard handling using OpenTUI's useKeyboard hook
  useKeyboard((event) => {
    // Skip keyboard handling in config flows
    if (
      configFlow === "linear" ||
      configFlow === "beads" ||
      viewMode === "worker_setup"
    ) {
      return;
    }

    // Global shortcuts — q to quit (not in worker or selection where it's used)
    if (
      event.sequence === "q" &&
      viewMode !== "worker" &&
      viewMode !== "selection"
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

    // Global shortcut for Linear settings (comma key)
    if (event.sequence === "," && isLinearConfigured) {
      if (viewMode === "linear_settings") {
        goToModeSelection();
      } else if (viewMode !== "setup" && viewMode !== "help") {
        goToLinearSettings();
      }
      return;
    }

    // View-specific shortcuts
    if (viewMode === "setup" && !configFlow) {
      if (event.name === "escape") {
        process.exit(0);
      }
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
      return;
    } else if (viewMode === "worker") {
      // Worker mode: simple orchestrator shortcuts
      if (event.name === "escape" || event.sequence === "q") {
        goToModeSelection();
        return;
      }
      if (event.sequence === "r" && workerConnection.status === "disconnected") {
        workerConnection.connect();
        return;
      }
      if (event.ctrl && event.name === "c") {
        workerConnection.disconnect();
        process.exit(0);
      }
    } else if (viewMode === "selection") {
      // Escape - clear search, go back to level 1, or go back
      if (event.name === "escape") {
        if (selectionState.searchQuery) {
          selectionState.clearSearch();
        } else if (selectionState.isLevel2) {
          selectionState.goBack();
        } else {
          goBack();
        }
        return;
      }

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
          if (selectionState.selectedIndex === -1) {
            handleCreateNewWithoutIssue();
            return;
          }

          const issuesWithOther: Session[] = [];
          const unattachedCount = conversations.filter(
            (c) => !c.linearProjectId && !c.linearTaskId,
          ).length;
          if (unattachedCount > 0) {
            issuesWithOther.push({
              id: "__unattached__",
              name: `Other Conversations (${unattachedCount})`,
              createdAt: new Date(),
              source: "linear" as const,
            });
          }
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
              selectionState.selectIssue(issue);
            } else {
              handleCreateNewForIssue(issue);
            }
          }
        } else if (selectionState.isLevel2) {
          if (selectionState.selectedIndex === -1) {
            if (selectionState.selectedIssue) {
              handleCreateNewForIssue(selectionState.selectedIssue);
            }
            return;
          }

          if (!selectionState.selectedIssue) return;

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

  // Handler for creating new session without issue — spawns tmux window
  const handleCreateNewWithoutIssue = useCallback(() => {
    const chatId = `chat-${Date.now()}`;

    const claudeCmd = buildClaudeCommand({
      workspaceRoot,
      permissionMode: "bypassPermissions",
    });

    try {
      tmuxRef.current?.createWindow({
        id: chatId,
        name: `chat-${chatId.slice(5, 13)}`,
        cwd: workspaceRoot,
        command: claudeCmd,
      });
    } catch (error) {
      console.error("Failed to create tmux window:", error);
    }
  }, [workspaceRoot]);

  // Handler for creating new session for specific issue — spawns tmux window
  const handleCreateNewForIssue = useCallback(
    (issue: Session) => {
      const chatId = `issue-${issue.id.slice(0, 8)}-${Date.now()}`;

      const prompt = issue.linearData?.identifier
        ? `Work on ${issue.linearData.identifier}: ${issue.name}`
        : `Work on: ${issue.name}`;

      const claudeCmd = buildClaudeCommand({
        prompt,
        workspaceRoot,
        permissionMode: "bypassPermissions",
      });

      try {
        tmuxRef.current?.createWindow({
          id: chatId,
          name: issue.linearData?.identifier || issue.name.slice(0, 20),
          cwd: workspaceRoot,
          command: claudeCmd,
        });
      } catch (error) {
        console.error("Failed to create tmux window:", error);
      }
    },
    [workspaceRoot],
  );

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

  // ── Worker Mode — tmux orchestrator status view ──
  if (viewMode === "worker") {
    const statusHeight = 1;
    const headerHeight = 5;
    const sessionListHeight = Math.min(workerSessions.size + 2, 8);
    const logHeight = height - headerHeight - sessionListHeight - statusHeight;

    return (
      <box
        width={width}
        height={height}
        backgroundColor={OneDarkPro.background.primary}
        flexDirection="column"
      >
        {/* Header */}
        <box width={width} height={headerHeight} flexDirection="column" paddingLeft={2} paddingTop={1}>
          <Logo />
          <text fg={OneDarkPro.foreground.muted} marginTop={1}>
            Worker Mode — tmux orchestrator (Ctrl-b n/p to switch windows)
          </text>
          <box flexDirection="row" marginTop={1}>
            <text fg={workerConnection.status === "ready" ? OneDarkPro.syntax.green : OneDarkPro.syntax.yellow}>
              {workerConnection.status === "ready"
                ? "Connected — waiting for Slack requests"
                : workerConnection.status === "connecting"
                  ? "Connecting..."
                  : "Disconnected (press r to reconnect)"}
            </text>
            {workerConnection.error && (
              <text fg={OneDarkPro.syntax.red}> — {workerConnection.error}</text>
            )}
          </box>
        </box>

        {/* Active sessions */}
        <box width={width} height={sessionListHeight} flexDirection="column" paddingLeft={2}>
          <text fg={OneDarkPro.foreground.primary}>
            Active Sessions ({workerSessions.size})
          </text>
          {workerSessions.size === 0 ? (
            <text fg={OneDarkPro.foreground.muted}>  No active sessions</text>
          ) : (
            Array.from(workerSessions.entries()).map(([id, info]) => (
              <text key={id} fg={OneDarkPro.foreground.muted}>
                {"  "}{info.mode.toUpperCase().padEnd(8)} {id.slice(0, 8)}
              </text>
            ))
          )}
        </box>

        {/* Log output */}
        <box width={width} height={logHeight} flexDirection="column" paddingLeft={2} overflow="hidden">
          {workerLogLines.slice(-(logHeight - 1)).map((line, i) => (
            <text key={i} fg={OneDarkPro.foreground.muted}>{line}</text>
          ))}
        </box>

        {/* Status Bar */}
        <StatusBar
          width={width}
          height={statusHeight}
          isRunning={false}
          inputFocused={false}
          workspaceRoot={workspaceRoot}
          workerMode={true}
          workerStatus={workerConnection.status}
          workerId={workerConnection.workerId}
          activeSessions={workerConnection.activeSessions}
          activeSessionId={null}
          workerError={workerConnection.error}
        />
      </box>
    );
  }

  // Fallback — shouldn't reach here, but return null gracefully
  return null;
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
