/**
 * useWorktreeList Hook
 * React Query wrapper for WorktreeService.listWorktrees()
 * Polls every 10 seconds to detect new/removed worktrees.
 */

import { useQuery } from "@tanstack/react-query";
import {
  type WorktreeInfo,
  WorktreeService,
} from "../services/WorktreeService";

export const worktreeQueryKeys = {
  all: ["worktrees"] as const,
  list: (root: string) => ["worktrees", "list", root] as const,
};

export function useWorktreeList(mainWorkspaceRoot: string) {
  return useQuery<WorktreeInfo[]>({
    queryKey: worktreeQueryKeys.list(mainWorkspaceRoot),
    queryFn: () => WorktreeService.listWorktrees(mainWorkspaceRoot),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}
