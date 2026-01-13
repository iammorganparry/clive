import React, { useState, useEffect, memo } from 'react';
import { Box, Text, useInput, useFocus } from 'ink';
import { useTheme } from '../theme.js';
import type { Task } from '../types.js';
import { TaskItem } from './TaskItem.js';

interface TaskSidebarProps {
  tasks: Task[];
  epicName?: string;
  skill?: string;
  maxVisible?: number;
}

export const TaskSidebar: React.FC<TaskSidebarProps> = memo(({
  tasks,
  epicName,
  skill,
  maxVisible = 12,
}) => {
  const theme = useTheme();
  const [scrollOffset, setScrollOffset] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { isFocused } = useFocus({ id: 'task-sidebar' });

  const complete = tasks.filter(t => t.status === 'complete').length;
  const total = tasks.length;

  // Calculate visible range
  const visibleTasks = tasks.slice(scrollOffset, scrollOffset + maxVisible);
  const canScrollUp = scrollOffset > 0;
  const canScrollDown = scrollOffset + maxVisible < tasks.length;

  // Handle keyboard navigation
  useInput((input, key) => {
    if (!isFocused) return;

    if (key.upArrow || input === 'k') {
      if (selectedIndex > 0) {
        setSelectedIndex(prev => prev - 1);
        // Scroll up if needed
        if (selectedIndex - 1 < scrollOffset) {
          setScrollOffset(prev => Math.max(0, prev - 1));
        }
      }
    }

    if (key.downArrow || input === 'j') {
      if (selectedIndex < tasks.length - 1) {
        setSelectedIndex(prev => prev + 1);
        // Scroll down if needed
        if (selectedIndex + 1 >= scrollOffset + maxVisible) {
          setScrollOffset(prev => Math.min(tasks.length - maxVisible, prev + 1));
        }
      }
    }

    // Page up/down
    if (key.pageUp) {
      setScrollOffset(prev => Math.max(0, prev - maxVisible));
      setSelectedIndex(prev => Math.max(0, prev - maxVisible));
    }

    if (key.pageDown) {
      setScrollOffset(prev => Math.min(tasks.length - maxVisible, prev + maxVisible));
      setSelectedIndex(prev => Math.min(tasks.length - 1, prev + maxVisible));
    }
  }, { isActive: isFocused });

  // Reset scroll when tasks change
  useEffect(() => {
    setScrollOffset(0);
    setSelectedIndex(0);
  }, [tasks.length]);

  // Group tasks by tier for display
  let currentTier: number | undefined;

  return (
    <Box
      flexDirection="column"
      width={28}
      borderStyle="round"
      borderColor={isFocused ? theme.syntax.blue : theme.ui.border}
      borderRight={false}
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color={theme.syntax.magenta}>TASKS</Text>
        {isFocused && <Text color={theme.fg.muted}> (focused)</Text>}
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

      {/* Scroll indicator - up */}
      {canScrollUp && (
        <Box>
          <Text color={theme.fg.muted}>  ▲ {scrollOffset} more</Text>
        </Box>
      )}

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {tasks.length === 0 ? (
          <Text color={theme.fg.muted}>No tasks</Text>
        ) : (
          visibleTasks.map((task, index) => {
            const actualIndex = scrollOffset + index;
            const showTierHeader = task.tier !== undefined && task.tier !== currentTier;
            if (task.tier !== undefined) {
              currentTier = task.tier;
            }

            return (
              <React.Fragment key={task.id}>
                {showTierHeader && (
                  <Box marginTop={index > 0 ? 1 : 0}>
                    <Text color={theme.syntax.orange} bold>Tier {task.tier}</Text>
                  </Box>
                )}
                <TaskItem
                  task={task}
                  isSelected={actualIndex === selectedIndex && isFocused}
                />
              </React.Fragment>
            );
          })
        )}
      </Box>

      {/* Scroll indicator - down */}
      {canScrollDown && (
        <Box>
          <Text color={theme.fg.muted}>  ▼ {tasks.length - scrollOffset - maxVisible} more</Text>
        </Box>
      )}

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
});

TaskSidebar.displayName = 'TaskSidebar';
