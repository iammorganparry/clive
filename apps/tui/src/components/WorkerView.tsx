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
  /** Output lines from CLI execution */
  outputLines: OutputLine[];
  /** Whether CLI is currently running */
  isRunning: boolean;
  /** Workspace root path */
  workspaceRoot: string;
  /** Called when user wants to exit worker mode */
  onExit: () => void;
  /** Called to reconnect */
  onReconnect: () => void;
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
  const outputHeight = height - headerHeight - footerHeight;

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
          {activeSessions.length > 0 && (
            <text fg={OneDarkPro.syntax.yellow}>
              Active: {activeSessions.join(", ")}
            </text>
          )}
        </box>

        <box flexDirection="row">
          {workerStatus === "disconnected" && (
            <text fg={OneDarkPro.foreground.muted}>r Reconnect |</text>
          )}
          <text fg={OneDarkPro.foreground.muted}>
            q Exit Worker Mode | Ctrl+C Quit
          </text>
        </box>
      </box>
    </box>
  );
}
