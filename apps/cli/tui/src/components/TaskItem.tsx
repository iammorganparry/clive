import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme.js';
import type { Task } from '../types.js';

interface TaskItemProps {
  task: Task;
  isSelected?: boolean;
}

export const TaskItem: React.FC<TaskItemProps> = ({ task, isSelected }) => {
  const theme = useTheme();

  const statusStyles: Record<Task['status'], { icon: string; color: string }> = {
    complete: { icon: '✓', color: theme.syntax.green },
    in_progress: { icon: '●', color: theme.syntax.yellow },
    pending: { icon: '○', color: theme.fg.muted },
    blocked: { icon: '✗', color: theme.syntax.red },
    skipped: { icon: '–', color: theme.fg.comment },
  };

  const { icon, color } = statusStyles[task.status];

  return (
    <Box>
      <Text color={color}>{icon} </Text>
      <Text
        color={isSelected ? theme.syntax.cyan : task.status === 'complete' ? theme.fg.comment : theme.fg.primary}
        dimColor={task.status === 'complete'}
      >
        {task.title.length > 25 ? task.title.slice(0, 22) + '...' : task.title}
      </Text>
    </Box>
  );
};
