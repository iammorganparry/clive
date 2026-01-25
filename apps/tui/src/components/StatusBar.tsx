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
  /** Worker connection status */
  workerStatus?: WorkerStatus;
  /** Number of active Slack sessions on this worker */
  workerSessions?: number;
}

export function StatusBar({
  width,
  height,
  isRunning,
  inputFocused = false,
  workspaceRoot,
  workerStatus,
  workerSessions = 0,
}: StatusBarProps) {
  const statusText = isRunning ? "⏳ Executing..." : "✓ Ready";
  const statusColor = isRunning
    ? OneDarkPro.syntax.yellow
    : OneDarkPro.syntax.green;

  // Get directory name from workspace root (show last part of path)
  const workspaceName = workspaceRoot
    ? workspaceRoot.split("/").filter(Boolean).pop() || workspaceRoot
    : "unknown";

  // Worker status display
  const getWorkerStatusDisplay = (): { text: string; color: string } | null => {
    if (!workerStatus) return null;

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

  // Context-sensitive help hints
  let helpHint = "";
  if (inputFocused) {
    helpHint = "Enter execute  •  Tab complete  •  Esc unfocus  •  Ctrl+C quit";
  } else if (isRunning) {
    helpHint = "Ctrl+G scroll bottom  •  Ctrl+C quit";
  } else {
    helpHint = "/ input  •  ? help  •  Esc back  •  Ctrl+C quit";
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
        <text fg={statusColor}>{statusText}</text>
        {workspaceRoot && (
          <>
            <text fg={OneDarkPro.foreground.muted}> • </text>
            <text fg={OneDarkPro.syntax.cyan}>📁 {workspaceName}</text>
          </>
        )}
        {workerDisplay && (
          <>
            <text fg={OneDarkPro.foreground.muted}> • </text>
            <text fg={workerDisplay.color}>[{workerDisplay.text}]</text>
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
