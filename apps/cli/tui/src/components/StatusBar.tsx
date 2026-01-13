import React from 'react';
import { Box, Text } from 'ink';
import type { Session, Task } from '../types.js';

interface StatusBarProps {
  session: Session | null;
  tasks: Task[];
  isRunning?: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  session,
  tasks,
  isRunning = false,
}) => {
  const complete = tasks.filter(t => t.status === 'complete').length;
  const total = tasks.length;

  const statusText = isRunning ? 'Running' : session ? 'Ready' : 'Idle';
  const statusColor = isRunning ? 'green' : session ? 'yellow' : 'gray';

  return (
    <Box borderStyle="single" borderTop={false} paddingX={1} justifyContent="space-between">
      <Box gap={2}>
        <Text backgroundColor={statusColor as Parameters<typeof Text>[0]['backgroundColor']} color="black">
          {' '}{statusText}{' '}
        </Text>

        {session?.iteration !== undefined && (
          <Text color="white">
            Iteration: {session.iteration}/{session.maxIterations}
          </Text>
        )}

        {total > 0 && (
          <Text color="white">
            Tasks: {complete}/{total}
          </Text>
        )}
      </Box>

      <Box gap={2}>
        <Text color="gray">/ commands</Text>
        <Text color="gray">Ctrl+C quit</Text>
      </Box>
    </Box>
  );
};
