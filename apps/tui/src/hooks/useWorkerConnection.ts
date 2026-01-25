/**
 * useWorkerConnection Hook
 * Manages WebSocket connection to central Slack service as a worker.
 * Uses XState for state management and WorkerConnectionManager for WebSocket lifecycle.
 *
 * The WebSocket connection is managed OUTSIDE React's render cycle to prevent
 * infinite reconnection loops caused by useEffect dependency changes.
 */

import type {
  InterviewEvent,
  InterviewRequest,
  WorkerStatus,
} from "@clive/worker-protocol";
import { useMachine } from "@xstate/react";
import { useEffect, useRef } from "react";
import { assign, setup } from "xstate";
import { WorkerConnectionManager } from "../services/WorkerConnectionManager";
import type { WorkerConfig } from "../types/views";

// Re-export InterviewRequest for use in App.tsx
export type { InterviewRequest };

/**
 * Connection state for the worker
 */
export interface WorkerConnectionState {
  /** Current connection status */
  status: WorkerStatus;
  /** Unique worker ID (generated on connect) */
  workerId: string | null;
  /** Active Slack interview session IDs */
  activeSessions: string[];
  /** Error message if connection failed */
  error: string | null;
  /** Whether the worker is connected and registered */
  isConnected: boolean;
}

/**
 * Callbacks for handling worker messages
 */
export interface WorkerCallbacks {
  /** Called when an interview request is received */
  onInterviewRequest?: (request: InterviewRequest) => void;
  /** Called when an answer is received for a session */
  onAnswer?: (
    sessionId: string,
    toolUseId: string,
    answers: Record<string, string>,
  ) => void;
  /** Called when a message is received for a session */
  onMessage?: (sessionId: string, message: string) => void;
  /** Called when a session is cancelled */
  onCancel?: (sessionId: string) => void;
}

/**
 * Worker connection hook return type
 */
export interface UseWorkerConnectionResult extends WorkerConnectionState {
  /** Manually connect to the central service */
  connect: () => void;
  /** Disconnect from the central service */
  disconnect: () => void;
  /** Send an event to the central service */
  sendEvent: (event: InterviewEvent) => void;
  /** Mark a session as complete */
  completeSession: (sessionId: string) => void;
}

/**
 * XState machine for worker connection state
 * Mirrors the state from WorkerConnectionManager but provides React-friendly state updates
 */
const workerConnectionMachine = setup({
  types: {
    context: {} as {
      status: WorkerStatus;
      workerId: string | null;
      activeSessions: string[];
      error: string | null;
    },
    events: {} as
      | { type: "STATUS_CHANGE"; status: WorkerStatus }
      | { type: "ERROR"; error: string }
      | { type: "CLEAR_ERROR" }
      | { type: "SET_WORKER_ID"; workerId: string }
      | { type: "SESSION_ADDED"; sessionId: string }
      | { type: "SESSION_REMOVED"; sessionId: string },
  },
  actions: {
    updateStatus: assign({
      status: ({ event }) => {
        if (event.type !== "STATUS_CHANGE") return "disconnected";
        return event.status;
      },
    }),
    setError: assign({
      error: ({ event }) => {
        if (event.type !== "ERROR") return null;
        return event.error;
      },
    }),
    clearError: assign({
      error: null,
    }),
    setWorkerId: assign({
      workerId: ({ event }) => {
        if (event.type !== "SET_WORKER_ID") return null;
        return event.workerId;
      },
    }),
    addSession: assign({
      activeSessions: ({ context, event }) => {
        if (event.type !== "SESSION_ADDED") return context.activeSessions;
        return [...context.activeSessions, event.sessionId];
      },
    }),
    removeSession: assign({
      activeSessions: ({ context, event }) => {
        if (event.type !== "SESSION_REMOVED") return context.activeSessions;
        return context.activeSessions.filter((id) => id !== event.sessionId);
      },
    }),
  },
}).createMachine({
  id: "workerConnection",
  initial: "idle",
  context: {
    status: "disconnected",
    workerId: null,
    activeSessions: [],
    error: null,
  },
  states: {
    idle: {
      on: {
        STATUS_CHANGE: { actions: "updateStatus" },
        ERROR: { actions: "setError" },
        CLEAR_ERROR: { actions: "clearError" },
        SET_WORKER_ID: { actions: "setWorkerId" },
        SESSION_ADDED: { actions: "addSession" },
        SESSION_REMOVED: { actions: "removeSession" },
      },
    },
  },
});

