/**
 * DirectModeView Component
 *
 * Full-screen direct mode where Claude Code has complete terminal control.
 * Uses ANSI scroll regions to confine Claude Code to the main area
 * while keeping a minimal status bar at the bottom.
 *
 * Features:
 * - Claude Code renders directly to terminal (no re-rendering)
 * - Uses scroll region to separate Claude Code area from status bar
 * - Native scrolling and interaction handled by Claude Code
 */

import { useEffect } from 'react';
import { OneDarkPro } from '../styles/theme';
import type { CliveMode } from '../types/views';
import type { Task, Session } from '../types';

interface DirectModeViewProps {
  /** Terminal width */
  width: number;
  /** Terminal height */
  height: number;
  /** Current mode */
  mode: CliveMode | null;
  /** Whether PTY is running */
  isRunning: boolean;
  /** Tasks for sidebar */
  tasks: Task[];
  /** Active session for sidebar */
  activeSession: Session | null;
  /** Callback when user wants to exit */
  onExit: () => void;
}

export function DirectModeView({
  width,
  height,
  mode,
  isRunning,
  tasks,
  activeSession,
  onExit,
}: DirectModeViewProps) {
  // Mode color for status bar
  const modeColor = mode === 'plan'
    ? OneDarkPro.syntax.blue
    : mode === 'build'
    ? OneDarkPro.syntax.yellow
    : OneDarkPro.foreground.muted;

  // Task summary for status bar
  // Tasks are LinearIssue | BeadsIssue - check state.type for completion
  const completedTasks = tasks.filter(t => {
    const stateType = 'state' in t ? t.state?.type : undefined;
    return stateType === 'completed' || stateType === 'canceled';
  }).length;
  const totalTasks = tasks.length;
  const taskProgress = totalTasks > 0 ? `${completedTasks}/${totalTasks}` : '';

  // In direct mode, Claude Code renders above this component via stdout
  // We only render a minimal status bar at the very bottom
  // The status bar uses absolute positioning to avoid interfering with Claude

  return (
    <box
      width={width}
      height={height}
      backgroundColor="transparent"
    >
      {/*
        Main area is transparent - Claude Code renders here directly.
        We don't draw anything to avoid flickering/conflicts.
      */}

      {/* Minimal floating status bar at bottom */}
      <box
        x={0}
        y={height - 1}
        width={width}
        height={1}
        backgroundColor={OneDarkPro.background.tertiary}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
        justifyContent="space-between"
      >
        <box flexDirection="row">
          <text fg={modeColor} bold>
            {mode === 'plan' ? 'PLAN' : mode === 'build' ? 'BUILD' : ''}
          </text>
          {taskProgress && (
            <text fg={OneDarkPro.foreground.muted}>
              {' '} Tasks: {taskProgress}
            </text>
          )}
          {activeSession?.name && (
            <text fg={OneDarkPro.foreground.comment}>
              {' '} • {activeSession.linearData?.identifier || activeSession.name.slice(0, 20)}
            </text>
          )}
        </box>
        <box flexDirection="row">
          {isRunning ? (
            <text fg={OneDarkPro.syntax.green}>
              Running
            </text>
          ) : (
            <text fg={OneDarkPro.foreground.muted}>
              Done
            </text>
          )}
          <text fg={OneDarkPro.foreground.comment}>
            {' '} • Ctrl+C: Stop
          </text>
        </box>
      </box>
    </box>
  );
}
