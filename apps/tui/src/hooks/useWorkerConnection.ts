/**
 * useWorkerConnection Hook
 * Manages WebSocket connection to central Slack service as a worker.
 * Allows the TUI to receive and process interview requests from Slack.
 */

import { randomUUID } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import type {
  CentralToWorkerMessage,
  InterviewEvent,
  InterviewRequest,
  WorkerHeartbeat,
  WorkerProject,
  WorkerRegistration,
  WorkerStatus,
  WorkerToCentralMessage,
} from "@clive/worker-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import WebSocket from "ws";
import type { WorkerConfig } from "../types/views";

// Re-export InterviewRequest for use in App.tsx
export type { InterviewRequest };

import { CentralToWorkerMessageSchema } from "@clive/worker-protocol";

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
  connect: () => Promise<void>;
  /** Disconnect from the central service */
  disconnect: () => void;
  /** Send an event to the central service */
  sendEvent: (event: InterviewEvent) => void;
  /** Mark a session as complete */
  completeSession: (sessionId: string) => void;
}

/**
 * Generate a unique worker ID
 */
function generateWorkerId(): string {
  return `worker-${randomUUID().slice(0, 8)}`;
}

/**
 * Hook for managing worker connection to central Slack service
 */
export function useWorkerConnection(
  config: WorkerConfig | undefined,
  workspaceRoot: string,
  callbacks?: WorkerCallbacks,
): UseWorkerConnectionResult {
  const [status, setStatus] = useState<WorkerStatus>("disconnected");
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [activeSessions, setActiveSessions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Refs for WebSocket and intervals
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isShuttingDownRef = useRef(false);
  const workerIdRef = useRef<string>(generateWorkerId());

  // Constants
  const HEARTBEAT_INTERVAL = 30000; // 30 seconds
  const RECONNECT_DELAY = 5000; // 5 seconds
  const MAX_RECONNECT_ATTEMPTS = 10;

  /**
   * Get project info from workspace root
   */
  const getProject = useCallback((): WorkerProject => {
    const projectName = path.basename(workspaceRoot);
    return {
      id: projectName,
      name: projectName,
      path: workspaceRoot,
    };
  }, [workspaceRoot]);

  /**
   * Send a message to the central service
   */
  const send = useCallback((message: WorkerToCentralMessage): void => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error("[WorkerConnection] Cannot send - not connected");
      return;
    }
    wsRef.current.send(JSON.stringify(message));
  }, []);

  /**
   * Send registration message
   */
  const register = useCallback((): void => {
    if (!config) return;

    const registration: WorkerRegistration = {
      workerId: workerIdRef.current,
      apiToken: config.token,
      projects: [getProject()],
      defaultProject: getProject().id,
      hostname: os.hostname(),
    };

    send({
      type: "register",
      payload: registration,
    });

    console.log(
      `[WorkerConnection] Registration sent for ${workerIdRef.current}`,
    );
  }, [config, getProject, send]);

  /**
   * Send heartbeat message
   */
  const sendHeartbeat = useCallback((): void => {
    const heartbeat: WorkerHeartbeat = {
      workerId: workerIdRef.current,
      status,
      activeSessions,
      stats: {
        cpuUsage: process.cpuUsage().user / 1000000,
        memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
        uptime: process.uptime(),
      },
    };

    send({
      type: "heartbeat",
      payload: heartbeat,
    });
  }, [status, activeSessions, send]);

  /**
   * Start heartbeat interval
   */
  const startHeartbeat = useCallback((): void => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
    }
    heartbeatTimerRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
  }, [sendHeartbeat]);

  /**
   * Stop heartbeat interval
   */
  const stopHeartbeat = useCallback((): void => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  // Store callbacks in a ref to avoid triggering reconnects
  const callbacksRef = useRef<WorkerCallbacks | undefined>(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  /**
   * Handle incoming message from central service
   */
  const handleMessage = useCallback(
    (data: string): void => {
      try {
        const parsed = JSON.parse(data);
        const result = CentralToWorkerMessageSchema.safeParse(parsed);

        if (!result.success) {
          console.error("[WorkerConnection] Invalid message:", result.error);
          return;
        }

        const message = result.data as CentralToWorkerMessage;
        console.log(`[WorkerConnection] Received: ${message.type}`);

        switch (message.type) {
          case "start_interview": {
            const request = message.payload as InterviewRequest;
            console.log(
              `[WorkerConnection] Interview request: ${request.sessionId}`,
            );
            setActiveSessions((prev) => [...prev, request.sessionId]);
            setStatus("busy");
            // Call the callback to trigger interview execution
            callbacksRef.current?.onInterviewRequest?.(request);
            break;
          }

          case "answer": {
            const answerPayload = message.payload as {
              sessionId: string;
              toolUseId: string;
              answers: Record<string, string>;
            };
            console.log(
              `[WorkerConnection] Answer for session: ${answerPayload.sessionId}`,
            );
            callbacksRef.current?.onAnswer?.(
              answerPayload.sessionId,
              answerPayload.toolUseId,
              answerPayload.answers,
            );
            break;
          }

          case "message": {
            const msgPayload = message.payload as {
              sessionId: string;
              message: string;
            };
            console.log(
              `[WorkerConnection] Message for session: ${msgPayload.sessionId}`,
            );
            callbacksRef.current?.onMessage?.(
              msgPayload.sessionId,
              msgPayload.message,
            );
            break;
          }

          case "cancel": {
            const cancelPayload = message.payload as { sessionId: string };
            console.log(
              `[WorkerConnection] Cancel session: ${cancelPayload.sessionId}`,
            );
            setActiveSessions((prev) =>
              prev.filter((id) => id !== cancelPayload.sessionId),
            );
            if (activeSessions.length <= 1) {
              setStatus("ready");
            }
            callbacksRef.current?.onCancel?.(cancelPayload.sessionId);
            break;
          }

          case "ping":
            send({ type: "pong" });
            break;
        }
      } catch (err) {
        console.error("[WorkerConnection] Failed to parse message:", err);
      }
    },
    [activeSessions.length, send],
  );

  /**
   * Handle disconnection with reconnection logic
   */
  const handleDisconnect = useCallback(
    (reason: string): void => {
      setStatus("disconnected");
      stopHeartbeat();

      if (isShuttingDownRef.current) {
        return;
      }

      setError(`Disconnected: ${reason}`);

      // Attempt reconnection with exponential backoff
      if (
        reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS &&
        config?.enabled
      ) {
        reconnectAttemptsRef.current++;
        const delay = RECONNECT_DELAY * 2 ** (reconnectAttemptsRef.current - 1);
        console.log(
          `[WorkerConnection] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`,
        );

        setTimeout(() => {
          if (!isShuttingDownRef.current && config?.enabled) {
            connectToService();
          }
        }, delay);
      } else if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setError("Max reconnect attempts reached");
      }
    },
    [config?.enabled, stopHeartbeat, connectToService],
  );

  /**
   * Connect to the central service
   */
  const connectToService = useCallback(async (): Promise<void> => {
    if (!config || !config.enabled || !config.centralUrl || !config.token) {
      return;
    }

    if (isShuttingDownRef.current) {
      return;
    }

    console.log(`[WorkerConnection] Connecting to ${config.centralUrl}...`);
    setStatus("connecting");
    setError(null);

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(config.centralUrl, {
          headers: {
            Authorization: `Bearer ${config.token}`,
          },
        });

        ws.on("open", () => {
          console.log("[WorkerConnection] WebSocket connected");
          wsRef.current = ws;
          reconnectAttemptsRef.current = 0;
          setStatus("ready");
          setWorkerId(workerIdRef.current);
          register();
          startHeartbeat();
          resolve();
        });

        ws.on("message", (data) => {
          handleMessage(data.toString());
        });

        ws.on("close", (code, reason) => {
          console.log(`[WorkerConnection] WebSocket closed: ${code} ${reason}`);
          wsRef.current = null;
          handleDisconnect(reason.toString() || `Code: ${code}`);
        });

        ws.on("error", (err) => {
          console.error("[WorkerConnection] WebSocket error:", err);
          setError(err.message);
          reject(err);
        });
      } catch (err) {
        const error = err as Error;
        setError(error.message);
        reject(err);
      }
    });
  }, [config, register, startHeartbeat, handleMessage, handleDisconnect]);

  /**
   * Disconnect from the central service
   */
  const disconnect = useCallback((): void => {
    console.log("[WorkerConnection] Disconnecting...");
    isShuttingDownRef.current = true;
    stopHeartbeat();

    if (wsRef.current) {
      wsRef.current.close(1000, "Worker shutting down");
      wsRef.current = null;
    }

    setStatus("disconnected");
    setWorkerId(null);
    setActiveSessions([]);
  }, [stopHeartbeat]);

  /**
   * Send an event to the central service
   */
  const sendEvent = useCallback(
    (event: InterviewEvent): void => {
      send({
        type: "event",
        payload: event,
      });
    },
    [send],
  );

  /**
   * Mark a session as complete and remove from active sessions
   */
  const completeSession = useCallback((sessionId: string): void => {
    setActiveSessions((prev) => {
      const updated = prev.filter((id) => id !== sessionId);
      if (updated.length === 0) {
        setStatus("ready");
      }
      return updated;
    });
  }, []);

  // Auto-connect on mount if configured
  useEffect(() => {
    if (config?.enabled && config?.autoConnect !== false) {
      isShuttingDownRef.current = false;
      connectToService().catch((err) => {
        console.error("[WorkerConnection] Auto-connect failed:", err);
      });
    }

    return () => {
      disconnect();
    };
  }, [config?.enabled, config?.autoConnect, connectToService, disconnect]);

  return {
    status,
    workerId,
    activeSessions,
    error,
    isConnected: status === "ready" || status === "busy",
    connect: connectToService,
    disconnect,
    sendEvent,
    completeSession,
  };
}
