/**
 * Header Component
 * Displays status bar with execution state and info
 */

import { OneDarkPro } from '../styles/theme';

interface HeaderProps {
  width: number;
  height: number;
  isRunning: boolean;
}

export function Header({ width, height, isRunning }: HeaderProps) {
  const statusText = isRunning ? ' RUNNING' : ' IDLE';
  const statusColor = isRunning ? OneDarkPro.syntax.yellow : OneDarkPro.syntax.green;

  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.secondary}
      borderStyle="round"
      borderColor={OneDarkPro.ui.border}
      flexDirection="row"
      justifyContent="space-between"
      padding={1}
    >
      <box flexDirection="row">
        <text color={OneDarkPro.syntax.blue} bold>
          Clive TUI
        </text>
        <text color={OneDarkPro.foreground.muted}> | </text>
        <text color={statusColor}>
          {statusText}
        </text>
      </box>

      <text color={OneDarkPro.foreground.muted}>
        Press ? for help | q to quit
      </text>
    </box>
  );
}
