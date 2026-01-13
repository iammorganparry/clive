import React, { useCallback, useState, useRef } from 'react';
import { Box, useStdout } from 'ink';
import { TabBar } from './components/TabBar.js';
import { TaskSidebar } from './components/TaskSidebar.js';
import { TerminalOutput } from './components/TerminalOutput.js';
import { CommandInput } from './components/CommandInput.js';
import { StatusBar } from './components/StatusBar.js';
import { HelpOverlay } from './components/HelpOverlay.js';
import { useSessions } from './hooks/useSessions.js';
import { useTasks } from './hooks/useTasks.js';
import { useOutput } from './hooks/useOutput.js';
import { useKeyboard } from './hooks/useKeyboard.js';
import { executeCommand } from './commands/index.js';
import { useTheme } from './theme.js';
import type { CommandContext } from './types.js';

export const App: React.FC = () => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const [showHelp, setShowHelp] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const inputRef = useRef<{ focus: () => void }>(null);

  // Get terminal dimensions for full screen
  const width = stdout?.columns ?? 80;
  const height = stdout?.rows ?? 24;

  const {
    sessions,
    activeSession,
    activeSessionId,
    setActiveSessionId,
    refresh: refreshSessions,
  } = useSessions();

  const {
    tasks,
    epicName,
    skill,
    refresh: refreshTasks,
  } = useTasks(activeSession);

  const {
    lines,
    isRunning,
    setIsRunning,
    appendOutput,
    appendSystemMessage,
  } = useOutput();

  // Create command context
  const commandContext: CommandContext = {
    appendOutput,
    setActiveSession: setActiveSessionId,
    refreshSessions,
    refreshTasks,
  };

  const handleCommand = useCallback((command: string) => {
    appendSystemMessage(`> ${command}`);
    executeCommand(command, commandContext);
  }, [appendSystemMessage, commandContext]);

  // Tab navigation helpers
  const prevTab = useCallback(() => {
    if (sessions.length > 0) {
      const currentIndex = sessions.findIndex(s => s.id === activeSessionId);
      const newIndex = currentIndex > 0 ? currentIndex - 1 : sessions.length - 1;
      setActiveSessionId(sessions[newIndex].id);
    }
  }, [sessions, activeSessionId, setActiveSessionId]);

  const nextTab = useCallback(() => {
    if (sessions.length > 0) {
      const currentIndex = sessions.findIndex(s => s.id === activeSessionId);
      const newIndex = currentIndex < sessions.length - 1 ? currentIndex + 1 : 0;
      setActiveSessionId(sessions[newIndex].id);
    }
  }, [sessions, activeSessionId, setActiveSessionId]);

  // Global keyboard shortcuts
  useKeyboard({
    toggleHelp: () => setShowHelp(prev => !prev),
    newSession: () => {
      inputRef.current?.focus();
      appendSystemMessage('Enter plan request: /plan <description>');
    },
    startBuild: () => {
      if (!isRunning) {
        handleCommand('/build');
        setIsRunning(true);
      }
    },
    cancelBuild: () => {
      if (isRunning) {
        handleCommand('/cancel');
      }
    },
    refresh: () => {
      refreshSessions();
      refreshTasks();
      appendSystemMessage('Status refreshed');
    },
    focusInput: () => {
      inputRef.current?.focus();
    },
    prevTab,
    nextTab,
  }, isInputFocused);

  // Show welcome message on first render
  React.useEffect(() => {
    appendSystemMessage('Welcome to Clive TUI');
    appendSystemMessage('Press ? for keyboard shortcuts');
    appendSystemMessage('');
  }, []);

  // If help is showing, render overlay
  if (showHelp) {
    return (
      <Box
        flexDirection="column"
        width={width}
        height={height}
      >
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <HelpOverlay isVisible={showHelp} onClose={() => setShowHelp(false)} />
        </Box>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
    >
      <TabBar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={setActiveSessionId}
        onNewSession={() => {
          inputRef.current?.focus();
          appendSystemMessage('Enter plan request: /plan <description>');
        }}
      />

      <Box flexGrow={1} minHeight={10}>
        <TaskSidebar
          tasks={tasks}
          epicName={epicName}
          skill={skill}
        />
        <TerminalOutput lines={lines} />
      </Box>

      <CommandInput
        ref={inputRef}
        onSubmit={handleCommand}
        onFocusChange={setIsInputFocused}
      />

      <StatusBar
        session={activeSession}
        tasks={tasks}
        isRunning={isRunning}
      />
    </Box>
  );
};
