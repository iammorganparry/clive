/**
 * OutputPanel Component
 * Displays scrollable list of output lines
 * Ported from apps/tui-go/internal/tui/root.go renderOutputContent
 */

import { useEffect, useRef } from 'react';
import { OutputLine as OutputLineType } from '../types';
import { OutputLine } from './OutputLine';
import { LoadingIndicator } from './LoadingIndicator';
import { OneDarkPro } from '../styles/theme';

interface OutputPanelProps {
  width: number;
  height: number;
  lines: OutputLineType[];
  isRunning?: boolean;
  mode?: 'none' | 'plan' | 'build';
  modeColor?: string;
}

export function OutputPanel({ width, height, lines, isRunning = false, mode = 'none', modeColor }: OutputPanelProps) {
  const scrollRef = useRef<any>(null);
  const isInMode = mode !== 'none';
  const modeHeaderHeight = isInMode ? 1 : 0;
  const scrollboxHeight = height - modeHeaderHeight;

  // Auto-scroll to bottom when new lines are added or when loading state changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollToBottom?.();
    }
  }, [lines.length, isRunning]);

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
        ref={scrollRef}
        width={width}
        height={scrollboxHeight}
        overflow="auto"
      >
        {lines.length === 0 ? (
          <box padding={2}>
            <text fg={OneDarkPro.foreground.muted}>
              No output yet. Waiting for execution...
            </text>
          </box>
        ) : (
          <box flexDirection="column">
            {lines.map((line, i) => (
              <OutputLine key={i} line={line} />
            ))}
            {isRunning && <LoadingIndicator />}
          </box>
        )}
      </scrollbox>
    </box>
  );
}
