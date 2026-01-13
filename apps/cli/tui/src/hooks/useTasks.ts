import { useState, useEffect, useCallback } from 'react';
import type { Session, Task } from '../types.js';
import { isBeadsAvailable, getEpicTasks } from '../utils/beads.js';

// Status priority for sorting (lower = first)
const STATUS_ORDER: Record<Task['status'], number> = {
  complete: 0,
  in_progress: 1,
  pending: 2,
  blocked: 3,
  skipped: 4,
};

// Sort tasks by tier (ascending), then by status (completed first)
function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    // Sort by tier first (undefined tiers go last)
    const tierA = a.tier ?? 999;
    const tierB = b.tier ?? 999;
    if (tierA !== tierB) {
      return tierA - tierB;
    }

    // Then sort by status (completed first)
    return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
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

  useEffect(() => {
    refresh();

    // Poll for changes every 5 seconds (reduced from 2s to prevent flicker)
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  return {
    tasks,
    epicName: metadata.epicName,
    skill: metadata.skill,
    category: metadata.category,
    refresh,
  };
}
