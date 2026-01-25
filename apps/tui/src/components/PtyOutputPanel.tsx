/**
 * PtyOutputPanel Component
 * Renders PTY output using ghostty-terminal for proper ANSI rendering
 * Responsive to terminal resize via ptyDimensions prop
 *
 * Smart scroll behavior:
 * - Auto-scrolls to bottom by default as new content arrives
 * - When user scrolls up, auto-scroll is disabled (stickyScroll controls this)
 * - Ctrl+G from parent re-enables auto-scroll
 *
 * References:
 * - https://github.com/remorses/ghostty-opentui
 * - https://github.com/sst/opentui
 */

import { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import { OneDarkPro } from '../styles/theme';
import type { CliveMode } from '../types/views';
import type { PtyDimensions } from '../services/PtyCliManager';

interface PtyOutputPanelProps {
  width: number;
  height: number;
  ansiBuffer: string;
  mode: CliveMode | null;
  ptyDimensions?: PtyDimensions | null;
}

export interface PtyOutputPanelRef {
  scrollToBottom: () => void;
}

export const PtyOutputPanel = forwardRef<PtyOutputPanelRef, PtyOutputPanelProps>(
  ({ width, height, ansiBuffer, mode, ptyDimensions }, ref) => {
    // Refs for scrollbox and ghostty-terminal (using any for JSX ref compatibility)
    const scrollBoxRef = useRef<any>(null);
    const terminalRef = useRef<any>(null);

    // Track whether auto-scroll is enabled (stickyScroll prop)
    const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

    // Track last buffer length for change detection
    const lastBufferLengthRef = useRef(0);

    // Track last known scroll position for change detection
    const lastScrollTopRef = useRef(0);

    // Polling interval for scroll position detection (ms)
    const SCROLL_POLL_INTERVAL = 50;

    // Mode indicator color
    const modeColor = mode === 'plan'
      ? OneDarkPro.syntax.blue
      : mode === 'build'
      ? OneDarkPro.syntax.yellow
      : undefined;

    // Calculate available height for output
    const headerHeight = mode ? 1 : 0;
    const outputHeight = Math.max(1, height - headerHeight);

    // Use PTY dimensions if available, otherwise use component dimensions
    const terminalCols = ptyDimensions?.cols || width;
    const terminalRows = ptyDimensions?.rows || outputHeight;

    // Scroll to bottom - uses OpenTUI ScrollBoxRenderable.scrollTo API
    const scrollToBottom = useCallback(() => {
      const scrollBox = scrollBoxRef.current;
      const terminal = terminalRef.current;

      if (!scrollBox) return;

      // If we have terminal ref, use getScrollPositionForLine for the last line
      if (terminal && typeof terminal.getScrollPositionForLine === 'function') {
        // Get scroll position for last line (large number to get bottom)
        const lastLinePos = terminal.getScrollPositionForLine(999999);
        scrollBox.scrollTo(lastLinePos);
      } else if (typeof scrollBox.scrollTo === 'function') {
        // Fallback: scroll to very large number
        scrollBox.scrollTo(999999);
      }
    }, []);

    // Auto-scroll to bottom when new output arrives (if enabled)
    useEffect(() => {
      const hasNewContent = ansiBuffer.length > lastBufferLengthRef.current;
      lastBufferLengthRef.current = ansiBuffer.length;

      if (hasNewContent && autoScrollEnabled) {
        // Small delay to let render complete
        setTimeout(() => {
          scrollToBottom();
        }, 16);
      }
    }, [ansiBuffer, autoScrollEnabled, scrollToBottom]);

    // Reset auto-scroll when buffer is cleared (new session)
    useEffect(() => {
      if (ansiBuffer.length === 0) {
        setAutoScrollEnabled(true);
        lastBufferLengthRef.current = 0;
      }
    }, [ansiBuffer.length]);

    // Expose scroll to bottom method to parent (for Ctrl+G shortcut)
    useImperativeHandle(ref, () => ({
      scrollToBottom: () => {
        setAutoScrollEnabled(true);
        scrollToBottom();
      }
    }));

    // Poll scroll position to detect when user scrolls away from bottom
    // OpenTUI's onScroll callback receives no parameters, so we must poll
    useEffect(() => {
      if (!scrollBoxRef.current) return;

      const checkScrollPosition = () => {
        const scrollBox = scrollBoxRef.current;
        if (!scrollBox) return;

        const scrollTop = scrollBox.scrollTop || 0;
        const scrollHeight = scrollBox.scrollHeight || 0;
        const viewportHeight = outputHeight;

        // Buffer zone - consider "at bottom" if within 3 lines
        const buffer = 3;
        const isAtBottom = scrollTop >= scrollHeight - viewportHeight - buffer;

        // Detect scroll position change
        if (scrollTop !== lastScrollTopRef.current) {
          lastScrollTopRef.current = scrollTop;

          if (!isAtBottom && autoScrollEnabled) {
            // User scrolled up - disable auto-scroll
            setAutoScrollEnabled(false);
          } else if (isAtBottom && !autoScrollEnabled) {
            // User scrolled back to bottom - re-enable auto-scroll
            setAutoScrollEnabled(true);
          }
        }
      };

      // Poll scroll position (OpenTUI doesn't emit reliable scroll events with position)
      const interval = setInterval(checkScrollPosition, SCROLL_POLL_INTERVAL);
      return () => clearInterval(interval);
    }, [outputHeight, autoScrollEnabled]);

    return (
      <box
        width={width}
        height={height}
        flexDirection="column"
        backgroundColor={OneDarkPro.background.primary}
      >
        {/* Mode header */}
        {mode && (
          <box
            width={width}
            height={1}
            backgroundColor={OneDarkPro.background.secondary}
            paddingLeft={1}
            paddingRight={1}
            flexDirection="row"
            justifyContent="space-between"
          >
            <box flexDirection="row">
              <text fg={modeColor} bold>
                {mode === 'plan' ? '📋 PLAN' : '🔨 BUILD'}
              </text>
              <text fg={OneDarkPro.foreground.muted}>
                {' '} Mode Active
              </text>
            </box>
            {/* Show indicator when auto-scroll is paused */}
            {!autoScrollEnabled && (
              <text fg={OneDarkPro.syntax.yellow}>
                ⏸ Paused - Ctrl+G to follow
              </text>
            )}
          </box>
        )}

        {/* PTY output - rendered through ghostty-terminal in scrollbox */}
        <scrollbox
          ref={scrollBoxRef}
          width={width}
          height={outputHeight}
          scrollY={true}
          stickyScroll={autoScrollEnabled}
          focused
          style={{ flexGrow: 1 }}
        >
          {!ansiBuffer ? (
            <box padding={2}>
              <text fg={OneDarkPro.foreground.muted}>
                Waiting for output...
              </text>
            </box>
          ) : (
            <ghostty-terminal
              ref={terminalRef}
              ansi={ansiBuffer}
              cols={terminalCols}
              rows={terminalRows}
            />
          )}
        </scrollbox>
      </box>
    );
  }
);
