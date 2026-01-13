import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme.js';
import type { Session, Task } from '../types.js';

interface StatusBarProps {
  session: Session | null;
  tasks: Task[];
  isRunning?: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = memo(({
  session,
  tasks,
  isRunning = false,
}) => {
  const theme = useTheme();
  const complete = tasks.filter(t => t.status === 'complete').length;
  const total = tasks.length;

  const statusText = isRunning ? 'Running' : session ? 'Ready' : 'Idle';
  const statusBgColor = isRunning ? theme.syntax.green : session ? theme.syntax.yellow : theme.fg.muted;

  return (
    <Box
      borderStyle="round"
      borderColor={theme.ui.border}
      borderTop={false}
      paddingX={1}
      justifyContent="space-between"
    >
      <Box gap={2}>
        <Text backgroundColor={statusBgColor} color={theme.bg.primary} bold>
          {' '}{statusText}{' '}
        </Text>

        {session?.iteration !== undefined && (
          <Text color={theme.fg.primary}>
            Iteration: <Text color={theme.syntax.cyan}>{session.iteration}/{session.maxIterations}</Text>
          </Text>
        )}

        {total > 0 && (
          <Text color={theme.fg.primary}>
            Tasks: <Text color={theme.syntax.cyan}>{complete}/{total}</Text>
          </Text>
        )}
      </Box>

      <Box gap={2}>
        <Text color={theme.fg.muted}>
          <Text color={theme.syntax.yellow}>?</Text> help
        </Text>
        <Text color={theme.fg.muted}>
          <Text color={theme.syntax.yellow}>/</Text> commands
        </Text>
        <Text color={theme.fg.muted}>
          <Text color={theme.syntax.yellow}>Ctrl+C</Text> quit
        </Text>
      </Box>
    </Box>
  );
});

StatusBar.displayName = 'StatusBar';
