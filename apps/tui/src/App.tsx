/**
 * Root App component for Clive TUI
 * Integrates state management, components, and keyboard handling
 * View flow: Setup -> Selection -> Main <-> Help
 */

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTerminalDimensions, useKeyboard } from '@opentui/react';
import { OneDarkPro } from './styles/theme';
import { useAppState } from './hooks/useAppState';
import { useViewMode } from './hooks/useViewMode';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { OutputPanel } from './components/OutputPanel';
import { InputBar } from './components/InputBar';
import { StatusBar } from './components/StatusBar';
import { VersionFooter } from './components/VersionFooter';
import { SetupView } from './components/SetupView';
import { SelectionView } from './components/SelectionView';
import { HelpView } from './components/HelpView';
import { QuestionPanel } from './components/QuestionPanel';
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

  // State management
  const workspaceRoot = process.cwd();
  const {
    outputLines,
    isRunning,
    pendingQuestion,
    sessions,
    sessionsLoading,
    tasks,
    tasksLoading,
    activeSession,
    setActiveSession,
    executeCommand,
    handleQuestionAnswer,
    interrupt,
  } = useAppState(workspaceRoot);

  // Keyboard handling using OpenTUI's useKeyboard hook
  // This properly integrates with OpenTUI's stdin management
  useKeyboard((event) => {
    // Skip keyboard handling in input-focused views
    if (configFlow === 'linear' || configFlow === 'github') {
      return;
    }

    // Global shortcuts
    if (event.key === 'q' && viewMode !== 'main') {
      process.exit(0);
    }

    if (event.key === '?') {
      if (viewMode === 'help') {
        goBack();
      } else {
        goToHelp();
      }
      return;
    }

    // View-specific shortcuts
    if (viewMode === 'setup' && !configFlow) {
      if (event.name === 'escape') {
        process.exit(0);
      }
      // Arrow key navigation for setup options
      if (event.name === 'up' || event.key === 'k') {
        setSetupSelectedIndex((prev) => (prev > 0 ? prev - 1 : setupOptions.length - 1));
      }
      if (event.name === 'down' || event.key === 'j') {
        setSetupSelectedIndex((prev) => (prev < setupOptions.length - 1 ? prev + 1 : 0));
      }
      // Number key selection (1, 2, etc.)
      if (/^[1-9]$/.test(event.key)) {
        const index = parseInt(event.key) - 1;
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
      if (event.name === 'escape') {
        goBack();
      }
      // Arrow key navigation for epic selection
      if (event.name === 'up' || event.key === 'k') {
        setSelectedEpicIndex((prev) => (prev > 0 ? prev - 1 : Math.max(0, sessions.length - 1)));
      }
      if (event.name === 'down' || event.key === 'j') {
        setSelectedEpicIndex((prev) => (prev < Math.max(0, sessions.length - 1) ? prev + 1 : 0));
      }
      // Number key selection (1-9)
      if (/^[1-9]$/.test(event.key)) {
        const index = parseInt(event.key) - 1;
        if (index < sessions.length) {
          handleEpicSelect(sessions[index]);
        }
      }
      if (event.name === 'return') {
        if (sessions[selectedEpicIndex]) {
          handleEpicSelect(sessions[selectedEpicIndex]);
        }
      }
    } else if (viewMode === 'main') {
      if (event.name === 'escape') {
        goToSelection();
      }
      if (event.ctrl && event.key === 'c') {
        interrupt();
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
  const handleConfigComplete = (config: any) => {
    updateConfig({
      issueTracker: configFlow as 'linear' | 'github',
      ...config,
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
  const headerHeight = 2;
  const inputHeight = 3;
  const statusHeight = 1;
  const versionHeight = 1;
  const bodyHeight = height - headerHeight - inputHeight - statusHeight - versionHeight;

  // Sidebar layout
  const sidebarWidth = 30;
  const outputWidth = width - sidebarWidth;

  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.primary}
      flexDirection="column"
    >
      {/* Header */}
      <Header
        width={width}
        height={headerHeight}
        isRunning={isRunning}
        activeSession={activeSession}
      />

      {/* Body (Sidebar + Output) */}
      <box width={width} height={bodyHeight} flexDirection="row">
        {/* Sidebar */}
        <Sidebar
          width={sidebarWidth}
          height={bodyHeight}
          tasks={tasks}
        />

        {/* Output Panel */}
        <OutputPanel
          x={sidebarWidth}
          y={0}
          width={outputWidth}
          height={bodyHeight}
          lines={outputLines}
        />
      </box>

      {/* Input Bar */}
      <InputBar
        width={width}
        height={inputHeight}
        y={height - inputHeight - statusHeight - versionHeight}
        onSubmit={executeCommand}
        disabled={!!pendingQuestion}
      />

      {/* Status Bar */}
      <StatusBar
        width={width}
        height={statusHeight}
        isRunning={isRunning}
      />

      {/* Version Footer */}
      <VersionFooter
        width={width}
        height={versionHeight}
      />

      {/* Question Panel Overlay */}
      {pendingQuestion && (
        <QuestionPanel
          width={width}
          height={height}
          question={pendingQuestion}
          onAnswer={handleQuestionAnswer}
          onCancel={() => interrupt()}
        />
      )}
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
