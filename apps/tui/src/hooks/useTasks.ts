/**
 * React Query hook for fetching and polling tasks
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Session, Task } from "../types.js";
import {
  clearBeadsCache,
  getEpicTasks,
  isBeadsAvailable,
} from "../utils/beads.js";

// Status priority for sorting (lower = first)
// Order: in_progress -> pending/blocked -> complete
const STATUS_ORDER: Record<Task["status"], number> = {
  in_progress: 0,
  pending: 1,
  blocked: 2,
  skipped: 3,
  complete: 4,
};

// Sort tasks by status (in_progress first, complete last), then by tier
function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    // Sort by status first (in_progress first, complete last)
    const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }

    // Then sort by tier (undefined tiers go last)
    const tierA = a.tier ?? 999;
    const tierB = b.tier ?? 999;
    return tierA - tierB;
  });
}

// Poll interval when build is running (5 seconds)
const POLL_INTERVAL_MS = 5000;

interface TasksData {
  tasks: Task[];
  epicName: string | undefined;
  skill: string | undefined;
  category: string | undefined;
}

/**
 * Fetch tasks from beads for a given session
 */
function fetchTasksForSession(session: Session | null): TasksData {
  if (!session) {
    return {
      tasks: [],
      epicName: undefined,
      skill: undefined,
      category: undefined,
    };
  }

  // Beads-only - no fallback to plan files
  if (!isBeadsAvailable()) {
    return {
      tasks: [],
      epicName: session.name,
      skill: undefined,
      category: undefined,
    };
  }

  // Clear cache to get fresh data
  clearBeadsCache();

  // Get tasks from beads for this epic
  const epicTasks = getEpicTasks(session.epicId);
  const sortedTasks = sortTasks(epicTasks);

  // Extract metadata from tasks
  const skills = [...new Set(epicTasks.map((t) => t.skill).filter(Boolean))];
  const categories = [
    ...new Set(epicTasks.map((t) => t.category).filter(Boolean)),
  ];

  return {
    tasks: sortedTasks,
    epicName: session.name,
    skill: skills[0],
    category: categories[0],
  };
}

// Query key factory for tasks
export const tasksQueryKeys = {
  all: ["tasks"] as const,
  bySession: (sessionId: string | null) =>
    [...tasksQueryKeys.all, sessionId] as const,
};

/**
 * React Query hook for fetching tasks with automatic polling
 *
 * @param session - Current active session
 * @param isRunning - Whether build is running (enables polling)
 *
 * @example
 * ```tsx
 * const { tasks, epicName, skill, refresh, isFetching } = useTasks(
 *   activeSession,
 *   isRunning
 * );
 * ```
 */
export function useTasks(session: Session | null, isRunning: boolean = false) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: tasksQueryKeys.bySession(session?.id ?? null),
    queryFn: () => fetchTasksForSession(session),
    // Poll every 5 seconds when build is running
    refetchInterval: isRunning ? POLL_INTERVAL_MS : false,
    // Keep previous data while refetching to avoid flicker
    placeholderData: (previousData) => previousData,
    // Terminal doesn't have window focus events
    refetchOnWindowFocus: false,
    // Cache for 5 seconds
    staleTime: POLL_INTERVAL_MS,
    // Always enabled when we have a session
    enabled: session !== null,
  });

  // Manual refresh function that clears cache and refetches
  const refresh = useCallback(() => {
    clearBeadsCache();
    queryClient.invalidateQueries({
      queryKey: tasksQueryKeys.bySession(session?.id ?? null),
    });
  }, [queryClient, session?.id]);

  return {
    tasks: query.data?.tasks ?? [],
    epicName: query.data?.epicName,
    skill: query.data?.skill,
    category: query.data?.category,
    refresh,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
  };
}
