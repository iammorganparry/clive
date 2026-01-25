/**
 * Root App component for Clive TUI
 * Integrates state management, components, and keyboard handling
 * View flow: Setup -> Mode Selection -> (Worker | Selection -> Main) <-> Help
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTerminalDimensions, useKeyboard } from '@opentui/react';
import { OneDarkPro } from './styles/theme';
import { useAppState } from './hooks/useAppState';
import { useViewMode } from './hooks/useViewMode';
import { useWorkerConnection, type InterviewRequest } from './hooks/useWorkerConnection';
import { Sidebar } from './components/Sidebar';
import { OutputPanel, type OutputPanelRef } from './components/OutputPanel';
import { DynamicInput } from './components/DynamicInput';
import { StatusBar } from './components/StatusBar';
import { SetupView } from './components/SetupView';
import { SelectionView } from './components/SelectionView';
import { HelpView } from './components/HelpView';
import { LinearConfigFlow } from './components/LinearConfigFlow';
import { GitHubConfigFlow } from './components/GitHubConfigFlow';
import { ModeSelectionView } from './components/ModeSelectionView';
import { WorkerConfigFlow } from './components/WorkerConfigFlow';
import { WorkerView } from './components/WorkerView';
import { type Conversation } from './services/ConversationService';
import { useConversations, useAllConversations } from './hooks/useConversations';
import { useSelectionState } from './hooks/useSelectionState';
import { WorkerSessionManager, type ChatMessage } from './services/WorkerSessionManager';
import type { Session, OutputLine } from './types';
import type { WorkerConfig } from './types/views';

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
    case 'user':
      return { type: 'user', text: msg.content };
    case 'assistant':
      return { type: 'assistant', text: msg.content };
    case 'question':
      return {
        type: 'question',
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
    case 'error':
      return { type: 'stderr', text: msg.content };
    case 'system':
    default:
      return { type: 'system', text: msg.content };
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
    goBack,
    updateConfig,
  } = useViewMode();

  // Mode selection state
  const [modeSelectedIndex, setModeSelectedIndex] = useState(0);
  const modeOptions = ['interactive', 'worker'];

  // Setup view state
  const [setupSelectedIndex, setSetupSelectedIndex] = useState(0);
  const setupOptions = ['linear', 'beads'];
  const [configFlow, setConfigFlow] = useState<'linear' | 'beads' | null>(null);

  // Input focus state
  const [inputFocused, setInputFocused] = useState(false);
  const [preFillValue, setPreFillValue] = useState<string | undefined>(undefined);

  // Output panel ref for scroll control
  const outputPanelRef = useRef<OutputPanelRef>(null);

  // User scroll intent tracking
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);
  const lastScrollHeight = useRef(0);

  // Worker mode state
  const [workerOutputLines, setWorkerOutputLines] = useState<OutputLine[]>([]);
  const [workerIsRunning, setWorkerIsRunning] = useState(false);
  const sessionManagerRef = useRef<WorkerSessionManager | null>(null);

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

  // Worker callbacks for handling messages from central service
  const handleWorkerInterviewRequest = useCallback((request: InterviewRequest) => {
    setWorkerIsRunning(true);
    setWorkerOutputLines([]); // Clear previous output
    sessionManagerRef.current?.startInterview(request, (event) => {
      workerConnectionRef.current?.sendEvent(event);
    });
  }, []);

  const handleWorkerAnswer = useCallback((sessionId: string, toolUseId: string, answers: Record<string, string>) => {
    sessionManagerRef.current?.sendAnswer(sessionId, toolUseId, answers);
  }, []);

  const handleWorkerMessage = useCallback((sessionId: string, message: string) => {
    sessionManagerRef.current?.sendMessage(sessionId, message);
  }, []);

  const handleWorkerCancel = useCallback((sessionId: string) => {
    sessionManagerRef.current?.cancelSession(sessionId);
    setWorkerIsRunning(false);
  }, []);

  // Worker connection (only active when in worker mode or when config.worker.enabled)
  const workerConnection = useWorkerConnection(
    viewMode === 'worker' ? config?.worker : undefined,
    workspaceRoot,
    {
      onInterviewRequest: handleWorkerInterviewRequest,
      onAnswer: handleWorkerAnswer,
      onMessage: handleWorkerMessage,
      onCancel: handleWorkerCancel,
    }
  );

  // Ref to access workerConnection in callbacks (avoid circular dependency)
  const workerConnectionRef = useRef(workerConnection);
  useEffect(() => {
    workerConnectionRef.current = workerConnection;
  }, [workerConnection]);

  // Initialize WorkerSessionManager when in worker mode
  useEffect(() => {
    if (viewMode === 'worker') {
      const sessionManager = new WorkerSessionManager(workspaceRoot);
      sessionManagerRef.current = sessionManager;

      // Listen for messages from session manager
      const handleMessage = (_sessionId: string, msg: ChatMessage) => {
        const outputLine = convertChatMessageToOutputLine(msg);
        setWorkerOutputLines((prev) => [...prev, outputLine]);
      };

      const handleComplete = (sessionId: string) => {
        setWorkerIsRunning(false);
        workerConnectionRef.current?.completeSession(sessionId);
      };

      const handleError = (_sessionId: string, error: string) => {
        setWorkerOutputLines((prev) => [...prev, { type: 'stderr', text: error }]);
      };

      sessionManager.on('message', handleMessage);
      sessionManager.on('complete', handleComplete);
      sessionManager.on('error', handleError);

      return () => {
        sessionManager.off('message', handleMessage);
        sessionManager.off('complete', handleComplete);
        sessionManager.off('error', handleError);
        sessionManager.closeAll();
        sessionManagerRef.current = null;
      };
    }
    return undefined;
  }, [viewMode, workspaceRoot]);

  // Log workspace context on startup
  useEffect(() => {
    console.log('[Clive TUI] Starting in workspace:', workspaceRoot);
    console.log('[Clive TUI] Claude will have context of this directory');
    if (process.env.CLIVE_WORKSPACE) {
      console.log('[Clive TUI] Workspace overridden via --workspace flag (dev mode)');
    }
  }, [workspaceRoot]);

  // Fetch ALL conversations across all projects (not just current workspace)
  // This ensures "Other Conversations" shows all Claude Code conversations
  const {
    data: conversations = [],
    isLoading: conversationsLoading,
  } = useAllConversations(100);

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
    handleQuestionAnswer,
    interrupt,
    cleanup,
  } = useAppState(workspaceRoot, config?.issueTracker);

  // Detect when user manually scrolls up
  useEffect(() => {
    const panel = outputPanelRef.current;
    if (!panel) return;

    // Check if at bottom whenever output changes
    const checkScrollPosition = () => {
      // Get scroll metrics (OpenTUI may not have all properties)
      const scrollMetrics = panel.getScrollMetrics?.() || {
        scrollTop: panel.scrollTop || 0,
        scrollHeight: panel.scrollHeight || 0,
        clientHeight: panel.clientHeight || 0,
      };

      const { scrollTop, scrollHeight, clientHeight } = scrollMetrics;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10;

      // User scrolled up if not at bottom and content hasn't changed
      if (!isAtBottom && scrollHeight === lastScrollHeight.current) {
        setUserHasScrolledUp(true);
      }
      // User scrolled back to bottom
      else if (isAtBottom) {
        setUserHasScrolledUp(false);
      }

      lastScrollHeight.current = scrollHeight;
    };

    checkScrollPosition();
  }, [outputLines.length]);

  // Auto-scroll to bottom when new output lines arrive (only if user hasn't scrolled up)
  useEffect(() => {
    if (outputPanelRef.current && outputLines.length > 0 && !userHasScrolledUp) {
      // Small delay to ensure DOM has updated before scrolling
      const timer = setTimeout(() => {
        outputPanelRef.current?.scrollToBottom();
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [outputLines.length, userHasScrolledUp]);

  // Selection state using XState machine
  const selectionState = useSelectionState(sessions, conversations);

  // Auto-resume if exactly 1 conversation
  useEffect(() => {
    // Only auto-resume when in selection view and conversations are loaded
    if (viewMode !== 'selection' || conversationsLoading || sessionsLoading) {
      return;
    }

    // If exactly 1 conversation and no sessions, auto-resume it
    if (conversations.length === 1 && sessions.length === 0) {
      const conversation = conversations[0];
      if (conversation) {
        handleConversationResume(conversation);
      }
      return;
    }

    // Otherwise, always show the selection view (including when 0 conversations)
  }, [viewMode, conversations.length, sessions.length, conversationsLoading, sessionsLoading]);

  // Cleanup on process exit (only 'exit' event, SIGINT/SIGTERM handled by main.tsx)
  useEffect(() => {
    const handleExit = () => {
      cleanup();
    };

    process.on('exit', handleExit);

    return () => {
      process.off('exit', handleExit);
    };
  }, [cleanup]);


  // Keyboard handling using OpenTUI's useKeyboard hook
  // This properly integrates with OpenTUI's stdin management
  useKeyboard((event) => {
    // Skip ALL keyboard handling when input is focused - let input handle everything
    if (inputFocused) {
      // ONLY handle unfocus events
      if (event.name === 'escape') {
        setInputFocused(false);
      }
      return; // Exit early, don't process any other keys
    }

    // Skip keyboard handling in config flows
    if (configFlow === 'linear' || configFlow === 'beads' || viewMode === 'worker_setup') {
      return;
    }

    // Global shortcuts
    if (event.sequence === 'q' && viewMode !== 'main' && viewMode !== 'worker') {
      process.exit(0);
    }

    if (event.sequence === '?') {
      if (viewMode === 'help') {
        goBack();
      } else {
        goToHelp();
      }
      return;
    }

    // Scroll to bottom (Ctrl+B, Cmd+B, or End key)
    if (((event.ctrl || event.meta) && event.sequence === 'b') || event.name === 'end') {
      if (outputPanelRef.current) {
        outputPanelRef.current.scrollToBottom();
      }
      return;
    }

    // View-specific shortcuts
    if (viewMode === 'setup' && !configFlow) {
      if (event.name === 'escape') {
        process.exit(0);
      }
      // Arrow key navigation for setup options
      if (event.name === 'up' || event.sequence === 'k') {
        setSetupSelectedIndex((prev) => (prev > 0 ? prev - 1 : setupOptions.length - 1));
      }
      if (event.name === 'down' || event.sequence === 'j') {
        setSetupSelectedIndex((prev) => (prev < setupOptions.length - 1 ? prev + 1 : 0));
      }
      // Number key selection (1, 2, etc.)
      if (event.sequence && /^[1-9]$/.test(event.sequence)) {
        const index = parseInt(event.sequence) - 1;
        if (index < setupOptions.length) {
          const selectedOption = setupOptions[index];
          if (selectedOption === 'linear') {
            setConfigFlow('linear');
          } else if (selectedOption === 'beads') {
            setConfigFlow('beads');
          }
        }
      }
      if (event.name === 'return') {
        const selectedOption = setupOptions[setupSelectedIndex];
        if (selectedOption === 'linear') {
          setConfigFlow('linear');
        } else if (selectedOption === 'beads') {
          setConfigFlow('beads');
        }
      }
    } else if (viewMode === 'mode_selection') {
      if (event.name === 'escape') {
        goBack();
        return;
      }
      // Arrow key navigation
      if (event.name === 'up' || event.sequence === 'k') {
        setModeSelectedIndex((prev) => (prev > 0 ? prev - 1 : modeOptions.length - 1));
      }
      if (event.name === 'down' || event.sequence === 'j') {
        setModeSelectedIndex((prev) => (prev < modeOptions.length - 1 ? prev + 1 : 0));
      }
      // Number key selection
      if (event.sequence && /^[1-2]$/.test(event.sequence)) {
        const index = parseInt(event.sequence) - 1;
        handleModeSelect(modeOptions[index]);
      }
      if (event.name === 'return') {
        handleModeSelect(modeOptions[modeSelectedIndex]);
      }
    } else if (viewMode === 'worker') {
      if (event.name === 'escape' || event.sequence === 'q') {
        goToModeSelection();
        return;
      }
      if (event.sequence === 'r' && workerConnection.status === 'disconnected') {
        workerConnection.connect();
        return;
      }
      if (event.ctrl && event.name === 'c') {
        cleanup();
        workerConnection.disconnect();
        process.exit(0);
      }
    } else if (viewMode === 'selection') {
      // Escape - clear search, go back to level 1, or go back
      if (event.name === 'escape') {
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
      if (event.name === 'backspace') {
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
        event.name !== 'up' &&
        event.name !== 'down' &&
        event.name !== 'return' &&
        event.name !== 'enter' &&
        event.name !== 'escape' &&
        event.name !== 'backspace'
      ) {
        selectionState.search(selectionState.searchQuery + event.sequence);
        return;
      }

      // Arrow key navigation
      if (event.name === 'up' || event.sequence === 'k') {
        selectionState.navigateUp();
        return;
      }
      if (event.name === 'down' || event.sequence === 'j') {
        selectionState.navigateDown();
        return;
      }

      // Enter to select
      if (event.name === 'return' || event.name === 'enter') {
        if (selectionState.isLevel1) {
          // Level 1: Selecting an issue
          if (selectionState.selectedIndex === -1) {
            // Create new session without issue
            handleCreateNewWithoutIssue();
            return;
          }

          // Include "Other Conversations" group in the list (at the TOP to match SelectionView)
          const issuesWithOther: Session[] = [];
          const unattachedCount = conversations.filter(c => !c.linearProjectId && !c.linearTaskId).length;
          if (unattachedCount > 0) {
            // Add "Other Conversations" at the TOP
            issuesWithOther.push({
              id: '__unattached__',
              name: `Other Conversations (${unattachedCount})`,
              createdAt: new Date(),
              source: 'linear' as const,
            });
          }
          // Add all Linear sessions after
          issuesWithOther.push(...sessions);

          const filteredSessions = selectionState.searchQuery
            ? issuesWithOther.filter(s => {
                const query = selectionState.searchQuery.toLowerCase();
                const identifier = s.linearData?.identifier?.toLowerCase() || '';
                const title = s.name.toLowerCase();
                return identifier.includes(query) || title.includes(query);
              })
            : issuesWithOther;

          const displayIssues = filteredSessions.slice(0, 10);
          const issue = displayIssues[selectionState.selectedIndex];
          if (issue) {
            // Go to Level 2 - show conversations for this issue
            selectionState.selectIssue(issue);
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
          const isUnattachedGroup = selectedIssue.id === '__unattached__';

          const conversationsForIssue = isUnattachedGroup
            ? conversations.filter(c => !c.linearProjectId && !c.linearTaskId)
            : conversations.filter(c => {
                const issueLinearId = selectedIssue.linearData?.id;
                return c.linearProjectId === issueLinearId || c.linearTaskId === issueLinearId;
              });

          const filteredConversations = selectionState.searchQuery
            ? conversationsForIssue.filter(c => {
                const query = selectionState.searchQuery.toLowerCase();
                const display = c.display.toLowerCase();
                const slug = c.slug?.toLowerCase() || '';
                return display.includes(query) || slug.includes(query);
              })
            : conversationsForIssue;

          const displayConversations = filteredConversations.slice(0, 10);
          const conversation = displayConversations[selectionState.selectedIndex];
          if (conversation) {
            handleConversationResume(conversation);
          }
        }
        return;
      }
    } else if (viewMode === 'main') {
      if (event.name === 'escape') {
        goToSelection();
      }
      if (event.ctrl && event.name === 'c') {
        // Two-stage Ctrl+C handling:
        // 1. First Ctrl+C: Kill active TTY session
        // 2. Second Ctrl+C (when idle): Exit Clive
        if (isRunning) {
          // TTY is active - interrupt it
          interrupt();
        } else {
          // No active session - exit Clive immediately
          cleanup();
          process.exit(0);
        }
      }
      // Input focus shortcuts
      if (event.sequence === '/') {
        setInputFocused(true);
        setPreFillValue('/');
      }
      if (event.sequence === 'i' || event.sequence === ':') {
        setInputFocused(true);
        setPreFillValue(event.sequence === ':' ? ':' : undefined);
      }
    } else if (viewMode === 'help') {
      if (event.name === 'escape') {
        goBack();
      }
    }
  });

  // Handler for mode selection
  const handleModeSelect = (mode: string) => {
    if (mode === 'interactive') {
      goToSelection();
    } else if (mode === 'worker') {
      // Check if worker is already configured
      if (config?.worker?.enabled && config?.worker?.token) {
        goToWorker();
      } else {
        goToWorkerSetup();
      }
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
    goToMain();
    setInputFocused(true);
    setPreFillValue('/plan');
  };

  // Handler for creating new session for specific issue
  const handleCreateNewForIssue = (issue: Session) => {
    setActiveSession(issue);
    goToMain();
    setInputFocused(true);
    setPreFillValue('/plan');
  };

  // Handler for conversation resume
  const handleConversationResume = (conversation: Conversation) => {
    console.log('[Clive TUI] Resuming conversation:', conversation.sessionId);
    executeCommand(`/plan --resume=${conversation.sessionId}`);
    goToMain();
  };

  // Wrapper for executeCommand to handle special commands
  const handleExecuteCommand = (cmd: string) => {
    // Check for /resume command
    if (cmd.trim() === '/resume') {
      goToSelection();
      return;
    }

    // Otherwise, execute normally
    executeCommand(cmd);
  };


  // Handler for config flow completion
  const handleConfigComplete = (configData: { apiKey: string; teamID: string }) => {
    updateConfig({
      issueTracker: configFlow as 'linear' | 'beads',
      [configFlow as string]: configData,
    });
    setConfigFlow(null);
    goToModeSelection();
  };

  // Render appropriate view based on viewMode
  if (viewMode === 'setup') {
    // Show config flow if a tracker was selected
    if (configFlow === 'linear') {
      return (
        <LinearConfigFlow
          width={width}
          height={height}
          onComplete={handleConfigComplete}
          onCancel={() => setConfigFlow(null)}
        />
      );
    }

    if (configFlow === 'beads') {
      // Beads doesn't need configuration, just update config and go to mode selection
      updateConfig({
        issueTracker: 'beads',
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
  if (viewMode === 'mode_selection') {
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
        workerConfigured={!!(config?.worker?.enabled && config?.worker?.token)}
      />
    );
  }

  // Worker setup view
  if (viewMode === 'worker_setup') {
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

  // Worker view
  if (viewMode === 'worker') {
    return (
      <WorkerView
        width={width}
        height={height}
        workerStatus={workerConnection.status}
        workerId={workerConnection.workerId}
        activeSessions={workerConnection.activeSessions}
        error={workerConnection.error}
        outputLines={workerOutputLines}
        isRunning={workerIsRunning}
        workspaceRoot={workspaceRoot}
        onExit={goToModeSelection}
        onReconnect={workerConnection.connect}
      />
    );
  }

  if (viewMode === 'selection') {
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

  if (viewMode === 'help') {
    return (
      <HelpView
        width={width}
        height={height}
        onClose={goBack}
      />
    );
  }

  // Main view (chat interface)
  const baseInputHeight = 3;
  const statusHeight = 1;
  const isInMode = mode !== 'none';

  // Calculate dynamic input height based on pending question
  const questionHeight = pendingQuestion ? Math.min(25, 20) : 0;
  const dynamicInputHeight = baseInputHeight + questionHeight;

  // When border is present, it takes 2 rows (top+bottom) and 2 cols (left+right)
  const borderAdjustment = isInMode ? 2 : 0;
  const innerWidth = width - borderAdjustment;
  const innerHeight = height - borderAdjustment;
  const bodyHeight = innerHeight - dynamicInputHeight - statusHeight;

  // Sidebar layout
  const sidebarWidth = 30;
  const outputWidth = innerWidth - sidebarWidth;

  // Mode colors
  const getModeColor = () => {
    if (mode === 'plan') return '#3B82F6'; // blue-500
    if (mode === 'build') return '#F59E0B'; // amber-500
    return undefined;
  };

  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.primary}
      flexDirection="column"
      borderStyle={isInMode ? 'rounded' : undefined}
      borderColor={isInMode ? getModeColor() : undefined}
    >
      {/* Body (Sidebar + Output) */}
      <box width={innerWidth} height={bodyHeight} flexDirection="row">
        {/* Sidebar */}
        <Sidebar
          width={sidebarWidth}
          height={bodyHeight}
          tasks={tasks}
          activeSession={activeSession}
        />

        {/* Output Panel */}
        <OutputPanel
          ref={outputPanelRef}
          width={outputWidth}
          height={bodyHeight}
          lines={outputLines}
          isRunning={isRunning}
          mode={mode}
          modeColor={getModeColor()}
        />
      </box>

      {/* Input Bar */}
      <DynamicInput
        width={innerWidth}
        onSubmit={handleExecuteCommand}
        disabled={!!pendingQuestion}
        isRunning={isRunning}
        inputFocused={inputFocused}
        onFocusChange={setInputFocused}
        preFillValue={preFillValue}
        pendingQuestion={pendingQuestion}
        onQuestionAnswer={handleQuestionAnswer}
        onQuestionCancel={() => interrupt()}
      />

      {/* Status Bar */}
      <StatusBar
        width={innerWidth}
        height={statusHeight}
        isRunning={isRunning}
        inputFocused={inputFocused}
        workspaceRoot={workspaceRoot}
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
