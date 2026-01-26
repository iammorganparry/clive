/**
 * OutputPanel Component
 * Displays structured output using OutputLine components with virtualization
 * Renders parsed events from Claude CLI stream-json mode
 * Uses VirtualizedOutputList for efficient rendering of large outputs (10k+ lines)
 */

import { forwardRef, useImperativeHandle, useRef } from "react";
import { OneDarkPro } from "../styles/theme";
import type { OutputLine as OutputLineType } from "../types";
import { StreamingIndicator } from "./StreamingIndicator";
import { VirtualizedOutputList } from "./VirtualizedOutputList";

interface OutputPanelProps {
  width: number;
  height: number;
  lines: OutputLineType[];
  isRunning?: boolean;
  mode?: "none" | "plan" | "build";
  modeColor?: string;
  /** Enable auto-scroll to bottom when new content is added (default: true) */
  stickyScroll?: boolean;
}

export interface OutputPanelRef {
  scrollToBottom: () => void;
}

export const OutputPanel = forwardRef<OutputPanelRef, OutputPanelProps>(
  (
    { width, height, lines, isRunning = false, mode = "none", modeColor, stickyScroll = true },
    ref,
  ) => {
    const scrollBoxRef = useRef<any>(null);
    const isInMode = mode !== "none";
    const modeHeaderHeight = isInMode ? 1 : 0;
    const terminalHeight = height - modeHeaderHeight;

    // Expose scroll to bottom method to parent
    useImperativeHandle(ref, () => ({
      scrollToBottom: () => {
        if (scrollBoxRef.current?.scrollHeight !== undefined) {
          scrollBoxRef.current.scrollTop = scrollBoxRef.current.scrollHeight;
        }
      },
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
            <text fg="white">══ {mode.toUpperCase()} MODE ══</text>
          </box>
        )}

        <box width={width} height={terminalHeight} flexDirection="column">
          <scrollbox
            ref={scrollBoxRef}
            width={width}
            height={terminalHeight}
            scrollY={true}
            stickyScroll={stickyScroll}
          >
            {lines.length === 0 ? (
              <box padding={2}>
                <text fg={OneDarkPro.foreground.muted}>
                  No output yet. Waiting for execution...
                </text>
              </box>
            ) : (
              <box flexDirection="column" width={width}>
                <VirtualizedOutputList
                  lines={lines}
                  width={width}
                  height={terminalHeight}
                  scrollBoxRef={scrollBoxRef}
                />

                {/* Streaming indicator - shows when agent is actively responding */}
                {isRunning && <StreamingIndicator mode={mode} />}
              </box>
            )}
          </scrollbox>
        </box>
      </box>
    );
  },
);
