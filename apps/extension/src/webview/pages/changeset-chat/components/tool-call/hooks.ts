import { useCallback } from "react";
import { useRpc } from "../../../../rpc/provider.js";
import { getVSCodeAPI } from "../../../../services/vscode.js";

/**
 * Hook for tool call approval/rejection mutations
 */
export function useToolApproval(toolCallId?: string, subscriptionId?: string) {
  const rpc = useRpc();
  const approveToolCall = rpc.agents.approveToolCall.useMutation();

  const handleApprove = useCallback(() => {
    if (!toolCallId || !subscriptionId) return;

    approveToolCall.mutate({
      subscriptionId,
      toolCallId,
      approved: true,
    });
  }, [toolCallId, subscriptionId, approveToolCall]);

  const handleReject = useCallback(() => {
    if (!toolCallId || !subscriptionId) return;

    approveToolCall.mutate({
      subscriptionId,
      toolCallId,
      approved: false,
    });
  }, [toolCallId, subscriptionId, approveToolCall]);

  const canApprove = Boolean(toolCallId && subscriptionId);

  return {
    handleApprove,
    handleReject,
    canApprove,
    isApproving: approveToolCall.isPending,
  };
}

/**
 * Hook for aborting a running tool call
 */
export function useToolAbort(toolCallId?: string, subscriptionId?: string) {
  const rpc = useRpc();
  const abortToolCall = rpc.agents.abortToolCall.useMutation();

  const handleCancel = useCallback(() => {
    if (!toolCallId) {
      console.warn("[useToolAbort] Missing toolCallId - cannot cancel");
      return;
    }

    console.log("[useToolAbort] Calling abortToolCall.mutate", {
      toolCallId,
      subscriptionId,
    });
    abortToolCall.mutate({
      subscriptionId: subscriptionId ?? undefined,
      toolCallId,
    });
  }, [toolCallId, subscriptionId, abortToolCall]);

  const canAbort = Boolean(toolCallId);

  return {
    handleCancel,
    canAbort,
    isAborting: abortToolCall.isPending,
  };
}

/**
 * Hook for opening files in VS Code
 */
export function useOpenFile() {
  const handleOpenFile = useCallback((filePath: string) => {
    const vscode = getVSCodeAPI();
    vscode.postMessage({
      command: "open-file",
      filePath,
    });
  }, []);

  return { handleOpenFile };
}
