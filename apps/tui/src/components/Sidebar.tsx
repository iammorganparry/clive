/**
 * Sidebar Component
 * Shows task list grouped by status
 */

import { OneDarkPro } from '../styles/theme';
import { Task } from '../types';

interface SidebarProps {
  width: number;
  height: number;
  tasks: Task[];
  x?: number;
  y?: number;
}

export function Sidebar({ width, height, tasks, x = 0, y = 0 }: SidebarProps) {
  // Group tasks by status
  const inProgress = tasks.filter(t => t.status === 'in_progress');
  const pending = tasks.filter(t => t.status === 'pending');
  const completed = tasks.filter(t => t.status === 'completed');

  const maxDisplay = 10;

  const truncate = (text: string, maxLen: number) => {
    return text.length > maxLen ? text.substring(0, maxLen - 1) + '…' : text;
  };

  return (
    <box
      x={x}
      y={y}
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.secondary}
      paddingLeft={1}
      paddingTop={1}
      flexDirection="column"
    >
      {/* Title */}
      <text fg={OneDarkPro.syntax.blue} marginBottom={1}>
        TASKS
      </text>

      {/* No tasks message */}
      {tasks.length === 0 && (
        <box marginTop={1}>
          <text fg={OneDarkPro.foreground.muted}>
            No tasks yet.{'\n'}Run /plan to create.
          </text>
        </box>
      )}

      {/* In Progress */}
      {inProgress.length > 0 && (
        <box flexDirection="column" marginTop={1}>
          <text fg={OneDarkPro.syntax.yellow}>
            In Progress
          </text>
          {inProgress.slice(0, maxDisplay).map((task, i) => (
            <text key={i} fg={OneDarkPro.syntax.yellow}>
              {'  ● '}
              {truncate(task.title, width - 6)}
            </text>
          ))}
          {inProgress.length > maxDisplay && (
            <text fg={OneDarkPro.syntax.yellow}>
              {'  + '}
              {inProgress.length - maxDisplay} more
            </text>
          )}
        </box>
      )}

      {/* Pending */}
      {pending.length > 0 && (
        <box flexDirection="column" marginTop={1}>
          <text fg={OneDarkPro.foreground.muted}>
            Pending
          </text>
          {pending.slice(0, maxDisplay).map((task, i) => (
            <text key={i} fg={OneDarkPro.foreground.muted}>
              {'  ○ '}
              {truncate(task.title, width - 6)}
            </text>
          ))}
          {pending.length > maxDisplay && (
            <text fg={OneDarkPro.foreground.muted}>
              {'  + '}
              {pending.length - maxDisplay} more
            </text>
          )}
        </box>
      )}

      {/* Complete */}
      {completed.length > 0 && (
        <box flexDirection="column" marginTop={1}>
          <text fg={OneDarkPro.syntax.green}>
            Complete
          </text>
          {completed.slice(0, maxDisplay).map((task, i) => (
            <text key={i} fg={OneDarkPro.syntax.green}>
              {'  ✓ '}
              {truncate(task.title, width - 6)}
            </text>
          ))}
          {completed.length > maxDisplay && (
            <text fg={OneDarkPro.syntax.green}>
              {'  + '}
              {completed.length - maxDisplay} more
            </text>
          )}
        </box>
      )}
    </box>
  );
}
