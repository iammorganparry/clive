/**
 * React Query hooks for task management
 * Wraps TaskService with @tanstack/react-query
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Effect, Runtime } from 'effect';
import { createTaskService } from '../services/TaskService';
import { Config, Session, Task } from '../types';

// Query keys
export const taskQueryKeys = {
  all: ['tasks'] as const,
  sessions: () => [...taskQueryKeys.all, 'sessions'] as const,
  sessionTasks: (sessionId: string) =>
    [...taskQueryKeys.all, 'session', sessionId] as const,
  readyTasks: () => [...taskQueryKeys.all, 'ready'] as const,
  config: () => ['config'] as const,
};

/**
 * Hook to load config from ~/.clive/config.json
 */
export function useConfig() {
  return useQuery({
    queryKey: taskQueryKeys.config(),
    queryFn: async (): Promise<Config> => {
      // Load config from file system
      const fs = await import('fs/promises');
      const os = await import('os');
      const path = await import('path');

      const configPath = path.join(os.homedir(), '.clive', 'config.json');

      try {
        const content = await fs.readFile(configPath, 'utf-8');
        return JSON.parse(content);
      } catch (error) {
        // Return default config if file doesn't exist
        return {
          issueTracker: undefined,
          linear: undefined,
        };
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to load all sessions (epics)
 */
export function useSessions() {
  const { data: config } = useConfig();

  return useQuery({
    queryKey: taskQueryKeys.sessions(),
    queryFn: async (): Promise<Session[]> => {
      if (!config) return [];

      const taskService = createTaskService(config);
      const runtime = Runtime.defaultRuntime;

      return await Runtime.runPromise(runtime)(taskService.loadSessions);
    },
    enabled: !!config,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Hook to load tasks for a specific session
 */
export function useSessionTasks(sessionId: string | null) {
  const { data: config } = useConfig();

  return useQuery({
    queryKey: taskQueryKeys.sessionTasks(sessionId ?? ''),
    queryFn: async (): Promise<Task[]> => {
      if (!config || !sessionId) return [];

      const taskService = createTaskService(config);
      const runtime = Runtime.defaultRuntime;

      return await Runtime.runPromise(runtime)(
        taskService.loadTasks(sessionId)
      );
    },
    enabled: !!config && !!sessionId,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

/**
 * Hook to load ready tasks (no blockers)
 */
export function useReadyTasks() {
  const { data: config } = useConfig();

  return useQuery({
    queryKey: taskQueryKeys.readyTasks(),
    queryFn: async (): Promise<Task[]> => {
      if (!config) return [];

      const taskService = createTaskService(config);
      const runtime = Runtime.defaultRuntime;

      return await Runtime.runPromise(runtime)(taskService.loadReadyTasks);
    },
    enabled: !!config,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

/**
 * Mutation to update task status
 */
export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();
  const { data: config } = useConfig();

  return useMutation({
    mutationFn: async ({
      taskId,
      status,
    }: {
      taskId: string;
      status: 'open' | 'in_progress' | 'completed' | 'blocked';
    }) => {
      if (!config) throw new Error('Config not loaded');

      const taskService = createTaskService(config);
      const runtime = Runtime.defaultRuntime;

      await Runtime.runPromise(runtime)(
        taskService.updateTaskStatus(taskId, status)
      );
    },
    onSuccess: () => {
      // Invalidate all task queries to refetch
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.all });
    },
  });
}

/**
 * Mutation to create a new task
 */
export function useCreateTask() {
  const queryClient = useQueryClient();
  const { data: config } = useConfig();

  return useMutation({
    mutationFn: async ({
      sessionId,
      title,
      type,
    }: {
      sessionId: string;
      title: string;
      type: 'task' | 'bug' | 'feature';
    }): Promise<Task> => {
      if (!config) throw new Error('Config not loaded');

      const taskService = createTaskService(config);
      const runtime = Runtime.defaultRuntime;

      return await Runtime.runPromise(runtime)(
        taskService.createTask(sessionId, title, type)
      );
    },
    onSuccess: (_, variables) => {
      // Invalidate session tasks to show new task
      queryClient.invalidateQueries({
        queryKey: taskQueryKeys.sessionTasks(variables.sessionId),
      });
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.readyTasks() });
    },
  });
}

/**
 * Helper hook to check if beads is being used
 */
export function useIsBeads() {
  const { data: config } = useConfig();
  return config?.issueTracker === undefined || config?.issueTracker === 'linear'
    ? false
    : true;
}

/**
 * Helper hook to check if Linear is being used
 */
export function useIsLinear() {
  const { data: config } = useConfig();
  return config?.issueTracker === 'linear' && !!config.linear;
}
