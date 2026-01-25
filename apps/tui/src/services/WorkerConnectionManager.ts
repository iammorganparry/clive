/**
 * WorkerConnectionManager
 * Manages WebSocket connection to central Slack service outside React render cycle.
 *
 * This class handles all WebSocket lifecycle management including:
 * - Connection establishment and authentication
 * - Heartbeat management
 * - Reconnection with exponential backoff
 * - Message handling and event emission
 */

import { randomUUID } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { EventEmitter } from "node:events";
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
import { CentralToWorkerMessageSchema } from "@clive/worker-protocol";
import WebSocket from "ws";
import type { WorkerConfig } from "../types/views";

/**
 * Events emitted by WorkerConnectionManager
 */
export interface WorkerConnectionEvents {
  /** Connection status changed */
  status: (status: WorkerStatus) => void;
  /** Error occurred */
  error: (error: string) => void;
  /** Interview request received */
  interviewRequest: (request: InterviewRequest) => void;
  /** Answer received for a session */
  answer: (sessionId: string, toolUseId: string, answers: Record<string, string>) => void;
  /** Message received for a session */
  message: (sessionId: string, message: string) => void;
  /** Session cancelled */
  cancel: (sessionId: string) => void;
  /** Session added */
  sessionAdded: (sessionId: string) => void;
  /** Session removed */
  sessionRemoved: (sessionId: string) => void;
}

/**
 * Generate a unique worker ID (stable for this process)
 */
function generateWorkerId(): string {
  return `worker-${randomUUID().slice(0, 8)}`;
}

