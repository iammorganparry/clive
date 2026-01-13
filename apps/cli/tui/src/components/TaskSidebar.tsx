import React from 'react';
import { Box, Text } from 'ink';
import type { Task } from '../types.js';
import { TaskItem } from './TaskItem.js';

interface TaskSidebarProps {
  tasks: Task[];
  epicName?: string;
  selectedIndex?: number;
  skill?: string;
}

export const TaskSidebar: React.FC<TaskSidebarProps> = ({
  tasks,
  epicName,
  selectedIndex,
  skill,
}) => {
  const complete = tasks.filter(t => t.status === 'complete').length;
  const total = tasks.length;

  return (
    <Box
      flexDirection="column"
      width={28}
      borderStyle="single"
      borderRight={false}
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">TASKS</Text>
      </Box>

      {epicName && (
        <Box marginBottom={1}>
          <Text color="white">Epic: {epicName}</Text>
        </Box>
      )}

      <Box marginBottom={1}>
        <Text color="gray">───────────────────────</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {tasks.length === 0 ? (
          <Text color="gray">No tasks</Text>
        ) : (
          tasks.map((task, index) => (
            <TaskItem
              key={task.id}
              task={task}
              isSelected={index === selectedIndex}
            />
          ))
        )}
      </Box>

      <Box marginTop={1}>
        <Text color="gray">───────────────────────</Text>
      </Box>

      <Box>
        <Text color={complete === total && total > 0 ? 'green' : 'white'}>
          {complete}/{total} complete
        </Text>
      </Box>

      {skill && (
        <Box>
          <Text color="gray">Skill: {skill}</Text>
        </Box>
      )}
    </Box>
  );
};
