/**
 * WebSocket Event Server
 *
 * Handles WebSocket connections from worker clients.
 */

import type { Server } from "node:http";
import type {
  CentralToWorkerMessage,
  WorkerToCentralMessage,
} from "@clive/worker-protocol";
import { WorkerToCentralMessageSchema } from "@clive/worker-protocol";
import { WebSocket, WebSocketServer } from "ws";
import type { WorkerProxy } from "../services/worker-proxy";
import type { WorkerRegistry } from "../services/worker-registry";
import type { InterviewStore } from "../store/interview-store";

/**
 * WebSocket event server configuration
 */
export interface EventServerConfig {
  /** HTTP server to attach to */
  server: Server;
  /** Path for WebSocket endpoint */
  path?: string;
  /** API token for authentication */
  apiToken: string;
}

/**
 * WebSocket event server for worker communication
 */
export class EventServer {
  private wss: WebSocketServer;
  private registry: WorkerRegistry;
  private proxy: WorkerProxy;
  private apiToken: string;
  private store?: InterviewStore;

  constructor(
    config: EventServerConfig,
    registry: WorkerRegistry,
    proxy: WorkerProxy,
    store?: InterviewStore,
  ) {
    this.registry = registry;
    this.proxy = proxy;
    this.apiToken = config.apiToken;
    this.store = store;

    // Create WebSocket server attached to HTTP server
    this.wss = new WebSocketServer({
      server: config.server,
      path: config.path || "/ws",
    });

    this.wss.on("connection", (socket, request) => {
      this.handleConnection(socket, request);
    });

    console.log(
      `[EventServer] WebSocket server started on ${config.path || "/ws"}`,
    );
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(socket: WebSocket, request: any): void {
    const authHeader = request.headers.authorization;

    // Validate authentication
    if (!this.validateAuth(authHeader)) {
      console.log("[EventServer] Rejecting unauthorized connection");
      socket.close(4001, "Unauthorized");
      return;
    }

    console.log("[EventServer] New worker connection");

    // Set up message handler
    socket.on("message", (data) => {
      this.handleMessage(socket, data.toString());
    });

    // Send ping every 30 seconds
    const pingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        this.sendToSocket(socket, { type: "ping" });
      }
    }, 30000);

    // Set up close handler (single consolidated handler)
    socket.on("close", (code, reason) => {
      console.log(`[EventServer] Worker disconnected: ${code} ${reason}`);
      clearInterval(pingInterval);
      this.registry.unregisterBySocket(socket, reason.toString());
    });

    // Set up error handler
    socket.on("error", (error) => {
      console.error("[EventServer] Socket error:", error);
    });
  }

  /**
   * Validate authorization header
   */
  private validateAuth(authHeader: string | undefined): boolean {
    if (!authHeader) {
      return false;
    }

    const [type, token] = authHeader.split(" ");
    if (type !== "Bearer" || !token) {
      return false;
    }

    return token === this.apiToken;
  }

  /**
   * Handle incoming message from worker
   */
  private handleMessage(socket: WebSocket, data: string): void {
    try {
      const parsed = JSON.parse(data);
      const result = WorkerToCentralMessageSchema.safeParse(parsed);

      if (!result.success) {
        console.error("[EventServer] Invalid message:", result.error);
        return;
      }

      const message = result.data as WorkerToCentralMessage;
      console.log(`[EventServer] Received: ${message.type}`);

      switch (message.type) {
        case "register": {
          const registerResult = this.registry.register(
            message.payload,
            socket,
          );
          if (!registerResult.success) {
            console.error(
              "[EventServer] Registration failed:",
              registerResult.error,
            );
            socket.close(4002, registerResult.error);
          }
          break;
        }

        case "heartbeat":
          this.registry.handleHeartbeat(message.payload);
          break;

        case "event":
          this.proxy.handleWorkerEvent(message.payload, this.store);
          break;

        case "pong":
          // Heartbeat response - no action needed
          break;

        case "error":
          console.error("[EventServer] Worker error:", message.payload);
          break;
      }
    } catch (error) {
      console.error("[EventServer] Failed to parse message:", error);
    }
  }

  /**
   * Send message to socket
   */
  private sendToSocket(
    socket: WebSocket,
    message: CentralToWorkerMessage,
  ): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(message));
  }

  /**
   * Broadcast message to all connected workers
   */
  broadcast(message: CentralToWorkerMessage): void {
    for (const socket of this.wss.clients) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    }
  }

  /**
   * Get connected client count
   */
  get clientCount(): number {
    return this.wss.clients.size;
  }

  /**
   * Close all connections
   */
  close(): void {
    for (const socket of this.wss.clients) {
      socket.close(1001, "Server shutting down");
    }
    this.wss.close();
  }
}
