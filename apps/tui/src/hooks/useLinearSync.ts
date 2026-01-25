/**
 * useLinearSync Hook
 * Real-time sync of Linear issue statuses when a build session is active
 * Polls Linear for sub-issue status changes and updates the task list
 *
 * Features:
 * - 3-second base polling interval
 * - Intelligent backoff when no changes detected (up to 10s)
 * - Resets to fast polling when changes detected
 * - Forces cache update on initial sync
 * - Watches for .linear-updated signal from PostToolUse hook for instant refresh
 */

import { useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Effect, Runtime } from 'effect';
import { LinearService, makeLinearServiceLive, type LinearIssue } from '@clive/claude-services';
import { taskQueryKeys, useConfig } from './useTaskQueries';
import { debugLog } from '../utils/debug-logger';
import * as fs from 'node:fs';

// Polling configuration - aggressive polling for real-time updates
const BASE_INTERVAL_MS = 3000;    // Start at 3 seconds
const MAX_INTERVAL_MS = 10000;    // Max 10 seconds when idle
const BACKOFF_MULTIPLIER = 1.25;  // Increase by 25% on each no-change poll

// Signal file from PostToolUse hook
const LINEAR_UPDATED_SIGNAL = '.claude/.linear-updated';

interface UseLinearSyncOptions {
  /** The parent issue ID (epic) to sync sub-issues for */
  parentIssueId: string | null;
  /** Whether to enable polling (typically when PTY is running) */
  enabled: boolean;
}

/**
 * Generate a simple hash of task states for change detection
 */
function hashTaskStates(tasks: LinearIssue[]): string {
  return tasks
    .map(t => `${t.id}:${t.state?.type}`)
    .sort()
    .join('|');
}

/**
 * Hook to sync Linear sub-issue statuses in real-time
 * When enabled, polls Linear with intelligent backoff
 */
