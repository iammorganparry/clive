/**
 * Root App component for Clive TUI
 * Integrates state management, components, and keyboard handling
 * View flow: Setup -> Selection -> Main <-> Help
 */

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OneDarkPro } from './styles/theme';
import { useAppState } from './hooks/useAppState';
import { useViewMode } from './hooks/useViewMode';
import { Header } from './components/Header';
import { OutputPanel } from './components/OutputPanel';
import { InputBar } from './components/InputBar';
import { SetupView } from './components/SetupView';
import { SelectionView } from './components/SelectionView';
import { HelpView } from './components/HelpView';

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
  // Terminal dimensions (will be dynamic in real OpenTUI)
  const width = 120;
  const height = 40;

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

  // State management
  const workspaceRoot = process.cwd();
  const {
    outputLines,
    isRunning,
    pendingQuestion,
    sessions,
    sessionsLoading,
    activeSession,
    setActiveSession,
    executeCommand,
    interrupt,
  } = useAppState(workspaceRoot);

  // Keyboard handling
  useEffect(() => {
    const handleKeyPress = (key: string) => {
      // Global shortcuts
      if (key === 'q') {
        process.exit(0);
      }

      if (key === '?') {
        if (viewMode === 'help') {
          goBack();
        } else {
          goToHelp();
        }
        return;
      }

      // View-specific shortcuts
      if (viewMode === 'setup') {
        if (key === 's') {
          // Skip setup, go to chat-only mode
          goToMain();
        }
        if (key === '\u001b') { // Escape
          process.exit(0);
        }
      } else if (viewMode === 'selection') {
        if (key === 's') {
          // Skip to chat mode
          goToMain();
        }
        if (key === '\u001b') { // Escape
          goBack();
        }
        // TODO: Arrow key navigation for epic selection
      } else if (viewMode === 'main') {
        if (key === '\u001b') { // Escape
          goToSelection();
        }
        if (key === '\u0003') { // Ctrl+C
          interrupt();
        }
      } else if (viewMode === 'help') {
        if (key === '\u001b') { // Escape
          goBack();
        }
      }
    };

    // Setup keyboard listener
    if (typeof process !== 'undefined' && process.stdin) {
      process.stdin.setRawMode?.(true);
      process.stdin.on('data', (data) => {
        const key = data.toString();
        handleKeyPress(key);
      });
    }

    // Cleanup
    return () => {
      if (typeof process !== 'undefined' && process.stdin) {
        process.stdin.setRawMode?.(false);
      }
    };
  }, [viewMode, goBack, goToHelp, goToMain, goToSelection, interrupt]);

  // Handler for epic selection
  const handleEpicSelect = (session: typeof sessions[0]) => {
    setActiveSession(session);
    goToMain();
  };

  // Render appropriate view based on viewMode
  if (viewMode === 'setup') {
    return (
      <SetupView
        width={width}
        height={height}
        onComplete={updateConfig}
        onCancel={() => process.exit(0)}
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
  const headerHeight = 3;
  const inputHeight = 3;
  const outputHeight = height - headerHeight - inputHeight;

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
      />

      {/* Output Panel */}
      <OutputPanel
        x={0}
        y={headerHeight}
        width={width}
        height={outputHeight}
        lines={outputLines}
      />

      {/* Input Bar */}
      <InputBar
        width={width}
        height={inputHeight}
        y={height - inputHeight}
        onSubmit={executeCommand}
        disabled={!!pendingQuestion}
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
