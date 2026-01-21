/**
 * Header Component
 * Displays status bar with execution state and info
 */

import { OneDarkPro } from '../styles/theme';
import { Session } from '../types';

interface HeaderProps {
  width: number;
  height: number;
  isRunning: boolean;
  activeSession?: Session | null;
}

export function Header({ width, height, isRunning, activeSession }: HeaderProps) {
  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.primary}
      paddingLeft={1}
      paddingTop={0}
      flexDirection="column"
    >
      <box flexDirection="row">
        <text fg={OneDarkPro.syntax.red}>
          CLIVE  AI-Powered Work Execution
          {activeSession ? ` · ${activeSession.name.substring(0, 30)}${activeSession.name.length > 30 ? '...' : ''}` : ''}
        </text>
      </box>
    </box>
  );
}
