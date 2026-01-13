import { useState, useRef, useCallback } from 'react';
import type { Session, Task } from '../types.js';
import { isBeadsAvailable, getEpicTasks } from '../utils/beads.js';

// Status priority for sorting (lower = first)
// Order: in_progress -> pending/blocked -> complete
const STATUS_ORDER: Record<Task['status'], number> = {
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

export function useTasks(session: Session | null) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [metadata, setMetadata] = useState<{
    epicName?: string;
    skill?: string;
    category?: string;
  }>({});

  const refresh = useCallback(() => {
    if (!session) {
      setTasks([]);
      setMetadata({});
      return;
    }

    // Beads-only - no fallback to plan files
    if (!isBeadsAvailable()) {
      setTasks([]);
      setMetadata({ epicName: session.name });
      return;
    }

    // Get tasks from beads for this epic
    const epicTasks = getEpicTasks(session.epicId);
    setTasks(sortTasks(epicTasks));

    // Extract metadata from tasks
    const skills = [...new Set(epicTasks.map(t => t.skill).filter(Boolean))];
    const categories = [...new Set(epicTasks.map(t => t.category).filter(Boolean))];

    setMetadata({
      epicName: session.name,
      skill: skills[0], // Primary skill
      category: categories[0],
    });
  }, [session]);

  // Track session changes for synchronous refresh (no polling, no useEffect)
  const lastSessionIdRef = useRef<string | null>(null);

  // Synchronous initial fetch + session change detection
  if (session?.id !== lastSessionIdRef.current) {
    lastSessionIdRef.current = session?.id ?? null;
    // Schedule refresh for next microtask to avoid state update during render
    queueMicrotask(() => refresh());
  }

  return {
    tasks,
    epicName: metadata.epicName,
    skill: metadata.skill,
    category: metadata.category,
    refresh,
  };
}
