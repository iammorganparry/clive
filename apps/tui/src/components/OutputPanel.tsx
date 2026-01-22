/**
 * OutputPanel Component
 * Displays terminal output using ghostty-terminal renderer
 * Renders ANSI output from PTY-based Claude CLI
 */

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
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

export interface OutputPanelRef {
  scrollToBottom: () => void;
}

export const OutputPanel = forwardRef<OutputPanelRef, OutputPanelProps>(
  ({ width, height, ansiOutput, isRunning = false, mode = 'none', modeColor, ptyDimensions }, ref) => {
  const scrollBoxRef = useRef<any>(null);
  const isInMode = mode !== 'none';
  const modeHeaderHeight = isInMode ? 1 : 0;
  const terminalHeight = height - modeHeaderHeight;

  // Use PTY dimensions if available (calculated based on available space), otherwise use full available space
  const terminalCols = ptyDimensions?.cols || width;
  const terminalRows = ptyDimensions?.rows || terminalHeight;

  // Auto-scroll to bottom when output changes
  // Use setImmediate to ensure scroll happens after render
  useEffect(() => {
    if (scrollBoxRef.current) {
      setImmediate(() => {
        if (scrollBoxRef.current?.scrollHeight !== undefined) {
          scrollBoxRef.current.scrollTop = scrollBoxRef.current.scrollHeight;
        }
      });
    }
  }, [ansiOutput]);

  // Expose scroll to bottom method to parent
  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      if (scrollBoxRef.current?.scrollHeight !== undefined) {
        scrollBoxRef.current.scrollTop = scrollBoxRef.current.scrollHeight;
      }
    }
  }));

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

      <scrollbox
        ref={scrollBoxRef}
        width={width}
        height={terminalHeight}
        scrollY={true}
        stickyScroll={false}
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
      </scrollbox>
    </box>
  );
});
