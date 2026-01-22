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
      // Helper function to filter sessions by search query (checks both identifier and title)
      const filterSessions = (query: string) => {
        if (!query) return sessions;
        const lowerQuery = query.toLowerCase();
        return sessions.filter(s => {
          const identifier = s.linearData?.identifier?.toLowerCase() || '';
          const title = s.name.toLowerCase();
          return identifier.includes(lowerQuery) || title.includes(lowerQuery);
        });
      };

      // Escape - clear search or go back
      if (event.name === 'escape') {
        if (epicSearchQuery) {
          setEpicSearchQuery('');
          setSelectedEpicIndex(0);
        } else {
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
      // Exclude special keys and shortcuts
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

      // Arrow key navigation for epic selection
      if (event.name === 'up' || event.sequence === 'k') {
        const filteredSessions = filterSessions(epicSearchQuery);
        const maxIndex = Math.min(filteredSessions.length, 10) - 1;
        // Allow -1 for "Create New" option when not searching
        const minIndex = epicSearchQuery ? 0 : -1;
        setSelectedEpicIndex((prev) => (prev > minIndex ? prev - 1 : maxIndex));
        return;
      }
      if (event.name === 'down' || event.sequence === 'j') {
        const filteredSessions = filterSessions(epicSearchQuery);
        const maxIndex = Math.min(filteredSessions.length, 10) - 1;
        // Allow -1 for "Create New" option when not searching
        const minIndex = epicSearchQuery ? 0 : -1;
        setSelectedEpicIndex((prev) => (prev < maxIndex ? prev + 1 : minIndex));
        return;
      }

      // Enter to select
      if (event.name === 'return' || event.name === 'enter') {
        // Check if "Create New" is selected
        if (selectedEpicIndex === -1) {
          // Go to main view with /plan pre-filled
          goToMain();
          setInputFocused(true);
          setPreFillValue('/plan');
          return;
        }

        const filteredSessions = filterSessions(epicSearchQuery);
        const displaySessions = filteredSessions.slice(0, 10);

        if (displaySessions.length > 0 && displaySessions[selectedEpicIndex]) {
          handleEpicSelect(displaySessions[selectedEpicIndex]);
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

  // Handler for epic selection
  const handleEpicSelect = (session: typeof sessions[0]) => {
    setActiveSession(session);
    goToMain();
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
        sessionsLoading={sessionsLoading}
        selectedIndex={selectedEpicIndex}
        searchQuery={epicSearchQuery}
        onSelect={handleEpicSelect}
        onCreateNew={() => {
          goToMain();
          setInputFocused(true);
          setPreFillValue('/plan');
        }}
        onBack={goBack}
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
        onSubmit={executeCommand}
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
