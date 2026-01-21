/**
 * OutputPanel Component
 * Displays scrollable list of output lines
 * Ported from apps/tui-go/internal/tui/root.go renderOutputContent
 */

import { useEffect, useRef } from 'react';
import { OutputLine as OutputLineType } from '../types';
import { OutputLine } from './OutputLine';
import { OneDarkPro } from '../styles/theme';

interface OutputPanelProps {
  x: number;
  y?: number;
  width: number;
  height: number;
  lines: OutputLineType[];
}

export function OutputPanel({ x, y = 0, width, height, lines }: OutputPanelProps) {
  const scrollRef = useRef<any>(null);

  // Auto-scroll to bottom when new lines are added
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollToBottom?.();
    }
  }, [lines.length]);

  return (
    <box
      x={x}
      y={y}
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.primary}
      flexDirection="column"
    >
      <scrollbox
        ref={scrollRef}
        width={width}
        height={height}
        overflow="auto"
      >
        {lines.length === 0 ? (
          <box padding={2}>
            <text color={OneDarkPro.foreground.muted}>
              No output yet. Waiting for execution...
            </text>
          </box>
        ) : (
          <box flexDirection="column">
            {lines.map((line, i) => (
              <OutputLine key={i} line={line} />
            ))}
          </box>
        )}
      </scrollbox>
    </box>
  );
}