export function useLinearSync({ parentIssueId, enabled }: UseLinearSyncOptions) {
  const queryClient = useQueryClient();
  const { data: config } = useConfig();

  // Track state for intelligent backoff
  const lastHashRef = useRef<string>('');
  const currentIntervalRef = useRef<number>(BASE_INTERVAL_MS);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isFirstSyncRef = useRef<boolean>(true);

  const syncTasks = useCallback(async (): Promise<boolean> => {
    if (!config?.linear || !parentIssueId) return false;

    debugLog('useLinearSync', 'Polling Linear for task updates', {
      parentIssueId,
      currentInterval: currentIntervalRef.current,
    });

    try {
      const layer = makeLinearServiceLive(config.linear);

      const program = Effect.gen(function* () {
        const linearService = yield* LinearService;
        return yield* linearService.getSubIssues(parentIssueId);
      });

      const subIssues = await Runtime.runPromise(Runtime.defaultRuntime)(
        Effect.provide(program, layer)
      );

      // Check if anything changed
      const newHash = hashTaskStates(subIssues);
      const isFirstSync = isFirstSyncRef.current;
      const hasChanges = newHash !== lastHashRef.current || isFirstSync;
      lastHashRef.current = newHash;
      isFirstSyncRef.current = false;

      if (hasChanges) {
        debugLog('useLinearSync', isFirstSync ? 'Initial sync - forcing cache update' : 'Changes detected');
        debugLog('useLinearSync', 'Changes detected, updating cache', {
          count: subIssues.length,
          statuses: subIssues.map((i: LinearIssue) => ({
            id: i.identifier,
            state: i.state?.name,
            stateType: i.state?.type,
          })),
        });

        // Update the query cache directly with fresh data
        queryClient.setQueryData(
          taskQueryKeys.sessionTasks(parentIssueId),
          subIssues
        );

        // Also invalidate to force subscribers to re-render
        // This ensures components using useSessionTasks pick up the changes
        queryClient.invalidateQueries({
          queryKey: taskQueryKeys.sessionTasks(parentIssueId),
          refetchType: 'none', // Don't refetch, just mark as stale
        });
      } else {
        debugLog('useLinearSync', 'No changes detected');
      }

      return hasChanges;
    } catch (error) {
      debugLog('useLinearSync', 'Error polling Linear', { error: String(error) });
      return false;
    }
  }, [config, parentIssueId, queryClient]);

  // Schedule next poll with intelligent backoff
  const scheduleNextPoll = useCallback((hasChanges: boolean) => {
    if (!enabled) return;

    // Adjust interval based on whether changes were detected
    if (hasChanges) {
      // Reset to base interval when changes detected
      currentIntervalRef.current = BASE_INTERVAL_MS;
    } else {
      // Backoff when no changes (up to max)
      currentIntervalRef.current = Math.min(
        currentIntervalRef.current * BACKOFF_MULTIPLIER,
        MAX_INTERVAL_MS
      );
    }

    debugLog('useLinearSync', 'Scheduling next poll', {
      nextInterval: currentIntervalRef.current,
      hasChanges,
    });

    // Schedule next poll
    timeoutRef.current = setTimeout(async () => {
      const changed = await syncTasks();
      scheduleNextPoll(changed);
    }, currentIntervalRef.current);
  }, [enabled, syncTasks]);

  // Set up polling when enabled
  useEffect(() => {
    if (!enabled || !parentIssueId || !config?.linear) {
      // Cleanup on disable
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Reset state
      lastHashRef.current = '';
      currentIntervalRef.current = BASE_INTERVAL_MS;
      isFirstSyncRef.current = true;
      return;
    }

    debugLog('useLinearSync', 'Starting Linear sync polling', {
      parentIssueId,
      baseInterval: BASE_INTERVAL_MS,
      maxInterval: MAX_INTERVAL_MS,
    });

    // Initial sync (immediate)
    syncTasks().then(hasChanges => {
      scheduleNextPoll(hasChanges);
    });

    return () => {
      debugLog('useLinearSync', 'Stopping Linear sync polling');
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [enabled, parentIssueId, config?.linear, syncTasks, scheduleNextPoll]);

  // Watch for signal file from PostToolUse hook
  // When Claude updates a Linear issue, the hook writes this file
  // We detect it and trigger an immediate sync
  useEffect(() => {
    if (!enabled || !parentIssueId) return;

    const signalPath = LINEAR_UPDATED_SIGNAL;
    let signalWatcher: fs.FSWatcher | null = null;
    let signalCheckInterval: NodeJS.Timeout | null = null;

    const handleSignal = () => {
      if (fs.existsSync(signalPath)) {
        try {
          // Read and delete the signal file
          const content = fs.readFileSync(signalPath, 'utf-8');
          fs.unlinkSync(signalPath);

          const signal = JSON.parse(content);
          debugLog('useLinearSync', 'Received linear-updated signal', signal);

          // Trigger immediate sync
          currentIntervalRef.current = BASE_INTERVAL_MS;
          syncTasks().then(hasChanges => {
            // Reschedule with reset interval
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
            }
            scheduleNextPoll(hasChanges);
          });
        } catch (error) {
          debugLog('useLinearSync', 'Error processing signal file', { error: String(error) });
        }
      }
    };

    // Try fs.watch first
    try {
      const dir = '.claude';
      if (fs.existsSync(dir)) {
        signalWatcher = fs.watch(dir, (eventType, filename) => {
          if (filename === '.linear-updated') {
            handleSignal();
          }
        });
        signalWatcher.on('error', () => {
          signalWatcher?.close();
          signalWatcher = null;
        });
      }
    } catch {}

    // Polling fallback (200ms for responsiveness)
    signalCheckInterval = setInterval(handleSignal, 200);

    return () => {
      signalWatcher?.close();
      if (signalCheckInterval) {
        clearInterval(signalCheckInterval);
      }
    };
  }, [enabled, parentIssueId, syncTasks, scheduleNextPoll]);

  return {
    /** Manually trigger a sync (resets backoff) */
    syncNow: useCallback(async () => {
      currentIntervalRef.current = BASE_INTERVAL_MS;
      const hasChanges = await syncTasks();
      // Reschedule with new interval
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      scheduleNextPoll(hasChanges);
    }, [syncTasks, scheduleNextPoll]),

    /** Current polling interval in ms */
    currentInterval: currentIntervalRef.current,
  };
}
