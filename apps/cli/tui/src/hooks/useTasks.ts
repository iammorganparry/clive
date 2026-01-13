import { useState, useEffect, useCallback } from 'react';
import type { Session, Task } from '../types.js';
import { getAllTasks, isBeadsAvailable } from '../utils/beads.js';
import { parseTasksFromPlan, getPlanMetadata } from '../utils/planParser.js';

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

    let rawTasks: Task[] = [];

    // Try beads first, fall back to plan file
    if (isBeadsAvailable()) {
      const beadsTasks = getAllTasks();
      if (beadsTasks.length > 0) {
        rawTasks = beadsTasks;
      } else {
        // Beads available but no tasks, try plan file
        rawTasks = parseTasksFromPlan(session.planFile);
      }
    } else {
      rawTasks = parseTasksFromPlan(session.planFile);
    }

    // Sort tasks by tier, then by status
    setTasks(sortTasks(rawTasks));

    // Get metadata from plan file
    const planMeta = getPlanMetadata(session.planFile);
    setMetadata({
      epicName: planMeta.branch || session.name,
      skill: planMeta.skill,
      category: planMeta.category,
    });
  }, [session]);

  useEffect(() => {
    refresh();

    // Poll for changes
    const interval = setInterval(refresh, 2000);
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
