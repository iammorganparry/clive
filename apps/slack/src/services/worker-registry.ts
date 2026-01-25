/**
 * Worker Registry
 *
 * Tracks connected workers, manages heartbeats, and handles timeouts.
 */

import { EventEmitter } from "node:events";
import type {
  WorkerHeartbeat,
  WorkerInfo,
  WorkerProject,
  WorkerRegistration,
  WorkerStatus,
} from "@clive/worker-protocol";
import type { WebSocket } from "ws";

/**
 * Registered worker with connection info
 */
interface RegisteredWorker {
  workerId: string;
  status: WorkerStatus;
  hostname?: string;
  projects: WorkerProject[];
  defaultProject?: string;
  activeSessions: Set<string>;
  socket: WebSocket;
  connectedAt: Date;
  lastHeartbeat: Date;
  heartbeatTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Worker registry events
 */
export interface WorkerRegistryEvents {
  workerRegistered: (workerId: string) => void;
  workerDisconnected: (workerId: string, reason: string) => void;
  workerTimeout: (workerId: string) => void;
  workerStatusChanged: (workerId: string, status: WorkerStatus) => void;
}

/**
 * Worker registry for managing connected workers
 */
export class WorkerRegistry extends EventEmitter {
  private workers = new Map<string, RegisteredWorker>();
  private socketToWorkerId = new Map<WebSocket, string>();

  /** Heartbeat timeout in milliseconds */
  private readonly heartbeatTimeout = 60000; // 60 seconds

  /**
   * Register a new worker
   */
  register(
    registration: WorkerRegistration,
    socket: WebSocket,
  ): { success: boolean; error?: string } {
    const { workerId, projects, defaultProject, hostname } = registration;

    // Check for duplicate worker ID
    if (this.workers.has(workerId)) {
      const existing = this.workers.get(workerId)!;
      if (existing.socket !== socket) {
        // Force unregister old worker to allow reconnection with same ID
        console.log(
          `[WorkerRegistry] Replacing existing worker ${workerId} (reconnection)`,
        );
        this.unregister(workerId, "replaced by new connection");
      }
      // Same socket - just update
    }

    const worker: RegisteredWorker = {
      workerId,
      status: "ready",
      hostname,
      projects,
      defaultProject,
      activeSessions: new Set(),
      socket,
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
    };

    // Set up heartbeat timeout
    worker.heartbeatTimer = this.createHeartbeatTimer(workerId);

    this.workers.set(workerId, worker);
    this.socketToWorkerId.set(socket, workerId);

    const projectNames = projects.map((p) => p.name).join(", ");
    console.log(
      `[WorkerRegistry] Worker registered: ${workerId} (${hostname}) with projects: [${projectNames}]`,
    );
    this.emit("workerRegistered", workerId);

    return { success: true };
  }

  /**
   * Handle heartbeat from worker
   */
  handleHeartbeat(heartbeat: WorkerHeartbeat): void {
    const worker = this.workers.get(heartbeat.workerId);
    if (!worker) {
      console.warn(
        `[WorkerRegistry] Heartbeat from unknown worker: ${heartbeat.workerId}`,
      );
      return;
    }

    // Update worker state
    worker.lastHeartbeat = new Date();
    const oldStatus = worker.status;
    worker.status = heartbeat.status;
    worker.activeSessions = new Set(heartbeat.activeSessions);

    // Reset heartbeat timer
    if (worker.heartbeatTimer) {
      clearTimeout(worker.heartbeatTimer);
    }
    worker.heartbeatTimer = this.createHeartbeatTimer(heartbeat.workerId);

    if (oldStatus !== heartbeat.status) {
      this.emit("workerStatusChanged", heartbeat.workerId, heartbeat.status);
    }
  }

