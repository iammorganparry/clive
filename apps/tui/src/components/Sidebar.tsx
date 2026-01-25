/**
 * Sidebar Component
 * Shows task list grouped by status with modern, fun design
 */

import { OneDarkPro } from "../styles/theme";
import type { Session, Task } from "../types";
import { getTaskStatus } from "../utils/taskHelpers";

interface SidebarProps {
  width: number;
  height: number;
  tasks: Task[];
  activeSession?: Session | null;
  x?: number;
  y?: number;
}

export function Sidebar({
  width,
  height,
  tasks,
  activeSession,
  x = 0,
  y = 0,
}: SidebarProps) {
  // Group tasks by status
  const inProgress = tasks.filter((t) => getTaskStatus(t) === "in_progress");
  const pending = tasks.filter((t) => getTaskStatus(t) === "pending");
  const completed = tasks.filter((t) => getTaskStatus(t) === "completed");
  const blocked = tasks.filter((t) => getTaskStatus(t) === "blocked");

  const maxDisplay = 8;

  const truncate = (text: string, maxLen: number) => {
    return text.length > maxLen ? `${text.substring(0, maxLen - 1)}…` : text;
  };

  // Calculate total tasks and progress
  const totalTasks = tasks.length;
  const completedCount = completed.length;
  const progressPercent =
    totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

  return (
    <box
      x={x}
      y={y}
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.secondary}
      paddingLeft={1}
      paddingTop={1}
      paddingRight={1}
      flexDirection="column"
    >
      {/* Header with logo and epic name */}
      <box flexDirection="column" marginBottom={1}>
        <box flexDirection="row" alignItems="center">
          <text fg={OneDarkPro.syntax.purple}>🎯 </text>
          <text fg={OneDarkPro.syntax.cyan}>Clive</text>
        </box>
        {activeSession && (
          <box flexDirection="column" marginTop={0}>
            <text fg={OneDarkPro.foreground.muted}>
              {truncate(activeSession.name, width - 2)}
            </text>
          </box>
        )}
      </box>

      {/* Tasks Header */}
      <box
        flexDirection="row"
        alignItems="center"
        marginBottom={0}
        marginTop={1}
      >
        <text fg={OneDarkPro.syntax.blue}>📋 Tasks</text>
      </box>

      {/* Progress bar */}
      {totalTasks > 0 && (
        <box flexDirection="column" marginBottom={1}>
          <box flexDirection="row" marginBottom={0}>
            <text fg={OneDarkPro.foreground.muted}>
              {completedCount}/{totalTasks} · {progressPercent}%
            </text>
          </box>
          <box flexDirection="row" width={width - 2}>
            <text fg={OneDarkPro.syntax.green}>
              {"█".repeat(Math.floor((width - 2) * (progressPercent / 100)))}
            </text>
            <text fg={OneDarkPro.ui.border}>
              {"░".repeat(
                Math.ceil((width - 2) * ((100 - progressPercent) / 100)),
              )}
            </text>
          </box>
        </box>
      )}

      {/* No tasks message */}
      {tasks.length === 0 && (
        <box marginTop={2} flexDirection="column" alignItems="center">
          <text fg={OneDarkPro.foreground.muted}>🎯 No tasks yet</text>
          <text fg={OneDarkPro.foreground.comment} marginTop={1}>
            Run /plan to start
          </text>
        </box>
      )}

      {/* In Progress Section */}
      {inProgress.length > 0 && (
        <box flexDirection="column" marginTop={1}>
          <box flexDirection="row" marginBottom={0}>
            <text fg={OneDarkPro.syntax.yellow}>⚡ In Progress </text>
            <text fg={OneDarkPro.foreground.muted}>({inProgress.length})</text>
          </box>
          {inProgress.slice(0, maxDisplay).map((task, i) => (
            <box key={i} flexDirection="row" paddingLeft={1} marginTop={0}>
              <text fg={OneDarkPro.syntax.yellow}>▸ </text>
              <text fg={OneDarkPro.foreground.primary}>
                {truncate(task.title, width - 5)}
              </text>
            </box>
          ))}
          {inProgress.length > maxDisplay && (
            <text
              fg={OneDarkPro.foreground.comment}
              paddingLeft={1}
              marginTop={0}
            >
              … {inProgress.length - maxDisplay} more
            </text>
          )}
        </box>
      )}

      {/* Blocked Section */}
      {blocked.length > 0 && (
        <box flexDirection="column" marginTop={1}>
          <box flexDirection="row" marginBottom={0}>
            <text fg={OneDarkPro.syntax.red}>🚫 Blocked </text>
            <text fg={OneDarkPro.foreground.muted}>({blocked.length})</text>
          </box>
          {blocked.slice(0, maxDisplay).map((task, i) => (
            <box key={i} flexDirection="row" paddingLeft={1} marginTop={0}>
              <text fg={OneDarkPro.syntax.red}>⊗ </text>
              <text fg={OneDarkPro.foreground.muted}>
                {truncate(task.title, width - 5)}
              </text>
            </box>
          ))}
          {blocked.length > maxDisplay && (
            <text
              fg={OneDarkPro.foreground.comment}
              paddingLeft={1}
              marginTop={0}
            >
              … {blocked.length - maxDisplay} more
            </text>
          )}
        </box>
      )}

      {/* Pending Section */}
      {pending.length > 0 && (
        <box flexDirection="column" marginTop={1}>
          <box flexDirection="row" marginBottom={0}>
            <text fg={OneDarkPro.syntax.cyan}>⏳ Pending </text>
            <text fg={OneDarkPro.foreground.muted}>({pending.length})</text>
          </box>
          {pending.slice(0, maxDisplay).map((task, i) => (
            <box key={i} flexDirection="row" paddingLeft={1} marginTop={0}>
              <text fg={OneDarkPro.syntax.cyan}>○ </text>
              <text fg={OneDarkPro.foreground.muted}>
                {truncate(task.title, width - 5)}
              </text>
            </box>
          ))}
          {pending.length > maxDisplay && (
            <text
              fg={OneDarkPro.foreground.comment}
              paddingLeft={1}
              marginTop={0}
            >
              … {pending.length - maxDisplay} more
            </text>
          )}
        </box>
      )}

      {/* Completed Section */}
      {completed.length > 0 && (
        <box flexDirection="column" marginTop={1}>
          <box flexDirection="row" marginBottom={0}>
            <text fg={OneDarkPro.syntax.green}>✓ Done </text>
            <text fg={OneDarkPro.foreground.muted}>({completed.length})</text>
          </box>
          {completed.slice(0, maxDisplay).map((task, i) => (
            <box key={i} flexDirection="row" paddingLeft={1} marginTop={0}>
              <text fg={OneDarkPro.syntax.green}>✓ </text>
              <text fg={OneDarkPro.foreground.comment}>
                {truncate(task.title, width - 5)}
              </text>
            </box>
          ))}
          {completed.length > maxDisplay && (
            <text
              fg={OneDarkPro.foreground.comment}
              paddingLeft={1}
              marginTop={0}
            >
              … {completed.length - maxDisplay} more
            </text>
          )}
        </box>
      )}
    </box>
  );
}
