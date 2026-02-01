/**
 * Session Router
 *
 * Assigns interview sessions to workers and handles failover.
 * Includes an in-memory queue for when all workers are at capacity.
 */

import { EventEmitter } from "node:events";
import type { WorkerRegistry } from "./worker-registry";

/**
 * Session assignment info
 */
interface SessionAssignment {
  sessionId: string;
  workerId: string;
  projectId?: string;
  projectPath?: string;
  assignedAt: Date;
}

/**
 * Pending session waiting in queue
 */
interface PendingSession {
  sessionId: string;
  projectQuery?: string;
  queuedAt: Date;
  timeoutTimer: ReturnType<typeof setTimeout>;
  onAssigned: (workerId: string) => void;
  onTimeout: () => void;
}

/**
 * Session router events
 */
export interface SessionRouterEvents {
  sessionAssigned: (sessionId: string, workerId: string) => void;
  sessionUnassigned: (
    sessionId: string,
    workerId: string,
    reason: string,
  ) => void;
  noWorkersAvailable: (sessionId: string) => void;
  sessionQueued: (sessionId: string, position: number) => void;
  sessionDequeuedAndAssigned: (sessionId: string, workerId: string) => void;
  sessionQueueTimeout: (sessionId: string) => void;
}

/**
 * Queue callbacks for async assignment
 */
export interface QueueCallbacks {
  onAssigned: (workerId: string) => void;
  onTimeout: () => void;
}

/**
 * Session router for distributing work to workers
 */
export class SessionRouter extends EventEmitter {
  private assignments = new Map<string, SessionAssignment>();
  private pendingQueue: PendingSession[] = [];
  private readonly queueTimeout = 120000; // 2 minutes
  private registry: WorkerRegistry;

  constructor(registry: WorkerRegistry) {
    super();
    this.registry = registry;

    // Handle worker disconnection - reassign orphaned sessions
    // Note: We only listen to workerDisconnected because unregister() (called on timeout)
    // already emits workerDisconnected. Listening to both would cause double handling.
    this.registry.on("workerDisconnected", (workerId, reason) => {
      this.handleWorkerDisconnected(workerId, reason);
    });

    // Drain queue when a worker becomes available
    this.registry.on("workerStatusChanged", (_workerId: string, status: string) => {
      if (status === "ready") this.drainQueue();
    });
  }

  /**
   * Assign a session to a worker
   * Returns the assigned worker ID, "queued" if queued, or null if no workers and no callbacks
   *
   * @param sessionId - The session ID to assign
   * @param projectQuery - Optional project name/ID to match workers against
   * @param callbacks - Optional queue callbacks; if provided, session will be queued when no workers available
   */
  assignSession(
    sessionId: string,
    projectQuery?: string,
    callbacks?: QueueCallbacks,
  ): string | "queued" | null {
    // Check if already assigned
    const existing = this.assignments.get(sessionId);
    if (existing) {
      return existing.workerId;
    }

    // Find available worker
    const worker = this.findWorker(projectQuery);

    if (!worker) {
      if (callbacks) {
        // Queue the request
        this.enqueueSession(sessionId, projectQuery, callbacks.onAssigned, callbacks.onTimeout);
        return "queued";
      }
      console.log(
        `[SessionRouter] No workers available for session ${sessionId}`,
      );
      this.emit("noWorkersAvailable", sessionId);
      return null;
    }

    // Resolve project path if applicable
    let projectPath: string | undefined;
    if (projectQuery) {
      projectPath = this.registry.getProjectPath(worker.workerId, projectQuery);
      console.log(
        `[SessionRouter] Found worker ${worker.workerId} with project "${projectQuery}" at ${projectPath}`,
      );
    }

    // Create assignment
    const assignment: SessionAssignment = {
      sessionId,
      workerId: worker.workerId,
      projectId: projectQuery,
      projectPath,
      assignedAt: new Date(),
    };

    this.assignments.set(sessionId, assignment);
    this.registry.addSessionToWorker(worker.workerId, sessionId);

    console.log(
      `[SessionRouter] Assigned session ${sessionId} to worker ${worker.workerId}${projectQuery ? ` for project "${projectQuery}"` : ""}`,
    );
    this.emit("sessionAssigned", sessionId, worker.workerId);

    return worker.workerId;
  }

  /**
   * Find the best available worker, optionally for a specific project
   */
  private findWorker(projectQuery?: string) {
    if (projectQuery) {
      const worker = this.registry.getLeastBusyWorkerForProject(projectQuery);
      if (worker) return worker;
      console.log(
        `[SessionRouter] No worker found for project "${projectQuery}", falling back to any available worker`,
      );
    }
    return this.registry.getLeastBusyWorker();
  }

