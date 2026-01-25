/**
 * Session Router
 *
 * Assigns interview sessions to workers and handles failover.
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
}

/**
 * Session router for distributing work to workers
 */
export class SessionRouter extends EventEmitter {
  private assignments = new Map<string, SessionAssignment>();
  private registry: WorkerRegistry;

  constructor(registry: WorkerRegistry) {
    super();
    this.registry = registry;

    // Handle worker disconnection - reassign orphaned sessions
    this.registry.on("workerDisconnected", (workerId, reason) => {
      this.handleWorkerDisconnected(workerId, reason);
    });

    this.registry.on("workerTimeout", (workerId) => {
      this.handleWorkerDisconnected(workerId, "timeout");
    });
  }

  /**
   * Assign a session to a worker
   * Returns the assigned worker ID or null if no workers available
   *
   * @param sessionId - The session ID to assign
   * @param projectQuery - Optional project name/ID to match workers against
   */
  assignSession(sessionId: string, projectQuery?: string): string | null {
    // Check if already assigned
    const existing = this.assignments.get(sessionId);
    if (existing) {
      return existing.workerId;
    }

    // Find available worker
    let worker;
    let projectPath: string | undefined;

    if (projectQuery) {
      // Try to find a worker with the specific project
      worker = this.registry.getLeastBusyWorkerForProject(projectQuery);
      if (worker) {
        projectPath = this.registry.getProjectPath(
          worker.workerId,
          projectQuery,
        );
        console.log(
          `[SessionRouter] Found worker ${worker.workerId} with project "${projectQuery}" at ${projectPath}`,
        );
      } else {
        console.log(
          `[SessionRouter] No worker found for project "${projectQuery}", falling back to any available worker`,
        );
        worker = this.registry.getLeastBusyWorker();
      }
    } else {
      // No project specified, use least busy worker
      worker = this.registry.getLeastBusyWorker();
    }

    if (!worker) {
      console.log(
        `[SessionRouter] No workers available for session ${sessionId}`,
      );
      this.emit("noWorkersAvailable", sessionId);
      return null;
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
   * Clear all assignments
   */
  clearAll(): void {
    for (const sessionId of this.assignments.keys()) {
      this.unassignSession(sessionId, "router shutdown");
    }
  }
}
