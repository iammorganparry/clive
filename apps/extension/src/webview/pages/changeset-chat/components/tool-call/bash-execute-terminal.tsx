import { useMemo } from "react";

import { TerminalCard, type TerminalStatus } from "../terminal-output.js";
import { useToolAbort, useToolApproval } from "./hooks.js";
import type { BashExecuteOutput, BashExecuteTerminalProps } from "./types.js";
import { isBashExecuteArgs } from "./types.js";
import { detectCancellation } from "./utils.js";

/**
 * BashExecuteTerminal - Displays terminal output for bash commands
 * with approval, rejection, and cancellation support
 */
export const BashExecuteTerminal: React.FC<BashExecuteTerminalProps> = ({
  input,
  output,
  state,
  toolCallId,
  subscriptionId,
}) => {
  const { handleApprove, handleReject, canApprove } = useToolApproval(toolCallId, subscriptionId);
  const { handleCancel, canAbort, isAborting } = useToolAbort(toolCallId, subscriptionId);

  const command = isBashExecuteArgs(input)
    ? input.command
    : output && typeof output === "object"
      ? (output as BashExecuteOutput).command || ""
      : "";

  const stdout =
    output && typeof output === "object"
      ? (output as BashExecuteOutput).stdout
      : undefined;

  const stderr =
    output && typeof output === "object"
      ? (output as BashExecuteOutput).stderr
      : undefined;

  const exitCode =
    output && typeof output === "object"
      ? (output as BashExecuteOutput).exitCode
      : undefined;

  const isCancelled = detectCancellation(output, stderr);

  // Map ToolState to TerminalStatus
  const terminalStatus = useMemo<TerminalStatus>(() => {
    if (state === "approval-requested") return "pending";
    if (state === "input-streaming" || state === "input-available") return "running";
    if (state === "output-cancelled" || isCancelled) return "cancelled";
    if (state === "output-error") return "error";
    if (state === "output-available") {
      return exitCode === 0 ? "completed" : "error";
    }
    return "running";
  }, [state, isCancelled, exitCode]);

  // Combine stdout and stderr into output, with cancellation message if applicable
  const terminalOutput = useMemo(() => {
    const baseOutput = [stdout, stderr].filter(Boolean).join("\n");
    if (isCancelled) {
      return baseOutput
        ? `${baseOutput}\n\n[Command cancelled by user]`
        : "[Command cancelled by user]";
    }
    return baseOutput;
  }, [stdout, stderr, isCancelled]);

  return (
    <TerminalCard
      command={command}
      output={terminalOutput || undefined}
      status={terminalStatus}
      onApprove={canApprove ? handleApprove : undefined}
      onReject={canApprove ? handleReject : undefined}
      onCancel={canAbort ? handleCancel : undefined}
      isCancelling={isAborting}
    />
  );
};

export default BashExecuteTerminal;
