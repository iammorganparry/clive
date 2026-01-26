/**
 * React Query hooks for task management
 * Wraps TaskService with @tanstack/react-query
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Runtime } from "effect";
import { createTaskService } from "../services/TaskService";
import type { Config, Session, Task } from "../types";
import { loadConfig as loadConfigFromFile } from "../utils/config-loader";

// Query keys
export const taskQueryKeys = {
  all: ["tasks"] as const,
  sessions: () => [...taskQueryKeys.all, "sessions"] as const,
  sessionTasks: (sessionId: string) =>
    [...taskQueryKeys.all, "session", sessionId] as const,
  readyTasks: () => [...taskQueryKeys.all, "ready"] as const,
  config: () => ["config"] as const,
};

/**
 * Hook to load config using the unified config loader
 * Priority: workspace .clive/config.json -> global ~/.clive/config.json
 * API key priority: LINEAR_API_KEY env var > ~/.clive/.env > config file
 */
export function useConfig() {
  return useQuery({
    queryKey: taskQueryKeys.config(),
    queryFn: async (): Promise<Config> => {
      const fsSync = await import("node:fs");

      const logToFile = (msg: string) => {
        fsSync.appendFileSync(
          "/tmp/tui-debug.log",
          `${new Date().toISOString()} ${msg}\n`,
        );
      };

      // Use unified config loader
      const loadedConfig = loadConfigFromFile();

      if (!loadedConfig) {
        logToFile("[useConfig] No config found, returning defaults");
        return {
          issueTracker: undefined,
          linear: undefined,
        };
      }

      const config: Config = {
        issueTracker: loadedConfig.issueTracker ?? undefined,
        linear: loadedConfig.linear,
        beads: loadedConfig.beads,
      };

      logToFile(`[useConfig] Final config: ${JSON.stringify(config)}`);

      // Validate Linear config completeness
      if (config.issueTracker === "linear") {
        if (!config.linear) {
          const errorMsg =
            "Linear is selected but no Linear configuration found";
          logToFile(`[useConfig] Validation error: ${errorMsg}`);
          throw new Error(errorMsg);
        }
        if (!config.linear.apiKey) {
          const errorMsg =
            "Linear API key is missing. Please run Linear setup or set LINEAR_API_KEY env var.";
          logToFile(`[useConfig] Validation error: ${errorMsg}`);
          throw new Error(errorMsg);
        }
        if (!config.linear.teamID) {
          const errorMsg =
            "Linear team ID is missing. Please run Linear setup.";
          logToFile(`[useConfig] Validation error: ${errorMsg}`);
          throw new Error(errorMsg);
        }
      }

      return config;
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
      const fs = await import("node:fs");
      const logToFile = (msg: string) => {
        fs.appendFileSync(
          "/tmp/tui-debug.log",
          `${new Date().toISOString()} ${msg}\n`,
        );
      };

      logToFile(`[useSessions] Config: ${JSON.stringify(config)}`);

      if (!config) {
        logToFile("[useSessions] No config, returning empty array");
        return [];
      }

      logToFile(
        `[useSessions] Creating task service with config: ${JSON.stringify(config)}`,
      );

      try {
        const taskService = createTaskService(config);
        const runtime = Runtime.defaultRuntime;

        logToFile("[useSessions] Running loadSessions...");
        const sessions = await Runtime.runPromise(runtime)(
          taskService.loadSessions,
        );
        logToFile(`[useSessions] Sessions loaded: ${sessions.length} sessions`);
        logToFile(
          `[useSessions] Sessions data: ${JSON.stringify(sessions.map((s) => ({ id: s.id, name: s.name })))}`,
        );

        return sessions;
      } catch (error) {
        logToFile(`[useSessions] Error: ${error}`);
        throw error;
      }
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
    queryKey: taskQueryKeys.sessionTasks(sessionId ?? ""),
    queryFn: async (): Promise<Task[]> => {
      if (!config || !sessionId) return [];

      const taskService = createTaskService(config);
      const runtime = Runtime.defaultRuntime;

      return await Runtime.runPromise(runtime)(
        taskService.loadTasks(sessionId),
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
      status: "open" | "in_progress" | "completed" | "blocked";
    }) => {
      if (!config) throw new Error("Config not loaded");

      const taskService = createTaskService(config);
      const runtime = Runtime.defaultRuntime;

      await Runtime.runPromise(runtime)(
        taskService.updateTaskStatus(taskId, status),
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
      type: "task" | "bug" | "feature";
    }): Promise<Task> => {
      if (!config) throw new Error("Config not loaded");

      const taskService = createTaskService(config);
      const runtime = Runtime.defaultRuntime;

      return await Runtime.runPromise(runtime)(
        taskService.createTask(sessionId, title, type),
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
  return !(
    config?.issueTracker === undefined || config?.issueTracker === "linear"
  );
}

/**
 * Helper hook to check if Linear is being used
 */
export function useIsLinear() {
  const { data: config } = useConfig();
  return config?.issueTracker === "linear" && !!config.linear;
}