/**
 * Hook for managing worker connection to central Slack service
 *
 * The connection is managed outside React via WorkerConnectionManager.
 * This hook just syncs state and provides actions.
 */
export function useWorkerConnection(
  config: WorkerConfig | undefined,
  workspaceRoot: string,
  callbacks?: WorkerCallbacks,
): UseWorkerConnectionResult {
  // XState machine for React state
  const [state, send] = useMachine(workerConnectionMachine);

  // Manager instance - created ONCE outside React render cycle
  const managerRef = useRef<WorkerConnectionManager | null>(null);

  // Store callbacks in ref to avoid re-subscriptions
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Track if we've initialized to prevent double-init in StrictMode
  const initializedRef = useRef(false);

  // Initialize manager ONCE on mount
  useEffect(() => {
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;

    // Create manager
    const manager = new WorkerConnectionManager(workspaceRoot);
    managerRef.current = manager;

    // Set up event listeners (these sync manager state to React state)
    manager.on("status", (status: WorkerStatus) => {
      send({ type: "STATUS_CHANGE", status });
      if (status === "ready" || status === "busy") {
        send({ type: "SET_WORKER_ID", workerId: manager.workerId });
      }
    });

    manager.on("error", (error: string) => {
      send({ type: "ERROR", error });
    });

    manager.on("sessionAdded", (sessionId: string) => {
      send({ type: "SESSION_ADDED", sessionId });
    });

    manager.on("sessionRemoved", (sessionId: string) => {
      send({ type: "SESSION_REMOVED", sessionId });
    });

    // Forward events to callbacks
    manager.on("interviewRequest", (request: InterviewRequest) => {
      callbacksRef.current?.onInterviewRequest?.(request);
    });

    manager.on("answer", (sessionId: string, toolUseId: string, answers: Record<string, string>) => {
      callbacksRef.current?.onAnswer?.(sessionId, toolUseId, answers);
    });

    manager.on("message", (sessionId: string, message: string) => {
      callbacksRef.current?.onMessage?.(sessionId, message);
    });

    manager.on("cancel", (sessionId: string) => {
      callbacksRef.current?.onCancel?.(sessionId);
    });

    // Configure and auto-connect if enabled
    manager.configure(config);
    if (config?.enabled && config?.autoConnect !== false) {
      manager.connect();
    }

    // Cleanup on unmount
    return () => {
      manager.destroy();
      managerRef.current = null;
      initializedRef.current = false;
    };
    // Only run on mount/unmount - config changes handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle config changes (separate from initialization)
  useEffect(() => {
    const manager = managerRef.current;
    if (!manager || !initializedRef.current) return;

    manager.configure(config);

    // If config becomes enabled and we're disconnected, connect
    if (config?.enabled && config?.autoConnect !== false && !manager.isConnected) {
      manager.reset();
      manager.connect();
    }

    // If config becomes disabled, disconnect
    if (!config?.enabled && manager.isConnected) {
      manager.disconnect();
    }
  }, [config?.enabled, config?.autoConnect, config?.centralUrl, config?.token]);

  // Actions that delegate to manager
  const connect = () => {
    const manager = managerRef.current;
    if (manager) {
      manager.reset();
      manager.connect();
    }
  };

  const disconnect = () => {
    managerRef.current?.disconnect();
  };

  const sendEvent = (event: InterviewEvent) => {
    managerRef.current?.sendEvent(event);
  };

  const completeSession = (sessionId: string) => {
    managerRef.current?.completeSession(sessionId);
  };

  return {
    status: state.context.status,
    workerId: state.context.workerId,
    activeSessions: state.context.activeSessions,
    error: state.context.error,
    isConnected: state.context.status === "ready" || state.context.status === "busy",
    connect,
    disconnect,
    sendEvent,
    completeSession,
  };
}
