/**
 * OutputPanel Component
 * Displays terminal output using ghostty-terminal renderer
 * Renders ANSI output from PTY-based Claude CLI
 */

import { useEffect, useRef } from 'react';
import { OneDarkPro } from '../styles/theme';
import type { PtyDimensions } from '../services/PtyCliManager';

interface OutputPanelProps {
  width: number;
  height: number;
  ansiOutput: string;
  isRunning?: boolean;
  mode?: 'none' | 'plan' | 'build';
  modeColor?: string;
  ptyDimensions?: PtyDimensions | null;
}

export function OutputPanel({ width, height, ansiOutput, isRunning = false, mode = 'none', modeColor, ptyDimensions }: OutputPanelProps) {
  const scrollRef = useRef<any>(null);
  const isInMode = mode !== 'none';
  const modeHeaderHeight = isInMode ? 1 : 0;
  const terminalHeight = height - modeHeaderHeight;

  // Use PTY dimensions if available (calculated based on available space), otherwise use full available space
  const terminalCols = ptyDimensions?.cols || width;
  const terminalRows = ptyDimensions?.rows || terminalHeight;

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollToBottom?.();
    }
  }, [ansiOutput, isRunning]);

  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.primary}
      flexDirection="column"
    >
      {/* Mode indicator header */}
      {isInMode && (
        <box
          width={width}
          height={1}
          justifyContent="center"
          backgroundColor={modeColor}
        >
          <text fg="white">
            ══ {mode.toUpperCase()} MODE ══
          </text>
        </box>
      )}

      <box
        width={width}
        height={terminalHeight}
      >
        {!ansiOutput ? (
          <box padding={2}>
            <text fg={OneDarkPro.foreground.muted}>
              No output yet. Waiting for execution...
            </text>
          </box>
        ) : (
          <ghostty-terminal
            ansi={ansiOutput}
            cols={terminalCols}
            rows={terminalRows}
          />
        )}
      </box>
    </box>
  );
}
