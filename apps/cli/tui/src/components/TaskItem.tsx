import React from 'react';
import { Box, Text } from 'ink';
import type { Task } from '../types.js';

interface TaskItemProps {
  task: Task;
  isSelected?: boolean;
}

const statusIcons: Record<Task['status'], { icon: string; color: string }> = {
  complete: { icon: '✓', color: 'green' },
  in_progress: { icon: '●', color: 'yellow' },
  pending: { icon: '○', color: 'gray' },
  blocked: { icon: '✗', color: 'red' },
  skipped: { icon: '–', color: 'gray' },
};

export const TaskItem: React.FC<TaskItemProps> = ({ task, isSelected }) => {
  const { icon, color } = statusIcons[task.status];

  return (
    <Box>
      <Text color={color as Parameters<typeof Text>[0]['color']}>{icon} </Text>
      <Text
        color={isSelected ? 'cyan' : task.status === 'complete' ? 'gray' : 'white'}
        dimColor={task.status === 'complete'}
      >
        {task.title.length > 25 ? task.title.slice(0, 22) + '...' : task.title}
      </Text>
    </Box>
  );
};
