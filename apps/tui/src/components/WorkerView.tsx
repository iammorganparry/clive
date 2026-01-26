/**
 * WorkerView Component
 * Displays worker status and incoming Slack sessions
 * Simplified view focused on monitoring worker activity
 */

import type { WorkerStatus } from "@clive/worker-protocol";
import { useEffect, useRef } from "react";
import { OneDarkPro } from "../styles/theme";
import type { OutputLine } from "../types";
import { OutputPanel, type OutputPanelRef } from "./OutputPanel";

interface WorkerViewProps {
  width: number;
  height: number;
  /** Worker connection status */
  workerStatus: WorkerStatus;
  /** Unique worker ID */
  workerId: string | null;
  /** Active Slack session IDs */
  activeSessions: string[];
  /** Connection error message */
  error: string | null;
  /** Output lines from CLI execution (for active session) */
  outputLines: OutputLine[];
  /** Whether CLI is currently running (for active session) */
  isRunning: boolean;
  /** Workspace root path */
  workspaceRoot: string;
  /** Called when user wants to exit worker mode */
  onExit: () => void;
  /** Called to reconnect */
  onReconnect: () => void;
  /** Currently active session ID */
  activeSessionId: string | null;
  /** Output lines per session */
  sessionOutputs: Map<string, OutputLine[]>;
  /** Running state per session */
  sessionRunningStates: Map<string, boolean>;
  /** Called to cycle to next session */
  onNextSession: () => void;
  /** Called to cycle to previous session */
  onPrevSession: () => void;
  /** Called to select a specific session */
  onSelectSession: (sessionId: string) => void;
}