  /**
   * Create heartbeat timeout timer
   */
  private createHeartbeatTimer(
    workerId: string,
  ): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      console.log(`[WorkerRegistry] Worker ${workerId} heartbeat timeout`);
      this.emit("workerTimeout", workerId);
      this.unregister(workerId, "heartbeat timeout");
    }, this.heartbeatTimeout);
  }

  /**
   * Unregister a worker
   */
  unregister(workerId: string, reason: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return;
    }

    // Clear heartbeat timer
    if (worker.heartbeatTimer) {
      clearTimeout(worker.heartbeatTimer);
    }

    // Clean up mappings
    this.socketToWorkerId.delete(worker.socket);
    this.workers.delete(workerId);

    console.log(
      `[WorkerRegistry] Worker unregistered: ${workerId} (${reason})`,
    );
    this.emit("workerDisconnected", workerId, reason);
  }

  /**
   * Unregister worker by socket
   */
  unregisterBySocket(socket: WebSocket, reason: string): void {
    const workerId = this.socketToWorkerId.get(socket);
    if (workerId) {
      this.unregister(workerId, reason);
    }
  }

  /**
   * Get worker by ID
   */
  getWorker(workerId: string): RegisteredWorker | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Get worker ID by socket
   */
  getWorkerIdBySocket(socket: WebSocket): string | undefined {
    return this.socketToWorkerId.get(socket);
  }

  /**
   * Get all available workers (ready status)
   */
  getAvailableWorkers(): RegisteredWorker[] {
    return Array.from(this.workers.values()).filter(
      (w) => w.status === "ready",
    );
  }

  /**
   * Get worker with fewest active sessions
   */
  getLeastBusyWorker(): RegisteredWorker | undefined {
    const available = this.getAvailableWorkers();
    if (available.length === 0) {
      return undefined;
    }

    return available.reduce((least, current) =>
      current.activeSessions.size < least.activeSessions.size ? current : least,
    );
  }

  /**
   * Find workers that have access to a specific project
   * Matches by project ID, name, or aliases (case-insensitive)
   */
  getWorkersForProject(projectQuery: string): RegisteredWorker[] {
    const query = projectQuery.toLowerCase();
    return Array.from(this.workers.values()).filter((worker) => {
      return worker.projects.some((project) => {
        // Match by ID
        if (project.id.toLowerCase() === query) return true;
        // Match by name
        if (project.name.toLowerCase() === query) return true;
        // Match by aliases
        if (project.aliases?.some((alias) => alias.toLowerCase() === query))
          return true;
        // Partial match on name (e.g., "marketing" matches "marketing-app")
        if (project.name.toLowerCase().includes(query)) return true;
        return false;
      });
    });
  }

  /**
   * Get least busy worker that has access to a specific project
   */
  getLeastBusyWorkerForProject(
    projectQuery: string,
  ): RegisteredWorker | undefined {
    const workers = this.getWorkersForProject(projectQuery);
    const available = workers.filter((w) => w.status === "ready");

    if (available.length === 0) {
      return undefined;
    }

    return available.reduce((least, current) =>
      current.activeSessions.size < least.activeSessions.size ? current : least,
    );
  }

  /**
   * Get the project path for a worker given a project query
   */
  getProjectPath(workerId: string, projectQuery: string): string | undefined {
    const worker = this.workers.get(workerId);
    if (!worker) return undefined;

    const query = projectQuery.toLowerCase();
    const project = worker.projects.find((p) => {
      if (p.id.toLowerCase() === query) return true;
      if (p.name.toLowerCase() === query) return true;
      if (p.aliases?.some((alias) => alias.toLowerCase() === query))
        return true;
      if (p.name.toLowerCase().includes(query)) return true;
      return false;
    });

    return project?.path;
  }

  /**
   * Get all projects across all workers
   */
  getAllProjects(): { workerId: string; project: WorkerProject }[] {
    const projects: { workerId: string; project: WorkerProject }[] = [];
    for (const worker of this.workers.values()) {
      for (const project of worker.projects) {
        projects.push({ workerId: worker.workerId, project });
      }
    }
    return projects;
  }

  /**
   * Add session to worker
   */
  addSessionToWorker(workerId: string, sessionId: string): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.activeSessions.add(sessionId);
      if (worker.status === "ready") {
        worker.status = "busy";
        this.emit("workerStatusChanged", workerId, "busy");
      }
    }
  }

  /**
   * Remove session from worker
   */
  removeSessionFromWorker(workerId: string, sessionId: string): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.activeSessions.delete(sessionId);
      if (worker.activeSessions.size === 0 && worker.status === "busy") {
        worker.status = "ready";
        this.emit("workerStatusChanged", workerId, "ready");
      }
    }
  }

  /**
   * Get list of all workers for API
   */
  listWorkers(): WorkerInfo[] {
    return Array.from(this.workers.values()).map((w) => ({
      workerId: w.workerId,
      status: w.status,
      hostname: w.hostname,
      activeSessions: w.activeSessions.size,
      lastHeartbeat: w.lastHeartbeat.toISOString(),
      connectedAt: w.connectedAt.toISOString(),
    }));
  }

  /**
   * Get worker count
   */
  get workerCount(): number {
    return this.workers.size;
  }

  /**
   * Get available worker count
   */
  get availableWorkerCount(): number {
    return this.getAvailableWorkers().length;
  }

  /**
   * Close all workers
   */
  closeAll(): void {
    for (const workerId of this.workers.keys()) {
      this.unregister(workerId, "server shutdown");
    }
  }
}
