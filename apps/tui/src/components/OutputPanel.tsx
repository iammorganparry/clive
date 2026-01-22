/**
 * OutputPanel Component
 * Displays terminal output using ghostty-terminal renderer
 * Renders ANSI output from PTY-based Claude CLI
 */

import { useEffect, useRef, forwardRef, useImperativeHandle, useState, useCallback } from 'react';
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

  const autoScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastScrollTopRef = useRef<number>(0);
  const [hasNewContent, setHasNewContent] = useState(false);

  // Use PTY dimensions if available (calculated based on available space), otherwise use full available space
  const terminalCols = ptyDimensions?.cols || width;
  const terminalRows = ptyDimensions?.rows || terminalHeight;

  // Check if currently at or near bottom (within 3 lines of bottom)
  const isAtBottom = useCallback(() => {
    if (!scrollBoxRef.current) return true; // Default to true if no ref yet
    const { scrollTop, scrollHeight, viewport } = scrollBoxRef.current;
    if (scrollHeight === undefined || scrollTop === undefined) return true;

    const viewportHeight = viewport?.height || terminalHeight;
    const threshold = 3; // 3 lines from bottom
    const atBottom = scrollTop + viewportHeight >= scrollHeight - threshold;

    // Update last known scroll position
    lastScrollTopRef.current = scrollTop;

    return atBottom;
  }, [terminalHeight]);

  // Auto-scroll to bottom when output changes (debounced, only if already at bottom)
  useEffect(() => {
    // Clear any pending auto-scroll
    if (autoScrollTimeoutRef.current) {
      clearTimeout(autoScrollTimeoutRef.current);
    }

    // Check if user is already at/near the bottom
    const shouldAutoScroll = isAtBottom();

    if (shouldAutoScroll && scrollBoxRef.current) {
      // User is at bottom - auto-scroll and clear new content indicator
      // Debounce: wait 50ms to batch rapid updates
      autoScrollTimeoutRef.current = setTimeout(() => {
        if (scrollBoxRef.current?.scrollHeight !== undefined) {
          scrollBoxRef.current.scrollTop = scrollBoxRef.current.scrollHeight;
          lastScrollTopRef.current = scrollBoxRef.current.scrollHeight;
        }
        setHasNewContent(false);
      }, 50);
    } else {
      // User has scrolled up - show new content indicator
      setHasNewContent(true);
    }

    return () => {
      if (autoScrollTimeoutRef.current) {
        clearTimeout(autoScrollTimeoutRef.current);
      }
    };
  }, [ansiOutput, isAtBottom]);

  // Expose scroll to bottom method to parent
  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      if (scrollBoxRef.current?.scrollHeight !== undefined) {
        scrollBoxRef.current.scrollTop = scrollBoxRef.current.scrollHeight;
        lastScrollTopRef.current = scrollBoxRef.current.scrollHeight;
        setHasNewContent(false); // Clear new content indicator
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

      <box width={width} height={terminalHeight} flexDirection="column">
        <scrollbox
          ref={scrollBoxRef}
          width={width}
          height={hasNewContent ? terminalHeight - 1 : terminalHeight}
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

        {/* New content indicator - shows at bottom when user scrolled up */}
        {hasNewContent && (
          <box
            width={width}
            height={1}
            justifyContent="center"
            backgroundColor="#3B82F6"
          >
            <text fg="white">
              ↓ New output available (Ctrl+B to scroll down)
            </text>
          </box>
        )}
      </box>
    </box>
  );
});