  /**
   * Enqueue a session for later assignment
   */
  private enqueueSession(
    sessionId: string,
    projectQuery: string | undefined,
    onAssigned: (workerId: string) => void,
    onTimeout: () => void,
  ): void {
    const timeoutTimer = setTimeout(() => {
      this.removeFromQueue(sessionId);
      this.emit("sessionQueueTimeout", sessionId);
      onTimeout();
    }, this.queueTimeout);

    this.pendingQueue.push({
      sessionId,
      projectQuery,
      queuedAt: new Date(),
      timeoutTimer,
      onAssigned,
      onTimeout,
    });

    const position = this.pendingQueue.length;
    console.log(
      `[SessionRouter] Session ${sessionId} queued at position ${position}`,
    );
    this.emit("sessionQueued", sessionId, position);
  }

  /**
   * Remove a session from the pending queue
   */
  private removeFromQueue(sessionId: string): void {
    const index = this.pendingQueue.findIndex((p) => p.sessionId === sessionId);
    if (index !== -1) {
      const removed = this.pendingQueue.splice(index, 1)[0];
      if (removed) {
        clearTimeout(removed.timeoutTimer);
      }
    }
  }

  /**
   * Try to assign queued sessions when workers become available
   */
  private drainQueue(): void {
    while (this.pendingQueue.length > 0) {
      const pending = this.pendingQueue[0];
      if (!pending) break;

      const worker = this.findWorker(pending.projectQuery);
      if (!worker) break; // No workers available

      // Resolve project path
      let projectPath: string | undefined;
      if (pending.projectQuery) {
        projectPath = this.registry.getProjectPath(worker.workerId, pending.projectQuery);
      }

      // Create assignment
      const assignment: SessionAssignment = {
        sessionId: pending.sessionId,
        workerId: worker.workerId,
        projectId: pending.projectQuery,
        projectPath,
        assignedAt: new Date(),
      };

      this.assignments.set(pending.sessionId, assignment);
      this.registry.addSessionToWorker(worker.workerId, pending.sessionId);

      clearTimeout(pending.timeoutTimer);
      this.pendingQueue.shift();

      console.log(
        `[SessionRouter] Dequeued session ${pending.sessionId} → worker ${worker.workerId}`,
      );
      this.emit("sessionAssigned", pending.sessionId, worker.workerId);
      this.emit("sessionDequeuedAndAssigned", pending.sessionId, worker.workerId);
      pending.onAssigned(worker.workerId);
    }
  }

  /**
   * Get the project path for an assigned session
   */
  getProjectPathForSession(sessionId: string): string | undefined {
    return this.assignments.get(sessionId)?.projectPath;
  }

  /**
   * Unassign a session from its worker
   */
  unassignSession(sessionId: string, reason: string): void {
    const assignment = this.assignments.get(sessionId);
    if (!assignment) {
      return;
    }

    this.assignments.delete(sessionId);
    this.registry.removeSessionFromWorker(assignment.workerId, sessionId);

    console.log(
      `[SessionRouter] Unassigned session ${sessionId} from worker ${assignment.workerId} (${reason})`,
    );
    this.emit("sessionUnassigned", sessionId, assignment.workerId, reason);

    // Try to drain queue since a worker may have freed up
    this.drainQueue();
  }

  /**
   * Get worker ID for a session
   */
  getWorkerForSession(sessionId: string): string | undefined {
    return this.assignments.get(sessionId)?.workerId;
  }

  /**
   * Get all sessions for a worker
   */
  getSessionsForWorker(workerId: string): string[] {
    return Array.from(this.assignments.values())
      .filter((a) => a.workerId === workerId)
      .map((a) => a.sessionId);
  }

  /**
   * Check if a session is assigned
   */
  isSessionAssigned(sessionId: string): boolean {
    return this.assignments.has(sessionId);
  }

  /**
   * Check if a session is in the pending queue
   */
  isSessionQueued(sessionId: string): boolean {
    return this.pendingQueue.some((p) => p.sessionId === sessionId);
  }

  /**
   * Get queue position for a session (1-indexed), or 0 if not queued
   */
  getQueuePosition(sessionId: string): number {
    const index = this.pendingQueue.findIndex((p) => p.sessionId === sessionId);
    return index === -1 ? 0 : index + 1;
  }

  /**
   * Handle worker disconnection
   */
  private handleWorkerDisconnected(workerId: string, reason: string): void {
    const orphanedSessions = this.getSessionsForWorker(workerId);

    for (const sessionId of orphanedSessions) {
      console.log(
        `[SessionRouter] Session ${sessionId} orphaned by worker ${workerId} disconnect`,
      );
      this.unassignSession(sessionId, `worker disconnected: ${reason}`);
      // Note: The interview store will be notified via event and can notify the user
    }
  }

  /**
   * Get assignment count
   */
  get assignmentCount(): number {
    return this.assignments.size;
  }

  /**
   * Get pending queue length
   */
  get queueLength(): number {
    return this.pendingQueue.length;
  }

  /**
   * Clear all assignments and queue
   */
  clearAll(): void {
    for (const sessionId of this.assignments.keys()) {
      this.unassignSession(sessionId, "router shutdown");
    }
    for (const pending of this.pendingQueue) {
      clearTimeout(pending.timeoutTimer);
    }
    this.pendingQueue = [];
  }
}
