import { useState, useEffect, useCallback } from 'react';
import type { Session } from '../types.js';
import {
  isBeadsAvailable,
  getEpics,
  extractBranchFromTitle,
  formatEpicName,
  hasInProgressTasks,
} from '../utils/beads.js';
import { getCurrentIteration, isLockFilePresent } from '../utils/state.js';

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    // Beads is required - no fallback to plan files
    if (!isBeadsAvailable()) {
      setSessions([]);
      return;
    }

    const epics = getEpics();
    const iteration = getCurrentIteration();
    const buildRunning = isLockFilePresent();

    const newSessions: Session[] = epics.map(epic => ({
      id: epic.id,
      name: formatEpicName(epic.title),
      epicId: epic.id,
      branch: extractBranchFromTitle(epic.title),
      isActive: buildRunning && hasInProgressTasks(epic.id),
      iteration: buildRunning ? iteration?.current : undefined,
      maxIterations: buildRunning ? iteration?.max : undefined,
    }));

    setSessions(newSessions);

    // Auto-select first session if none selected
    if (!activeSessionId && newSessions.length > 0) {
      // Prefer the running session, otherwise the first one
      const running = newSessions.find(s => s.isActive);
      setActiveSessionId(running?.id || newSessions[0].id);
    }
  }, [activeSessionId]);

  useEffect(() => {
    refresh();

    // Poll for changes every 2 seconds
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, [refresh]);

  const activeSession = sessions.find(s => s.id === activeSessionId) || null;

  return {
    sessions,
    activeSession,
    activeSessionId,
    setActiveSessionId,
    refresh,
  };
}
