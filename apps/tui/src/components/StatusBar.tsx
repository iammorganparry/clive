/**
 * StatusBar Component
 * Shows execution status, worker connection status, and helpful hints
 */

import type { WorkerStatus } from "@clive/worker-protocol";
import { OneDarkPro } from "../styles/theme";

interface StatusBarProps {
  width: number;
  height: number;
  isRunning: boolean;
  inputFocused?: boolean;
  workspaceRoot?: string;
  /** Current git branch name */
  branchName?: string;
  /** Current mode */
  mode?: "none" | "plan" | "build" | "review";
  /** Current focus zone */
  focusZone?: "sidebar" | "tabs" | "main";
  /** Worker connection status */
  workerStatus?: WorkerStatus;
  /** Number of active Slack sessions on this worker */
  workerSessions?: number;
  /** Whether we're in worker mode (unified layout) */
  workerMode?: boolean;
  /** Worker ID */
  workerId?: string | null;
  /** Active worker session IDs */
  activeSessions?: string[];
  /** Currently active session ID */
  activeSessionId?: string | null;
  /** Connection error message */
  workerError?: string | null;
  /** Active session's branch name (worker mode) */
  workerBranchName?: string | null;
  /** Active session's mode (worker mode) */
  workerSessionMode?: "none" | "plan" | "build" | "review";
  /** Focus zone in worker mode */
  workerFocusZone?: "sidebar" | "tabs" | "main";
}

