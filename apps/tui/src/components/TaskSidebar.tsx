import React, { memo, useMemo } from 'react';
import { Box, Text, useFocus } from 'ink';
import { useTheme } from '../theme.js';
import type { Task } from '../types.js';
import { TaskItem } from './TaskItem.js';
import { useTasksList } from '../machines/TasksMachineProvider.js';

interface TaskSidebarProps {
  maxPerCategory?: number;
}

// Status display order and styling
const STATUS_CONFIG: Array<{
  status: Task['status'];
  label: string;
  colorKey: 'yellow' | 'muted' | 'red' | 'comment' | 'green';
}> = [
  { status: 'in_progress', label: 'In Progress', colorKey: 'yellow' },
  { status: 'pending', label: 'Queued', colorKey: 'muted' },
  { status: 'blocked', label: 'Blocked', colorKey: 'red' },
  { status: 'complete', label: 'Completed', colorKey: 'green' },
  { status: 'skipped', label: 'Skipped', colorKey: 'comment' },
];

export const TaskSidebar: React.FC<TaskSidebarProps> = memo(({
  maxPerCategory = 10,
}) => {
  const theme = useTheme();
  const { isFocused } = useFocus({ id: 'task-sidebar' });

  // Subscribe to tasks from machine - only TaskSidebar re-renders on task changes
  const { tasks, epicName, skill } = useTasksList();

  // Memoize grouped tasks to prevent recalculation on every render
  const tasksByStatus = useMemo(() => {
    return tasks.reduce((acc, task) => {
      if (!acc[task.status]) {
        acc[task.status] = [];
      }
      acc[task.status].push(task);
      return acc;
    }, {} as Record<Task['status'], Task[]>);
  }, [tasks]);

  // Memoize counts
  const { complete, total } = useMemo(() => ({
    complete: tasks.filter(t => t.status === 'complete').length,
    total: tasks.length,
  }), [tasks]);

  // Color mapping
  const getColor = (colorKey: string) => {
    switch (colorKey) {
      case 'yellow': return theme.syntax.yellow;
      case 'green': return theme.syntax.green;
      case 'red': return theme.syntax.red;
      case 'comment': return theme.fg.comment;
      default: return theme.fg.muted;
    }
  };

  return (
    <Box
      flexDirection="column"
      width={36}
      borderStyle="round"
      borderColor={isFocused ? theme.syntax.blue : theme.ui.border}
      borderRight={false}
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color={theme.syntax.magenta}>TASKS</Text>
      </Box>

      {epicName && (
        <Box marginBottom={1}>
          <Text color={theme.fg.muted}>Epic: </Text>
          <Text color={theme.syntax.cyan}>{epicName}</Text>
        </Box>
      )}

      <Box marginBottom={1}>
        <Text color={theme.ui.border}>────────────────────────────────</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {tasks.length === 0 ? (
          <Text color={theme.fg.muted}>No tasks</Text>
        ) : (
          STATUS_CONFIG.map(({ status, label, colorKey }, groupIndex) => {
            const groupTasks = tasksByStatus[status] || [];
            if (groupTasks.length === 0) return null;

            const visibleTasks = groupTasks.slice(0, maxPerCategory);
            const hiddenCount = groupTasks.length - visibleTasks.length;
            const color = getColor(colorKey);

            return (
              <Box key={status} flexDirection="column" marginTop={groupIndex > 0 ? 1 : 0}>
                {/* Status header with count */}
                <Box>
                  <Text color={color} bold>{label}</Text>
                  <Text color={theme.fg.muted}> ({groupTasks.length})</Text>
                </Box>

                {/* Tasks in this group */}
                {visibleTasks.map(task => (
                  <TaskItem key={task.id} task={task} />
                ))}

                {/* Show "+ X more" if truncated */}
                {hiddenCount > 0 && (
                  <Box>
                    <Text color={theme.fg.muted}>  + {hiddenCount} more</Text>
                  </Box>
                )}
              </Box>
            );
          })
        )}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.ui.border}>────────────────────────────────</Text>
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
});

TaskSidebar.displayName = 'TaskSidebar';
