import { Box, Text } from "ink";
import type React from "react";
import { memo } from "react";
import { useTheme } from "../theme.js";
import type { Task } from "../types.js";

interface TaskItemProps {
  task: Task;
  isSelected?: boolean;
}

export const TaskItem: React.FC<TaskItemProps> = memo(
  ({ task, isSelected }) => {
    const theme = useTheme();

    const statusStyles: Record<
      Task["status"],
      { icon: string; color: string }
    > = {
      complete: { icon: "✓", color: theme.syntax.green },
      in_progress: { icon: "●", color: theme.syntax.yellow },
      pending: { icon: "○", color: theme.fg.muted },
      blocked: { icon: "✗", color: theme.syntax.red },
      skipped: { icon: "–", color: theme.fg.comment },
    };

    const { icon, color } = statusStyles[task.status];

    return (
      <Box>
        <Text color={color}>{icon} </Text>
        <Text
          color={
            isSelected
              ? theme.syntax.cyan
              : task.status === "complete"
                ? theme.fg.comment
                : theme.fg.primary
          }
          dimColor={task.status === "complete"}
        >
          {task.title.length > 32
            ? task.title.slice(0, 29) + "..."
            : task.title}
        </Text>
      </Box>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparator for better performance
    return (
      prevProps.task.id === nextProps.task.id &&
      prevProps.task.status === nextProps.task.status &&
      prevProps.task.title === nextProps.task.title &&
      prevProps.isSelected === nextProps.isSelected
    );
  },
);

TaskItem.displayName = "TaskItem";
