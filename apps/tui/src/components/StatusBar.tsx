/**
 * StatusBar Component
 * Shows execution status and helpful hints
 */

import { OneDarkPro } from '../styles/theme';

interface StatusBarProps {
  width: number;
  height: number;
  isRunning: boolean;
}

export function StatusBar({ width, height, isRunning }: StatusBarProps) {
  const statusText = isRunning ? '⏳ Executing...' : '✓ Ready';
  const statusColor = isRunning ? OneDarkPro.syntax.yellow : OneDarkPro.syntax.green;

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
        ? Help  •  q Quit
      </text>
    </box>
  );
}
