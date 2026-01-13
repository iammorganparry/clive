import React, { useCallback, useState, useRef, useMemo } from 'react';
import { Box, useStdout } from 'ink';
import { Header } from './components/Header.js';
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
import type { CommandContext } from './types.js';

export const App: React.FC = () => {
  const { stdout } = useStdout();
  const [showHelp, setShowHelp] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const inputRef = useRef<{ focus: () => void }>(null);

  // Cache initial dimensions to prevent flicker on resize
  const initialDimensions = useRef({
    width: stdout?.columns ?? 80,
    height: stdout?.rows ?? 24,
  });

  // Only update dimensions if significantly changed (debounce small fluctuations)
  const { width, height } = useMemo(() => {
    const newWidth = stdout?.columns ?? 80;
    const newHeight = stdout?.rows ?? 24;

    // Only update if changed by more than 2 to reduce flicker
    if (Math.abs(newWidth - initialDimensions.current.width) > 2 ||
        Math.abs(newHeight - initialDimensions.current.height) > 2) {
      initialDimensions.current = { width: newWidth, height: newHeight };
    }

    return initialDimensions.current;
  }, [stdout?.columns, stdout?.rows]);

  const {
    sessions,
    activeSession,
    activeSessionId,
    setActiveSessionId,
    refresh: refreshSessions,
  } = useSessions();

  const {
    lines,
    isRunning,
    setIsRunning,
    startTime,
    appendOutput,
    appendSystemMessage,
  } = useOutput();

  const {
    tasks,
    epicName,
    skill,
    refresh: refreshTasks,
  } = useTasks(activeSession, isRunning);

  // Memoize command context to prevent unnecessary re-renders
  const commandContext = useMemo<CommandContext>(() => ({
    appendOutput,
    setActiveSession: setActiveSessionId,
    refreshSessions,
    refreshTasks,
    activeSession,
    setIsRunning,
  }), [appendOutput, setActiveSessionId, refreshSessions, refreshTasks, activeSession, setIsRunning]);

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

  // Show session info once when session becomes available (no useEffect)
  const hasShownSessionInfoRef = useRef(false);
  if (activeSession && !hasShownSessionInfoRef.current) {
    hasShownSessionInfoRef.current = true;
    queueMicrotask(() => {
      appendSystemMessage(`Active plan: ${activeSession.name}`);
      appendSystemMessage('Press b to start build or /build to run');
      appendSystemMessage('');
    });
  }

  // If help is showing, render overlay
  if (showHelp) {
    return (
      <Box
        flexDirection="column"
        width={width}
        height={height}
      >
        <Header />
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
      <Header />
      <TabBar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={setActiveSessionId}
        onNewSession={() => {
          inputRef.current?.focus();
          appendSystemMessage('Enter plan request: /plan <description>');
        }}
      />

      <Box flexGrow={1} minHeight={10} height={height - 8}>
        <TaskSidebar
          tasks={tasks}
          epicName={epicName}
          skill={skill}
        />
        <TerminalOutput
          lines={lines}
          maxLines={height - 12}
          isRunning={isRunning}
          startTime={startTime}
        />
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
