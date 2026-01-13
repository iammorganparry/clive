import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme.js';
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
  const theme = useTheme();
  const complete = tasks.filter(t => t.status === 'complete').length;
  const total = tasks.length;

  return (
    <Box
      flexDirection="column"
      width={28}
      borderStyle="round"
      borderColor={theme.ui.border}
      borderRight={false}
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color={theme.syntax.magenta}>TASKS</Text>
      </Box>

      {epicName && (
        <Box marginBottom={1}>
          <Text color={theme.fg.primary}>Epic: </Text>
          <Text color={theme.syntax.cyan}>{epicName}</Text>
        </Box>
      )}

      <Box marginBottom={1}>
        <Text color={theme.ui.border}>───────────────────────</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {tasks.length === 0 ? (
          <Text color={theme.fg.muted}>No tasks</Text>
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
        <Text color={theme.ui.border}>───────────────────────</Text>
      </Box>

      <Box>
        <Text color={complete === total && total > 0 ? theme.syntax.green : theme.fg.primary}>
          {complete}/{total} complete
        </Text>
      </Box>

      {skill && (
        <Box>
          <Text color={theme.fg.muted}>Skill: </Text>
          <Text color={theme.syntax.orange}>{skill}</Text>
        </Box>
      )}
    </Box>
  );
};
