/**
 * DirectOutputPanel Component
 *
 * Renders Claude Code output directly using native terminal capabilities.
 * Instead of re-rendering through ghostty-terminal, this component:
 * 1. Sets up a scroll region for Claude Code's output area
 * 2. Lets Claude Code write directly to that region via stdout
 * 3. Claude Code handles its own scrolling and layout natively
 *
 * This provides the best rendering fidelity and lets Claude Code
 * manage its own TUI layout and scrolling behavior.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { OneDarkPro } from "../styles/theme";
import type { CliveMode } from "../types/views";

interface DirectOutputPanelProps {
  /** X position (column) where this panel starts */
  x: number;
  /** Y position (row) where this panel starts */
  y: number;
  /** Width in columns */
  width: number;
  /** Height in rows */
  height: number;
  /** Current mode (plan/build) */
  mode: CliveMode | null;
  /** Whether PTY is actively running */
  isRunning: boolean;
}

export interface DirectOutputPanelRef {
  /** Get the scroll region boundaries for the PTY */
  getScrollRegion: () => {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
}

/**
 * ANSI escape sequences for terminal control
 */
const ANSI = {
  // Set scroll region (DECSTBM) - 1-indexed
  setScrollRegion: (top: number, bottom: number) => `\x1b[${top};${bottom}r`,
  // Reset scroll region to full screen
  resetScrollRegion: () => `\x1b[r`,
  // Move cursor to position (1-indexed)
  moveTo: (row: number, col: number) => `\x1b[${row};${col}H`,
  // Save cursor position
  saveCursor: () => `\x1b[s`,
  // Restore cursor position
  restoreCursor: () => `\x1b[u`,
  // Clear from cursor to end of line
  clearToEOL: () => `\x1b[K`,
  // Set origin mode (cursor confined to scroll region)
  setOriginMode: () => `\x1b[?6h`,
  // Reset origin mode
  resetOriginMode: () => `\x1b[?6l`,
};

export const DirectOutputPanel = forwardRef<
  DirectOutputPanelRef,
  DirectOutputPanelProps
>(({ x, y, width, height, mode, isRunning }, ref) => {
  const initializedRef = useRef(false);

  // Mode indicator color
  const modeColor =
    mode === "plan"
      ? OneDarkPro.syntax.blue
      : mode === "build"
        ? OneDarkPro.syntax.yellow
        : undefined;

  // Calculate scroll region (1-indexed for ANSI)
  const headerHeight = mode ? 1 : 0;
  const scrollTop = y + headerHeight + 1; // +1 for 1-indexed
  const scrollBottom = y + height;
  const scrollLeft = x + 1; // +1 for 1-indexed
  const scrollRight = x + width;

  // Set up scroll region when PTY starts running
  useEffect(() => {
    if (isRunning && !initializedRef.current) {
      initializedRef.current = true;

      // Set the scroll region for Claude Code's output
      // This confines scrolling to just the output area
      process.stdout.write(ANSI.saveCursor());
      process.stdout.write(ANSI.setScrollRegion(scrollTop, scrollBottom));
      process.stdout.write(ANSI.moveTo(scrollTop, scrollLeft));

      // Note: We can't truly confine horizontal position with standard ANSI,
      // but Claude Code respects the PTY dimensions we give it
    }

    return () => {
      if (initializedRef.current) {
        // Reset scroll region when component unmounts or PTY stops
        process.stdout.write(ANSI.resetScrollRegion());
        process.stdout.write(ANSI.restoreCursor());
        initializedRef.current = false;
      }
    };
  }, [isRunning, scrollTop, scrollBottom, scrollLeft]);

  // Reset scroll region when PTY stops
  useEffect(() => {
    if (!isRunning && initializedRef.current) {
      process.stdout.write(ANSI.resetScrollRegion());
      initializedRef.current = false;
    }
  }, [isRunning]);

  // Expose scroll region info to parent
  useImperativeHandle(ref, () => ({
    getScrollRegion: () => ({
      top: scrollTop,
      bottom: scrollBottom,
      left: scrollLeft,
      right: scrollRight,
    }),
  }));

  return (
    <box
      width={width}
      height={height}
      flexDirection="column"
      backgroundColor={OneDarkPro.background.primary}
    >
      {/* Mode header - rendered by blessed, above the scroll region */}
      {mode && (
        <box
          width={width}
          height={1}
          backgroundColor={OneDarkPro.background.secondary}
          paddingLeft={1}
          paddingRight={1}
          flexDirection="row"
        >
          <text fg={modeColor} bold>
            {mode === "plan" ? "📋 PLAN" : "🔨 BUILD"}
          </text>
          <text fg={OneDarkPro.foreground.muted}> Mode Active</text>
        </box>
      )}

      {/*
          Output area - this is where Claude Code renders directly.
          We don't render anything here - Claude writes to this region via stdout.
          The box just reserves the space in blessed's layout.
        */}
      <box
        width={width}
        height={height - headerHeight}
        backgroundColor={OneDarkPro.background.primary}
      >
        {!isRunning && (
          <box padding={2}>
            <text fg={OneDarkPro.foreground.muted}>Waiting for output...</text>
          </box>
        )}
        {/* When running, Claude Code renders directly here via PTY stdout */}
      </box>
    </box>
  );
});
