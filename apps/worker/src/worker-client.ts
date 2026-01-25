/**
 * Worker Client
 *
 * Manages WebSocket connection to central service.
 * Routes messages between central service and local executor.
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  CentralToWorkerMessage,
  InterviewEvent,
  InterviewRequest,
  NgrokConfig,
  WorkerHeartbeat,
  WorkerRegistration,
  WorkerStatus,
  WorkerToCentralMessage,
} from "@clive/worker-protocol";
import { CentralToWorkerMessageSchema } from "@clive/worker-protocol";
import WebSocket from "ws";
import type { WorkerConfig } from "./config.js";
import { LocalExecutor } from "./local-executor.js";
import { TunnelManager } from "./tunnel-manager.js";

/**
 * Generate a unique worker ID
 */
function generateWorkerId(): string {
  return `worker-${randomUUID().slice(0, 8)}`;
}

/**
 * Worker client events
 */
export interface WorkerClientEvents {
  connected: () => void;
  disconnected: (reason: string) => void;
  registered: (workerId: string) => void;
  error: (error: Error) => void;
  configUpdate: (config: { ngrokConfig?: NgrokConfig }) => void;
}

/**
 * Worker client for connecting to central service
 */
export class WorkerClient extends EventEmitter {
  private config: WorkerConfig;
  private workerId: string;
  private ws: WebSocket | null = null;
  private executor: LocalExecutor;
  private tunnelManager: TunnelManager;
  private status: WorkerStatus = "disconnected";
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private isShuttingDown = false;

  constructor(config: WorkerConfig) {
    super();
    this.config = config;
    this.workerId = generateWorkerId();
    // Use default project path for executor, will be overridden per-interview
    const defaultProject =
      config.projects.find((p) => p.id === config.defaultProject) ||
      config.projects[0];
    this.executor = new LocalExecutor(defaultProject.path);
    this.tunnelManager = new TunnelManager();

    // Set up tunnel event handlers
    this.tunnelManager.on("connected", (url) => {
      console.log(`[WorkerClient] Tunnel connected: ${url}`);
    });

    this.tunnelManager.on("error", (error) => {
      console.error("[WorkerClient] Tunnel error:", error);
    });
  }

  /**
   * Connect to central service
   */
  async connect(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    console.log(
      `[WorkerClient] Connecting to ${this.config.centralServiceUrl}...`,
    );
    this.status = "connecting";

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.centralServiceUrl, {
          headers: {
            Authorization: `Bearer ${this.config.apiToken}`,
          },
        });

        this.ws.on("open", () => {
          console.log("[WorkerClient] WebSocket connected");
          this.reconnectAttempts = 0;
          this.register();
          this.startHeartbeat();
          this.emit("connected");
          resolve();
        });

        this.ws.on("message", (data) => {
          this.handleMessage(data.toString());
        });

        this.ws.on("close", (code, reason) => {
          console.log(`[WorkerClient] WebSocket closed: ${code} ${reason}`);
          this.handleDisconnect(reason.toString());
        });

        this.ws.on("error", (error) => {
          console.error("[WorkerClient] WebSocket error:", error);
          this.emit("error", error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Register with central service
   */
  private register(): void {
    const registration: WorkerRegistration = {
      workerId: this.workerId,
      apiToken: this.config.apiToken,
      projects: this.config.projects,
      defaultProject: this.config.defaultProject,
      hostname: this.config.hostname,
    };

    this.send({
      type: "register",
      payload: registration,
    });

    const projectNames = this.config.projects.map((p) => p.name).join(", ");
    console.log(
      `[WorkerClient] Registration sent for ${this.workerId} with projects: [${projectNames}]`,
    );
  }

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatInterval);
  }

  /**
   * Send heartbeat to central service
   */
  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const heartbeat: WorkerHeartbeat = {
      workerId: this.workerId,
      status: this.status,
      activeSessions: this.executor.getActiveSessions(),
      stats: {
        cpuUsage: process.cpuUsage().user / 1000000, // Convert to seconds
        memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024, // Convert to MB
        uptime: process.uptime(),
      },
    };

    this.send({
      type: "heartbeat",
      payload: heartbeat,
    });
  }

