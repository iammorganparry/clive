/**
 * StatusBar Component
 * Shows execution status and helpful hints
 */

import { OneDarkPro } from '../styles/theme';

interface StatusBarProps {
  width: number;
  height: number;
  isRunning: boolean;
  inputFocused?: boolean;
  workspaceRoot?: string;
}

export function StatusBar({ width, height, isRunning, inputFocused = false, workspaceRoot }: StatusBarProps) {
  const statusText = isRunning ? '⏳ Executing...' : '✓ Ready';
  const statusColor = isRunning ? OneDarkPro.syntax.yellow : OneDarkPro.syntax.green;

  // Get directory name from workspace root (show last part of path)
  const workspaceName = workspaceRoot
    ? workspaceRoot.split('/').filter(Boolean).pop() || workspaceRoot
    : 'unknown';

  // Context-sensitive help hints
  let helpHint = '';
  if (inputFocused) {
    helpHint = 'Enter execute  •  Tab complete  •  Esc unfocus  •  Ctrl+C quit';
  } else if (isRunning) {
    helpHint = 'Ctrl+G scroll bottom  •  Ctrl+C quit';
  } else {
    helpHint = '/ input  •  ? help  •  Esc back  •  Ctrl+C quit';
  }

  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.secondary}
      paddingLeft={1}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
    >
      {/* Left: Status and workspace */}
      <box flexDirection="row">
        <text fg={statusColor}>
          {statusText}
        </text>
        {workspaceRoot && (
          <>
            <text fg={OneDarkPro.foreground.muted}> • </text>
            <text fg={OneDarkPro.syntax.cyan}>📁 {workspaceName}</text>
          </>
        )}
      </box>

      {/* Right: Help hints */}
      <text fg={OneDarkPro.foreground.muted} paddingRight={1}>
        {helpHint}
      </text>
    </box>
  );
}
