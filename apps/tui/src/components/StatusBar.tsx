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
}

export function StatusBar({ width, height, isRunning, inputFocused = false }: StatusBarProps) {
  const statusText = isRunning ? '⏳ Executing...' : '✓ Ready';
  const statusColor = isRunning ? OneDarkPro.syntax.yellow : OneDarkPro.syntax.green;

  // Context-sensitive help hints
  let helpHint = '';
  if (inputFocused) {
    helpHint = 'Enter execute  •  Tab complete  •  Esc unfocus  •  Ctrl+C quit';
  } else if (isRunning) {
    helpHint = 'i message  •  /add task  •  c cancel  •  Ctrl+C quit';
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
      <text fg={statusColor}>
        {statusText}
      </text>
      <text fg={OneDarkPro.foreground.muted} paddingRight={1}>
        {helpHint}
      </text>
    </box>
  );
}
