import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme.js';
import type { Session } from '../types.js';

interface TabBarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNewSession?: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  sessions,
  activeSessionId,
  onSelect,
  onNewSession,
}) => {
  const theme = useTheme();

  if (sessions.length === 0) {
    return (
      <Box
        borderStyle="round"
        borderColor={theme.ui.border}
        paddingX={1}
      >
        <Text color={theme.fg.muted}>No sessions - use /plan or press </Text>
        <Text color={theme.syntax.yellow}>n</Text>
        <Text color={theme.fg.muted}> to create one</Text>
        <Box marginLeft={2}>
          <Text color={theme.syntax.cyan} bold>[+ New]</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={theme.ui.border}
      paddingX={1}
      gap={1}
    >
      {sessions.map((session, index) => {
        const isActive = session.id === activeSessionId;
        const isRunning = session.isActive && session.iteration !== undefined;

        return (
          <Box key={session.id}>
            <Text
              backgroundColor={isActive ? theme.syntax.blue : undefined}
              color={isActive ? '#FFFFFF' : isRunning ? theme.syntax.green : theme.fg.secondary}
              bold={isActive}
            >
              {' '}
              {isRunning ? '●' : '○'} {session.name}
              {isRunning && ` (${session.iteration}/${session.maxIterations})`}
              {' '}
            </Text>
            {index < sessions.length - 1 && <Text color={theme.ui.border}>│</Text>}
          </Box>
        );
      })}
      <Box marginLeft={1}>
        <Text color={theme.syntax.cyan} bold>[+ New]</Text>
      </Box>
    </Box>
  );
};