export class WorkerConnectionManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private isShuttingDown = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Configuration
  private config: WorkerConfig | null = null;
  private workspaceRoot: string;

  // State
  private _status: WorkerStatus = "disconnected";
  private _workerId: string;
  private _activeSessions: string[] = [];
  private _error: string | null = null;

  // Constants
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly RECONNECT_DELAY = 5000; // 5 seconds base
  private readonly MAX_RECONNECT_ATTEMPTS = 10;

  constructor(workspaceRoot: string) {
    super();
    this.workspaceRoot = workspaceRoot;
    this._workerId = generateWorkerId();
  }

  // Getters for state
  get status(): WorkerStatus {
    return this._status;
  }

  get workerId(): string {
    return this._workerId;
  }

  get activeSessions(): string[] {
    return [...this._activeSessions];
  }

  get error(): string | null {
    return this._error;
  }

  get isConnected(): boolean {
    return this._status === "ready" || this._status === "busy";
  }

  /**
   * Configure the connection (call before connect)
   */
  configure(config: WorkerConfig | undefined): void {
    this.config = config || null;
  }

  /**
   * Get project info from workspace root
   */
  private getProject(): WorkerProject {
    const projectName = path.basename(this.workspaceRoot);
    return {
      id: projectName,
      name: projectName,
      path: this.workspaceRoot,
    };
  }

  /**
   * Update status and emit event
   */
  private setStatus(status: WorkerStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit("status", status);
    }
  }

  /**
   * Set error and emit event
   */
  private setError(error: string | null): void {
    this._error = error;
    if (error) {
      this.emit("error", error);
    }
  }

  /**
   * Send a message to the central service
   */
  private send(message: WorkerToCentralMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("[WorkerConnectionManager] Cannot send - not connected");
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Send registration message
   */
  private register(): void {
    if (!this.config) return;

    const registration: WorkerRegistration = {
      workerId: this._workerId,
      apiToken: this.config.token,
      projects: [this.getProject()],
      defaultProject: this.getProject().id,
      hostname: os.hostname(),
    };

    this.send({
      type: "register",
      payload: registration,
    });

    console.log(`[WorkerConnectionManager] Registration sent for ${this._workerId}`);
  }

  /**
   * Send heartbeat message
   */
  private sendHeartbeat(): void {
    const heartbeat: WorkerHeartbeat = {
      workerId: this._workerId,
      status: this._status,
      activeSessions: this._activeSessions,
      stats: {
        cpuUsage: process.cpuUsage().user / 1000000,
        memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
        uptime: process.uptime(),
      },
    };

    this.send({
      type: "heartbeat",
      payload: heartbeat,
    });
  }

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), this.HEARTBEAT_INTERVAL);
  }

  /**
   * Stop heartbeat interval
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Handle incoming message from central service
   */
  private handleMessage(data: string): void {
    try {
      const parsed = JSON.parse(data);
      const result = CentralToWorkerMessageSchema.safeParse(parsed);

      if (!result.success) {
        console.error("[WorkerConnectionManager] Invalid message:", result.error);
        return;
      }

      const message = result.data as CentralToWorkerMessage;
      console.log(`[WorkerConnectionManager] Received: ${message.type}`);

      switch (message.type) {
        case "start_interview": {
          const request = message.payload as InterviewRequest;
          console.log(`[WorkerConnectionManager] Interview request: ${request.sessionId}`);
          this._activeSessions.push(request.sessionId);
          this.setStatus("busy");
          this.emit("sessionAdded", request.sessionId);
          this.emit("interviewRequest", request);
          break;
        }

        case "answer": {
          const answerPayload = message.payload as {
            sessionId: string;
            toolUseId: string;
            answers: Record<string, string>;
          };
          console.log(`[WorkerConnectionManager] Answer for session: ${answerPayload.sessionId}`);
          this.emit("answer", answerPayload.sessionId, answerPayload.toolUseId, answerPayload.answers);
          break;
        }

        case "message": {
          const msgPayload = message.payload as {
            sessionId: string;
            message: string;
          };
          console.log(`[WorkerConnectionManager] Message for session: ${msgPayload.sessionId}`);
          this.emit("message", msgPayload.sessionId, msgPayload.message);
          break;
        }

        case "cancel": {
          const cancelPayload = message.payload as { sessionId: string };
          console.log(`[WorkerConnectionManager] Cancel session: ${cancelPayload.sessionId}`);
          this._activeSessions = this._activeSessions.filter((id) => id !== cancelPayload.sessionId);
          if (this._activeSessions.length === 0) {
            this.setStatus("ready");
          }
          this.emit("sessionRemoved", cancelPayload.sessionId);
          this.emit("cancel", cancelPayload.sessionId);
          break;
        }

        case "ping":
          this.send({ type: "pong" });
          break;
      }
    } catch (err) {
      console.error("[WorkerConnectionManager] Failed to parse message:", err);
    }
  }

  /**
   * Handle disconnection with optional reconnection
   */
  private handleDisconnect(reason: string): void {
    this.setStatus("disconnected");
    this.stopHeartbeat();

    if (this.isShuttingDown) {
      return;
    }

    this.setError(`Disconnected: ${reason}`);

    // Attempt reconnection with exponential backoff
    if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS && this.config?.enabled) {
      this.reconnectAttempts++;
      const delay = this.RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1);
      console.log(
        `[WorkerConnectionManager] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
      );

      this.reconnectTimer = setTimeout(() => {
        if (!this.isShuttingDown && this.config?.enabled) {
          this.connect();
        }
      }, delay);
    } else if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.setError("Max reconnect attempts reached");
    }
  }

  /**
   * Connect to the central service
   */
  connect(): void {
    if (!this.config || !this.config.enabled || !this.config.centralUrl || !this.config.token) {
      return;
    }

    if (this.isShuttingDown) {
      return;
    }

    // Prevent duplicate connections
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      console.log("[WorkerConnectionManager] Already connected or connecting, skipping");
      return;
    }

    console.log(`[WorkerConnectionManager] Connecting to ${this.config.centralUrl}...`);
    this.setStatus("connecting");
    this.setError(null);

    try {
      const ws = new WebSocket(this.config.centralUrl, {
        headers: {
          Authorization: `Bearer ${this.config.token}`,
        },
      });

      // Assign immediately to prevent duplicate connections while connecting
      this.ws = ws;

      ws.on("open", () => {
        console.log("[WorkerConnectionManager] WebSocket connected");
        this.reconnectAttempts = 0;
        this.setStatus("ready");
        this.register();
        this.startHeartbeat();
      });

      ws.on("message", (data) => {
        this.handleMessage(data.toString());
      });

      ws.on("close", (code, reason) => {
        console.log(`[WorkerConnectionManager] WebSocket closed: ${code} ${reason}`);
        this.ws = null;
        this.handleDisconnect(reason.toString() || `Code: ${code}`);
      });

      ws.on("error", (err) => {
        console.error("[WorkerConnectionManager] WebSocket error:", err);
        this.setError(err.message);
      });
    } catch (err) {
      const error = err as Error;
      this.setError(error.message);
    }
  }

  /**
   * Disconnect from the central service
   */
  disconnect(): void {
    console.log("[WorkerConnectionManager] Disconnecting...");
    this.isShuttingDown = true;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, "Worker shutting down");
      this.ws = null;
    }

    this.setStatus("disconnected");
    this._activeSessions = [];
  }

  /**
   * Send an event to the central service
   */
  sendEvent(event: InterviewEvent): void {
    this.send({
      type: "event",
      payload: event,
    });
  }

  /**
   * Mark a session as complete and remove from active sessions
   */
  completeSession(sessionId: string): void {
    this._activeSessions = this._activeSessions.filter((id) => id !== sessionId);
    if (this._activeSessions.length === 0) {
      this.setStatus("ready");
    }
    this.emit("sessionRemoved", sessionId);
  }

  /**
   * Reset for reconnection (clears shutdown flag)
   */
  reset(): void {
    this.isShuttingDown = false;
    this.reconnectAttempts = 0;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.disconnect();
    this.removeAllListeners();
  }
}
