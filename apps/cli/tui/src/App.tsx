import React, { useCallback } from 'react';
import { Box, useInput, useApp } from 'ink';
import { TabBar } from './components/TabBar.js';
import { TaskSidebar } from './components/TaskSidebar.js';
import { TerminalOutput } from './components/TerminalOutput.js';
import { CommandInput } from './components/CommandInput.js';
import { StatusBar } from './components/StatusBar.js';
import { useSessions } from './hooks/useSessions.js';
import { useTasks } from './hooks/useTasks.js';
import { useOutput } from './hooks/useOutput.js';
import { executeCommand } from './commands/index.js';
import type { CommandContext } from './types.js';

export const App: React.FC = () => {
  const { exit } = useApp();
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
    appendOutput,
    appendSystemMessage,
  } = useOutput();

  // Handle tab switching with arrow keys
  useInput((input, key) => {
    if (key.leftArrow && sessions.length > 0) {
      const currentIndex = sessions.findIndex(s => s.id === activeSessionId);
      const newIndex = currentIndex > 0 ? currentIndex - 1 : sessions.length - 1;
      setActiveSessionId(sessions[newIndex].id);
    }
    if (key.rightArrow && sessions.length > 0) {
      const currentIndex = sessions.findIndex(s => s.id === activeSessionId);
      const newIndex = currentIndex < sessions.length - 1 ? currentIndex + 1 : 0;
      setActiveSessionId(sessions[newIndex].id);
    }
  });

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

  // Show welcome message on first render
  React.useEffect(() => {
    appendSystemMessage('Welcome to Clive TUI');
    appendSystemMessage('Type /help for available commands');
    appendSystemMessage('');
  }, []);

  return (
    <Box flexDirection="column" minHeight={20}>
      <TabBar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={setActiveSessionId}
      />

      <Box flexGrow={1} minHeight={10}>
        <TaskSidebar
          tasks={tasks}
          epicName={epicName}
          skill={skill}
        />
        <TerminalOutput lines={lines} />
      </Box>

      <CommandInput onSubmit={handleCommand} />

      <StatusBar
        session={activeSession}
        tasks={tasks}
        isRunning={isRunning}
      />
    </Box>
  );
};
