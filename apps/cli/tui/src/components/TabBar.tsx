import React from 'react';
import { Box, Text } from 'ink';
import type { Session } from '../types.js';

interface TabBarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({ sessions, activeSessionId, onSelect }) => {
  if (sessions.length === 0) {
    return (
      <Box borderStyle="single" borderBottom paddingX={1}>
        <Text color="gray">No sessions - use /plan to create one</Text>
      </Box>
    );
  }

  return (
    <Box borderStyle="single" borderBottom={false} paddingX={1} gap={1}>
      {sessions.map((session, index) => {
        const isActive = session.id === activeSessionId;
        const isRunning = session.isActive && session.iteration !== undefined;

        return (
          <Box key={session.id}>
            <Text
              backgroundColor={isActive ? 'blue' : undefined}
              color={isActive ? 'white' : isRunning ? 'green' : 'gray'}
              bold={isActive}
            >
              {' '}
              {isRunning ? '●' : '○'} {session.name}
              {isRunning && ` (${session.iteration}/${session.maxIterations})`}
              {' '}
            </Text>
            {index < sessions.length - 1 && <Text color="gray">│</Text>}
          </Box>
        );
      })}
      <Box marginLeft={1}>
        <Text color="cyan">[+ New]</Text>
      </Box>
    </Box>
  );
};
