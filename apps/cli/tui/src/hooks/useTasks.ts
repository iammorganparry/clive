import { useState, useEffect, useCallback } from 'react';
import type { Session, Task } from '../types.js';
import { getAllTasks, isBeadsAvailable } from '../utils/beads.js';
import { parseTasksFromPlan, getPlanMetadata } from '../utils/planParser.js';

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

    // Try beads first, fall back to plan file
    if (isBeadsAvailable()) {
      const beadsTasks = getAllTasks();
      if (beadsTasks.length > 0) {
        setTasks(beadsTasks);
      } else {
        // Beads available but no tasks, try plan file
        setTasks(parseTasksFromPlan(session.planFile));
      }
    } else {
      setTasks(parseTasksFromPlan(session.planFile));
    }

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