export function StatusBar({
  width,
  height,
  isRunning,
  inputFocused = false,
  workspaceRoot,
  branchName,
  mode = "none",
  focusZone,
  workerStatus,
  workerSessions = 0,
  workerMode = false,
  workerId,
  activeSessions = [],
  activeSessionId,
  workerError,
  workerBranchName,
  workerSessionMode = "none",
  workerFocusZone,
}: StatusBarProps) {
  const statusText = isRunning ? "⏳ Executing..." : "✓ Ready";
  const statusColor = isRunning
    ? OneDarkPro.syntax.yellow
    : OneDarkPro.syntax.green;

  // Get directory name from workspace root (show last part of path)
  const workspaceName = workspaceRoot
    ? workspaceRoot.split("/").filter(Boolean).pop() || workspaceRoot
    : "unknown";

  // Worker mode status display (for unified layout)
  const getWorkerModeStatusDisplay = (): { text: string; color: string; icon: string } => {
    switch (workerStatus) {
      case "ready":
        return {
          text: "Ready",
          color: OneDarkPro.syntax.green,
          icon: "●",
        };
      case "busy":
        return {
          text: "Busy",
          color: OneDarkPro.syntax.yellow,
          icon: "●",
        };
      case "connecting":
        return {
          text: "Connecting",
          color: OneDarkPro.syntax.yellow,
          icon: "○",
        };
      case "disconnected":
        return {
          text: "Disconnected",
          color: OneDarkPro.syntax.red,
          icon: "×",
        };
      default:
        return {
          text: "Unknown",
          color: OneDarkPro.foreground.muted,
          icon: "?",
        };
    }
  };

  // Worker status display (for sidebar indicator)
  const getWorkerStatusDisplay = (): { text: string; color: string } | null => {
    if (!workerStatus || workerMode) return null; // Don't show sidebar indicator in worker mode

    switch (workerStatus) {
      case "ready":
        return {
          text:
            workerSessions > 0
              ? `W: ${workerSessions} session${workerSessions > 1 ? "s" : ""}`
              : "W: Connected",
          color: OneDarkPro.syntax.green,
        };
      case "busy":
        return {
          text: `W: ${workerSessions} session${workerSessions > 1 ? "s" : ""}`,
          color: OneDarkPro.syntax.yellow,
        };
      case "connecting":
        return { text: "W: Connecting...", color: OneDarkPro.syntax.yellow };
      case "disconnected":
        return { text: "W: Disconnected", color: OneDarkPro.syntax.red };
      default:
        return null;
    }
  };

  const workerDisplay = getWorkerStatusDisplay();
  const workerModeDisplay = workerMode ? getWorkerModeStatusDisplay() : null;

  // Calculate session info for worker mode
  const hasMultipleSessions = activeSessions.length > 1;
  const currentSessionIndex = activeSessionId
    ? activeSessions.indexOf(activeSessionId)
    : -1;

  // Mode color helper
  const getSessionModeColor = (m: string): string => {
    switch (m) {
      case "plan": return "#3B82F6"; // blue-500
      case "build": return "#F59E0B"; // amber-500
      case "review": return "#10B981"; // green-500
      default: return OneDarkPro.foreground.muted;
    }
  };

  // Focus zone display
  const getFocusZoneDisplay = (zone?: string): string => {
    switch (zone) {
      case "sidebar": return "[sidebar]";
      case "tabs": return "[tabs]";
      case "main": return "[main]";
      default: return "";
    }
  };

  // Context-sensitive help hints
  let helpHint = "";
  if (workerMode) {
    // Worker mode specific hints
    if (workerStatus === "disconnected") {
      helpHint = "r Reconnect  •  q Exit  •  Ctrl+C Quit";
    } else if (hasMultipleSessions) {
      helpHint = "Tab focus  •  n/p Cycle  •  1-9 Jump  •  q Exit";
    } else {
      helpHint = "Tab focus  •  q Exit  •  Ctrl+C Quit";
    }
  } else if (inputFocused) {
    helpHint = "Enter execute  •  Esc unfocus  •  ⇧Tab mode  •  Ctrl+C quit";
  } else if (isRunning) {
    helpHint = "Tab focus  •  ⇧Tab mode  •  Ctrl+C interrupt";
  } else {
    helpHint = "/ input  •  Tab focus  •  ⇧Tab mode  •  ? help";
  }

  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.secondary}
      paddingLeft={1}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
    >
      {/* Left: Status, workspace, and worker status */}
      <box flexDirection="row">
        {workerMode && workerModeDisplay ? (
          <>
            {/* Worker mode: Show connection status */}
            <text fg={workerModeDisplay.color}>
              [{workerModeDisplay.icon}] {workerModeDisplay.text}
            </text>
            {/* Show branch name if available */}
            {workerBranchName && (
              <>
                <text fg={OneDarkPro.foreground.muted}> • </text>
                <text fg={OneDarkPro.syntax.magenta}>{workerBranchName}</text>
              </>
            )}
            {/* Show session mode with color */}
            {workerSessionMode && workerSessionMode !== "none" && (
              <>
                <text fg={OneDarkPro.foreground.muted}> • </text>
                <text fg={getSessionModeColor(workerSessionMode)}>
                  {workerSessionMode.toUpperCase()}
                </text>
              </>
            )}
            {/* Show session info if we have sessions */}
            {activeSessions.length > 0 && (
              <>
                <text fg={OneDarkPro.foreground.muted}> • </text>
                <text fg={OneDarkPro.syntax.cyan}>
                  {hasMultipleSessions
                    ? `Sess ${currentSessionIndex + 1}/${activeSessions.length}`
                    : `Sess: ${activeSessionId?.slice(0, 8) || "none"}`}
                </text>
              </>
            )}
            {/* Show running indicator */}
            {isRunning && (
              <>
                <text fg={OneDarkPro.foreground.muted}> • </text>
                <text fg={OneDarkPro.syntax.yellow}>⏳ Running</text>
              </>
            )}
            {/* Show focus zone */}
            {workerFocusZone && (
              <>
                <text fg={OneDarkPro.foreground.muted}> • </text>
                <text fg={OneDarkPro.foreground.secondary}>
                  {getFocusZoneDisplay(workerFocusZone)}
                </text>
              </>
            )}
            {/* Show error if any */}
            {workerError && (
              <>
                <text fg={OneDarkPro.foreground.muted}> • </text>
                <text fg={OneDarkPro.syntax.red}>⚠ {workerError}</text>
              </>
            )}
          </>
        ) : (
          <>
            {/* Normal mode: Show execution status */}
            <text fg={statusColor}>{statusText}</text>
            {branchName && (
              <>
                <text fg={OneDarkPro.foreground.muted}> • </text>
                <text fg={OneDarkPro.syntax.magenta}>{branchName}</text>
              </>
            )}
            {!branchName && workspaceRoot && (
              <>
                <text fg={OneDarkPro.foreground.muted}> • </text>
                <text fg={OneDarkPro.syntax.cyan}>{workspaceName}</text>
              </>
            )}
            {workerDisplay && (
              <>
                <text fg={OneDarkPro.foreground.muted}> • </text>
                <text fg={workerDisplay.color}>[{workerDisplay.text}]</text>
              </>
            )}
          </>
        )}
      </box>

      {/* Right: Help hints */}
      <text fg={OneDarkPro.foreground.muted} paddingRight={1}>
        {helpHint}
      </text>
    </box>
  );
}
