/**
 * Root App component for Clive TUI
 * Integrates state management, components, and keyboard handling
 * View flow: Setup -> Selection -> Main <-> Help
 */

import { useEffect, useState, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTerminalDimensions, useKeyboard } from '@opentui/react';
import { OneDarkPro } from './styles/theme';
import { useAppState } from './hooks/useAppState';
import { useViewMode } from './hooks/useViewMode';
import { Sidebar } from './components/Sidebar';
import { OutputPanel, type OutputPanelRef } from './components/OutputPanel';
import { DynamicInput } from './components/DynamicInput';
import { StatusBar } from './components/StatusBar';
import { SetupView } from './components/SetupView';
import { SelectionView } from './components/SelectionView';
import { HelpView } from './components/HelpView';
import { LinearConfigFlow } from './components/LinearConfigFlow';
import { GitHubConfigFlow } from './components/GitHubConfigFlow';
import { type Conversation } from './services/ConversationService';
import { useConversations } from './hooks/useConversations';

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
    goToSetup,
    goToSelection,
    goToMain,
    goToHelp,
    goBack,
    updateConfig,
  } = useViewMode();

  // Selection state (for SelectionView)
  const [selectedEpicIndex, setSelectedEpicIndex] = useState(0);
  const [epicSearchQuery, setEpicSearchQuery] = useState('');
  const [selectedIssue, setSelectedIssue] = useState<typeof sessions[0] | null>(null);

  // Setup view state
  const [setupSelectedIndex, setSetupSelectedIndex] = useState(0);
  const setupOptions = ['linear', 'beads'];
  const [configFlow, setConfigFlow] = useState<'linear' | 'beads' | null>(null);

  // Input focus state
  const [inputFocused, setInputFocused] = useState(false);
  const [preFillValue, setPreFillValue] = useState<string | undefined>(undefined);

  // Output panel ref for scroll control
  const outputPanelRef = useRef<OutputPanelRef>(null);

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

  // Log workspace context on startup
  useEffect(() => {
    console.log('[Clive TUI] Starting in workspace:', workspaceRoot);
    console.log('[Clive TUI] Claude will have context of this directory');
    if (process.env.CLIVE_WORKSPACE) {
      console.log('[Clive TUI] Workspace overridden via --workspace flag (dev mode)');
    }
  }, [workspaceRoot]);

  // Fetch conversations using React Query
  const {
    data: conversations = [],
    isLoading: conversationsLoading,
  } = useConversations(workspaceRoot, 20);

  const {
    outputLines,
    isRunning,
    pendingQuestion,
    mode,
    agentSessionActive,
    sessions,
    sessionsLoading,
    tasks,
    tasksLoading,
    activeSession,
    setActiveSession,
    executeCommand,
    handleQuestionAnswer,
    interrupt,
    cleanup,
  } = useAppState(workspaceRoot, config?.issueTracker);

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
    if (configFlow === 'linear' || configFlow === 'github') {
      return;
    }

    // Global shortcuts
    if (event.sequence === 'q' && viewMode !== 'main') {
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
    } else if (viewMode === 'selection') {
      // Two-level selection: Level 1 (issues) or Level 2 (conversations for issue)
      const isLevel1 = !selectedIssue;
      const isLevel2 = !!selectedIssue;

      // Escape - clear search, go back to level 1, or go back
      if (event.name === 'escape') {
        if (epicSearchQuery) {
          // Clear search
          setEpicSearchQuery('');
          setSelectedEpicIndex(0);
        } else if (isLevel2) {
          // Go back to level 1 (issues)
          setSelectedIssue(null);
          setSelectedEpicIndex(0);
        } else {
          // Go back to previous view
          goBack();
        }
        return;
      }

      // Backspace - remove last character from search
      if (event.name === 'backspace') {
        if (epicSearchQuery) {
          setEpicSearchQuery(epicSearchQuery.slice(0, -1));
          setSelectedEpicIndex(0);
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
        setEpicSearchQuery(epicSearchQuery + event.sequence);
        setSelectedEpicIndex(0);
        return;
      }

      // Arrow key navigation - depends on level
      if (isLevel1) {
        // Level 1: Navigate issues
        const filteredSessions = epicSearchQuery
          ? sessions.filter(s => {
              const query = epicSearchQuery.toLowerCase();
              const identifier = s.linearData?.identifier?.toLowerCase() || '';
              const title = s.name.toLowerCase();
              return identifier.includes(query) || title.includes(query);
            })
          : sessions;

        const displayIssues = filteredSessions.slice(0, 10);
        const maxIndex = displayIssues.length - 1;
        const minIndex = epicSearchQuery ? 0 : -1; // Allow -1 for "Create New"

        if (event.name === 'up' || event.sequence === 'k') {
          setSelectedEpicIndex((prev) => (prev > minIndex ? prev - 1 : maxIndex));
          return;
        }
        if (event.name === 'down' || event.sequence === 'j') {
          setSelectedEpicIndex((prev) => (prev < maxIndex ? prev + 1 : minIndex));
          return;
        }
      } else if (isLevel2) {
        // Level 2: Navigate conversations for selected issue
        const issueLinearId = selectedIssue.linearData?.id;
        const conversationsForIssue = conversations.filter(c =>
          c.linearProjectId === issueLinearId || c.linearTaskId === issueLinearId
        );

        const filteredConversations = epicSearchQuery
          ? conversationsForIssue.filter(c => {
              const query = epicSearchQuery.toLowerCase();
              const display = c.display.toLowerCase();
              const slug = c.slug?.toLowerCase() || '';
              return display.includes(query) || slug.includes(query);
            })
          : conversationsForIssue;

        const displayConversations = filteredConversations.slice(0, 10);
        const maxIndex = displayConversations.length - 1;
        const minIndex = epicSearchQuery ? 0 : -1; // Allow -1 for "Create New"

        if (event.name === 'up' || event.sequence === 'k') {
          setSelectedEpicIndex((prev) => (prev > minIndex ? prev - 1 : maxIndex));
          return;
        }
        if (event.name === 'down' || event.sequence === 'j') {
          setSelectedEpicIndex((prev) => (prev < maxIndex ? prev + 1 : minIndex));
          return;
        }
      }

      // Enter to select
      if (event.name === 'return' || event.name === 'enter') {
        if (isLevel1) {
          // Level 1: Selecting an issue
          if (selectedEpicIndex === -1) {
            // Create new session without issue
            handleCreateNewWithoutIssue();
            return;
          }

          const filteredSessions = epicSearchQuery
            ? sessions.filter(s => {
                const query = epicSearchQuery.toLowerCase();
                const identifier = s.linearData?.identifier?.toLowerCase() || '';
                const title = s.name.toLowerCase();
                return identifier.includes(query) || title.includes(query);
              })
            : sessions;

          const displayIssues = filteredSessions.slice(0, 10);
          const issue = displayIssues[selectedEpicIndex];
          if (issue) {
            // Go to Level 2 - show conversations for this issue
            setSelectedIssue(issue);
            setSelectedEpicIndex(-1); // Reset to "Create New" position for level 2
            setEpicSearchQuery(''); // Clear search
          }
        } else if (isLevel2) {
          // Level 2: Selecting a conversation for the issue
          if (selectedEpicIndex === -1) {
            // Create new session for this issue
            handleCreateNewForIssue(selectedIssue);
            return;
          }

          const issueLinearId = selectedIssue.linearData?.id;
          const conversationsForIssue = conversations.filter(c =>
            c.linearProjectId === issueLinearId || c.linearTaskId === issueLinearId
          );

          const filteredConversations = epicSearchQuery
            ? conversationsForIssue.filter(c => {
                const query = epicSearchQuery.toLowerCase();
                const display = c.display.toLowerCase();
                const slug = c.slug?.toLowerCase() || '';
                return display.includes(query) || slug.includes(query);
              })
            : conversationsForIssue;

          const displayConversations = filteredConversations.slice(0, 10);
          const conversation = displayConversations[selectedEpicIndex];
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

  // Handler for creating new session without issue
  const handleCreateNewWithoutIssue = () => {
    goToMain();
    setInputFocused(true);
    setPreFillValue('/plan');
  };

  // Handler for creating new session for specific issue
  const handleCreateNewForIssue = (issue: typeof sessions[0]) => {
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
  const handleConfigComplete = (config: { apiKey: string; teamID: string }) => {
    updateConfig({
      issueTracker: configFlow as 'linear' | 'github',
      [configFlow as string]: config,
    });
    setConfigFlow(null);
    goToSelection();
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
      // Beads doesn't need configuration, just verify it's installed
      // and .beads directory exists
      handleConfigComplete({ issueTracker: 'beads' });
      return null; // Will transition to selection view immediately
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

  if (viewMode === 'selection') {
    return (
      <SelectionView
        width={width}
        height={height}
        sessions={sessions}
        conversations={conversations}
        sessionsLoading={sessionsLoading}
        conversationsLoading={conversationsLoading}
        selectedIndex={selectedEpicIndex}
        searchQuery={epicSearchQuery}
        selectedIssue={selectedIssue}
        onSelectIssue={(issue) => {
          setSelectedIssue(issue);
          setSelectedEpicIndex(-1); // Reset to "Create New" position
          setEpicSearchQuery(''); // Clear search
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
          if (selectedIssue) {
            // Go back to Level 1
            setSelectedIssue(null);
            setSelectedEpicIndex(0);
            setEpicSearchQuery('');
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