export function WorkerView({
  width,
  height,
  workerStatus,
  workerId,
  activeSessions,
  error,
  outputLines,
  isRunning,
  workspaceRoot,
  onExit,
  onReconnect,
  activeSessionId,
  sessionOutputs,
  sessionRunningStates,
  onNextSession,
  onPrevSession,
  onSelectSession,
}: WorkerViewProps) {
  const outputPanelRef = useRef<OutputPanelRef>(null);

  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    if (outputPanelRef.current && outputLines.length > 0) {
      const timer = setTimeout(() => {
        outputPanelRef.current?.scrollToBottom();
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [outputLines.length]);

  // Get status display
  const getStatusDisplay = () => {
    const sessionCount = activeSessions.length;
    switch (workerStatus) {
      case "ready":
        return {
          text: "Connected - Waiting for requests",
          color: OneDarkPro.syntax.green,
          icon: "O",
        };
      case "busy":
        return {
          text:
            "Processing " +
            sessionCount +
            " session" +
            (sessionCount > 1 ? "s" : ""),
          color: OneDarkPro.syntax.yellow,
          icon: "*",
        };
      case "connecting":
        return {
          text: "Connecting...",
          color: OneDarkPro.syntax.yellow,
          icon: "o",
        };
      case "disconnected":
        return {
          text: "Disconnected",
          color: OneDarkPro.syntax.red,
          icon: "x",
        };
      default:
        return {
          text: "Unknown",
          color: OneDarkPro.foreground.muted,
          icon: "?",
        };
    }
  };

  const status = getStatusDisplay();
  const headerHeight = 5;
  const footerHeight = 3;
  const hasMultipleSessions = activeSessions.length > 1;
  const sessionTabHeight = hasMultipleSessions ? 2 : 0;
  const outputHeight = height - headerHeight - footerHeight - sessionTabHeight;

  // Get current session index for display
  const currentSessionIndex = activeSessionId
    ? activeSessions.indexOf(activeSessionId)
    : -1;

  // Get workspace name
  const workspaceName =
    workspaceRoot.split("/").filter(Boolean).pop() || "unknown";

  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.primary}
      flexDirection="column"
    >
      {/* Header */}
      <box
        width={width}
        height={headerHeight}
        backgroundColor={OneDarkPro.background.secondary}
        flexDirection="column"
        paddingLeft={2}
        paddingTop={1}
      >
        <box flexDirection="row" alignItems="center">
          <text fg={OneDarkPro.syntax.red} bold>
            CLIVE
          </text>
          <text fg={OneDarkPro.foreground.muted}>{" - Worker Mode"}</text>
          <text fg={OneDarkPro.foreground.muted}>{" - "}</text>
          <text fg={OneDarkPro.syntax.cyan}>{workspaceName}</text>
        </box>

        <box flexDirection="row" marginTop={1} alignItems="center">
          <text fg={status.color}>
            [{status.icon}] {status.text}
          </text>
          {workerId && (
            <>
              <text fg={OneDarkPro.foreground.muted}>{" - ID: "}</text>
              <text fg={OneDarkPro.foreground.secondary}>{workerId}</text>
            </>
          )}
        </box>

        {error && (
          <text fg={OneDarkPro.syntax.red} marginTop={1}>
            Error: {error}
          </text>
        )}
      </box>

      {/* Session Tab Bar (only show when multiple sessions) */}
      {hasMultipleSessions && (
        <box
          width={width}
          height={sessionTabHeight}
          backgroundColor={OneDarkPro.background.secondary}
          flexDirection="row"
          paddingLeft={2}
          alignItems="center"
        >
          <text fg={OneDarkPro.foreground.muted}>Sessions: </text>
          {activeSessions.map((sessionId, index) => {
            const isActive = sessionId === activeSessionId;
            const isRunning = sessionRunningStates.get(sessionId) ?? false;
            const shortId = sessionId.slice(0, 8);
            return (
              <box key={sessionId} flexDirection="row">
                <text
                  fg={isActive ? OneDarkPro.syntax.cyan : OneDarkPro.foreground.muted}
                  bold={isActive}
                  backgroundColor={isActive ? OneDarkPro.background.primary : undefined}
                >
                  {` ${index + 1}:${shortId}${isRunning ? '*' : ''} `}
                </text>
              </box>
            );
          })}
        </box>
      )}

      {/* Output Panel */}
      {activeSessions.length > 0 || outputLines.length > 0 ? (
        <OutputPanel
          ref={outputPanelRef}
          width={width}
          height={outputHeight}
          lines={outputLines}
          isRunning={isRunning}
          mode="none"
        />
      ) : (
        <box
          width={width}
          height={outputHeight}
          alignItems="center"
          justifyContent="center"
          flexDirection="column"
        >
          <text fg={OneDarkPro.foreground.muted}>
            Waiting for Slack requests...
          </text>
          <text fg={OneDarkPro.foreground.muted} marginTop={2}>
            Mention @clive in Slack to start a planning session
          </text>
          {workerStatus === "ready" && (
            <box
              marginTop={3}
              padding={1}
              backgroundColor={OneDarkPro.background.secondary}
            >
              <text fg={OneDarkPro.syntax.green}>
                Ready to receive requests
              </text>
            </box>
          )}
        </box>
      )}

      {/* Footer */}
      <box
        width={width}
        height={footerHeight}
        backgroundColor={OneDarkPro.background.secondary}
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        paddingLeft={2}
        paddingRight={2}
      >
        <box flexDirection="row">
          {hasMultipleSessions && activeSessionId && (
            <text fg={OneDarkPro.syntax.cyan}>
              Session {currentSessionIndex + 1}/{activeSessions.length} ({activeSessionId.slice(0, 8)})
            </text>
          )}
          {activeSessions.length === 1 && (
            <text fg={OneDarkPro.syntax.yellow}>
              Active: {activeSessions[0]?.slice(0, 8) ?? ''}
            </text>
          )}
        </box>

        <box flexDirection="row">
          {hasMultipleSessions && (
            <text fg={OneDarkPro.foreground.muted}>n/p Cycle | </text>
          )}
          {workerStatus === "disconnected" && (
            <text fg={OneDarkPro.foreground.muted}>r Reconnect | </text>
          )}
          <text fg={OneDarkPro.foreground.muted}>
            q Exit | Ctrl+C Quit
          </text>
        </box>
      </box>
    </box>
  );
}
