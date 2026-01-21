/**
 * Root App component for Clive TUI
 * Integrates state management, components, and keyboard handling
 */

import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OneDarkPro } from './styles/theme';
import { useAppState } from './hooks/useAppState';
import { Header } from './components/Header';
import { OutputPanel } from './components/OutputPanel';
import { InputBar } from './components/InputBar';

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

  // State management
  const workspaceRoot = process.cwd();
  const {
    outputLines,
    isRunning,
    pendingQuestion,
    executeCommand,
    interrupt,
  } = useAppState(workspaceRoot);

  // Keyboard handling
  useEffect(() => {
    const handleKeyPress = (key: string) => {
      if (key === 'q' || key === '\u001b') { // q or Escape
        process.exit(0);
      }

      if (key === '\u0003') { // Ctrl+C
        interrupt();
      }

      if (key === '?') {
        executeCommand('/help');
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
  }, [interrupt, executeCommand]);

  // Layout dimensions
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
