import { useEffect, useMemo } from "react";
import { Routes } from "../router/routes.js";
import { useRouter } from "../router/router-context.js";
import { useRpc } from "../rpc/provider.js";
import { useComparisonMode } from "../contexts/comparison-mode-context.js";
import { useAuth } from "../contexts/auth-context.js";

/**
 * Hook that checks for conversation history and navigates to changeset-chat
 * if history exists for the current comparison mode's files.
 * Similar to the logic in RouterProvider but for mode changes.
 */
export function useNavigateToChatIfHistory() {
  const { route, navigate } = useRouter();
  const { mode } = useComparisonMode();
  const { isAuthenticated } = useAuth();
  const rpc = useRpc();

  // Query branch changes
  const { data: branchChanges } = rpc.status.branchChanges.useQuery({
    enabled: isAuthenticated && mode === "branch",
  });

  // Query uncommitted changes
  const { data: uncommittedChanges } =
    rpc.status.uncommittedChanges.useQuery({
      enabled: isAuthenticated && mode === "uncommitted",
    });

  // Get the appropriate files based on mode
  const currentFiles = useMemo(() => {
    if (mode === "branch") {
      return branchChanges?.files.map((f) => f.path) ?? [];
    }
    return uncommittedChanges?.files.map((f) => f.path) ?? [];
  }, [mode, branchChanges, uncommittedChanges]);

  // Check for conversation history
  const { data: conversationMap } =
    rpc.conversations.hasConversationsBatch.useQuery({
      input: { sourceFiles: currentFiles },
      enabled: currentFiles.length > 0 && route === Routes.dashboard,
    });

  // Check if any files have conversation history
  const hasHistory = useMemo(() => {
    if (!conversationMap || currentFiles.length === 0) return false;
    return currentFiles.some((filePath) => conversationMap[filePath]?.exists);
  }, [conversationMap, currentFiles]);

  // Get branch name for navigation
  const branchName = useMemo(() => {
    if (mode === "branch") {
      return branchChanges?.branchName ?? "";
    }
    return uncommittedChanges?.branchName ?? "";
  }, [mode, branchChanges, uncommittedChanges]);

  // Navigate to chat if history exists when mode changes
  useEffect(() => {
    if (
      currentFiles.length > 0 &&
      hasHistory &&
      branchName &&
      route === Routes.dashboard
    ) {
      const filesJson = JSON.stringify(currentFiles);
      navigate(Routes.changesetChat, {
        files: filesJson,
        branchName,
      });
    }
  }, [currentFiles, hasHistory, branchName, route, navigate]);
}