  /**
   * Handle incoming message from central service
   */
  private handleMessage(data: string): void {
    try {
      const parsed = JSON.parse(data);
      const result = CentralToWorkerMessageSchema.safeParse(parsed);

      if (!result.success) {
        console.error("[WorkerClient] Invalid message:", result.error);
        return;
      }

      const message = result.data as CentralToWorkerMessage;
      console.log(`[WorkerClient] Received: ${message.type}`);

      switch (message.type) {
        case "start_interview":
          this.handleStartInterview(message.payload as InterviewRequest);
          break;

        case "answer": {
          const answerPayload = message.payload as {
            sessionId: string;
            toolUseId: string;
            answers: Record<string, string>;
          };
          this.executor.sendAnswer(
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
          this.executor.sendMessage(msgPayload.sessionId, msgPayload.message);
          break;
        }

        case "cancel": {
          const cancelPayload = message.payload as { sessionId: string };
          this.executor.cancelSession(cancelPayload.sessionId);
          break;
        }

        case "ping":
          this.send({ type: "pong" });
          break;

        case "config_update": {
          const configPayload = message.payload as {
            ngrokConfig?: NgrokConfig;
          };
          this.emit("configUpdate", configPayload);
          // Set up tunnel if ngrok config is provided
          if (configPayload.ngrokConfig) {
            this.setupTunnel(configPayload.ngrokConfig);
          }
          break;
        }
      }
    } catch (error) {
      console.error("[WorkerClient] Failed to parse message:", error);
    }
  }

  /**
   * Handle start_interview request
   */
  private async handleStartInterview(request: InterviewRequest): Promise<void> {
    console.log(
      `[WorkerClient] Starting interview ${request.sessionId}${request.projectId ? ` for project "${request.projectId}"` : ""}`,
    );
    this.status = "busy";

    // Find the appropriate project path
    let workspacePath: string;
    if (request.projectId) {
      const project = this.config.projects.find(
        (p) =>
          p.id === request.projectId ||
          p.name.toLowerCase() === request.projectId?.toLowerCase() ||
          p.aliases?.some(
            (a: string) => a.toLowerCase() === request.projectId?.toLowerCase(),
          ),
      );
      if (project) {
        workspacePath = project.path;
        console.log(
          `[WorkerClient] Using project "${project.name}" at ${workspacePath}`,
        );
      } else {
        // Fall back to default
        const defaultProject =
          this.config.projects.find(
            (p) => p.id === this.config.defaultProject,
          ) || this.config.projects[0];
        workspacePath = defaultProject.path;
        console.log(
          `[WorkerClient] Project "${request.projectId}" not found, using default: ${workspacePath}`,
        );
      }
    } else {
      const defaultProject =
        this.config.projects.find((p) => p.id === this.config.defaultProject) ||
        this.config.projects[0];
      workspacePath = defaultProject.path;
    }

    // Update executor workspace for this interview
    this.executor.setWorkspace(workspacePath);

    try {
      await this.executor.startInterview(request, (event) => {
        this.sendEvent(event);
      });
    } catch (error) {
      console.error(`[WorkerClient] Interview failed:`, error);
      this.sendEvent({
        sessionId: request.sessionId,
        type: "error",
        payload: { type: "error", message: String(error) },
        timestamp: new Date().toISOString(),
      });
    } finally {
      if (this.executor.activeSessionCount === 0) {
        this.status = "ready";
      }
    }
  }

  /**
   * Send an event to central service
   */
  private sendEvent(event: InterviewEvent): void {
    this.send({
      type: "event",
      payload: event,
    });
  }

  /**
   * Send a message to central service
   */
  private send(message: WorkerToCentralMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("[WorkerClient] Cannot send - not connected");
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Handle disconnection
   */
  private handleDisconnect(reason: string): void {
    this.status = "disconnected";
    this.stopHeartbeat();

    if (this.isShuttingDown) {
      return;
    }

    this.emit("disconnected", reason);

    // Attempt reconnection
    if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay =
        this.config.reconnectDelay * 2 ** (this.reconnectAttempts - 1);
      console.log(
        `[WorkerClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
      );

      setTimeout(() => {
        this.connect().catch((error) => {
          console.error("[WorkerClient] Reconnection failed:", error);
        });
      }, delay);
    } else {
      console.error("[WorkerClient] Max reconnect attempts reached");
    }
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
   * Get current status
   */
  getStatus(): WorkerStatus {
    return this.status;
  }

  /**
   * Get worker ID
   */
  getWorkerId(): string {
    return this.workerId;
  }

  /**
   * Get active session count
   */
  getActiveSessionCount(): number {
    return this.executor.activeSessionCount;
  }

  /**
   * Set up tunnel with provided config
   */
  private async setupTunnel(config: NgrokConfig): Promise<void> {
    console.log("[WorkerClient] Setting up tunnel with provided config...");
    this.tunnelManager.setConfig(config);
    const url = await this.tunnelManager.connect();
    if (url) {
      console.log(`[WorkerClient] Tunnel URL: ${url}`);
    }
  }

  /**
   * Get tunnel URL if connected
   */
  getTunnelUrl(): string | null {
    return this.tunnelManager.getUrl();
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log("[WorkerClient] Shutting down...");
    this.isShuttingDown = true;

    this.stopHeartbeat();
    this.executor.closeAll();

    // Disconnect tunnel
    await this.tunnelManager.disconnect();

    if (this.ws) {
      this.ws.close(1000, "Worker shutting down");
      this.ws = null;
    }

    console.log("[WorkerClient] Shutdown complete");
  }
}
