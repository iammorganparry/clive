/**
 * Worker Proxy
 *
 * Replaces ClaudeManager for distributed architecture.
 * Forwards interview requests to workers via WebSocket.
 */

import { EventEmitter } from "node:events";
import type {
  AnswerRequest,
  CancelRequest,
  CentralToWorkerMessage,
  InterviewEvent,
  InterviewRequest,
  MessageRequest,
  SessionMode,
} from "@clive/worker-protocol";
import { Data, Effect } from "effect";
import type { WebSocket } from "ws";
import type { InterviewStore } from "../store/interview-store";
import type { AnswerPayload } from "../store/types";
import type { SessionRouter } from "./session-router";
import type { WorkerRegistry } from "./worker-registry";

/**
 * Error when WorkerProxy operations fail
 */
export class WorkerProxyError extends Data.TaggedError("WorkerProxyError")<{
  message: string;
  reason: "no_workers" | "worker_not_found" | "socket_closed" | "session_not_found";
}> {}

/**
 * Callback for interview events
 */
type InterviewEventCallback = (event: InterviewEvent) => void;

/**
 * Pending interview info
 */
interface PendingInterview {
  sessionId: string;
  workerId: string;
  onEvent: InterviewEventCallback;
  /** Claude CLI session ID for resume support */
  claudeSessionId?: string;
}

/**
 * Worker proxy for forwarding requests to workers
 */
export class WorkerProxy extends EventEmitter {
  private registry: WorkerRegistry;
  private router: SessionRouter;
  private pendingInterviews = new Map<string, PendingInterview>();

  constructor(registry: WorkerRegistry, router: SessionRouter) {
    super();
    this.registry = registry;
    this.router = router;

    // Handle orphaned sessions
    this.router.on("sessionUnassigned", (sessionId, _workerId, reason) => {
      const pending = this.pendingInterviews.get(sessionId);
      if (pending) {
        pending.onEvent({
          sessionId,
          type: "error",
          payload: { type: "error", message: `Worker disconnected: ${reason}` },
          timestamp: new Date().toISOString(),
        });
        this.pendingInterviews.delete(sessionId);
      }
    });
  }

  /**
   * Start an interview via worker
   *
   * @param threadTs - Slack thread timestamp (session identifier)
   * @param channel - Slack channel ID
   * @param initiatorId - User who initiated the interview
   * @param initialPrompt - Initial user request/description
   * @param onEvent - Callback for interview events
   * @param projectId - Optional project ID/name for routing to specific worker
   * @param mode - Session mode: plan, build, or review (defaults to 'plan')
   * @param linearIssueUrls - Linear issue URLs for context in build/review modes
   * @param store - Optional InterviewStore for tracking session state
   */
  startInterview(
    threadTs: string,
    channel: string,
    initiatorId: string,
    initialPrompt: string,
    onEvent: InterviewEventCallback,
    projectId?: string,
    mode?: SessionMode,
    linearIssueUrls?: string[],
    store?: InterviewStore,
  ): Effect.Effect<{ workerId: string }, WorkerProxyError> {
    return Effect.gen(this, function* () {
      console.log(
        `[WorkerProxy] Starting interview for thread ${threadTs}${projectId ? ` (project: ${projectId})` : ""}`,
      );

      // Assign to worker (with project-based routing if provided)
      const workerId = this.router.assignSession(threadTs, projectId);
      if (!workerId) {
        const projectMsg = projectId
          ? ` No workers have access to project "${projectId}".`
          : "";
        return yield* Effect.fail(
          new WorkerProxyError({
            message: `No workers available.${projectMsg} Please try again later.`,
            reason: "no_workers",
          }),
        );
      }

      // Get worker socket
      const worker = this.registry.getWorker(workerId);
      if (!worker) {
        this.router.unassignSession(threadTs, "worker not found");
        return yield* Effect.fail(
          new WorkerProxyError({
            message: "Worker not found. Please try again.",
            reason: "worker_not_found",
          }),
        );
      }

      // Get the project path if we're routing to a specific project
      const projectPath = projectId
        ? this.router.getProjectPathForSession(threadTs)
        : undefined;

      // Get model based on mode (build uses sonnet, others use opus)
      const effectiveMode = mode ?? "plan";
      const model = effectiveMode === "build" ? "sonnet" : "opus";

      // Create interview request
      const request: InterviewRequest = {
        sessionId: threadTs,
        threadTs,
        channel,
        initiatorId,
        initialPrompt,
        model,
        projectId,
        mode: effectiveMode,
        linearIssueUrls,
      };

      // Track pending interview
      this.pendingInterviews.set(threadTs, {
        sessionId: threadTs,
        workerId,
        onEvent,
      });

      // Store original worker ID for resume support
      if (store) {
        store.setOriginalWorkerId(threadTs, workerId);
      }

      // Send to worker
      this.sendToWorker(worker.socket, {
        type: "start_interview",
        payload: request,
      });

      console.log(
        `[WorkerProxy] Interview ${threadTs} sent to worker ${workerId}${projectPath ? ` at ${projectPath}` : ""}`,
      );
      return { workerId };
    });
  }

  /**
   * Handle event from worker
   */
  handleWorkerEvent(event: InterviewEvent, store?: InterviewStore): void {
    const pending = this.pendingInterviews.get(event.sessionId);
    if (!pending) {
      console.warn(
        `[WorkerProxy] Event for unknown session: ${event.sessionId}`,
      );
      return;
    }

    console.log(`[WorkerProxy] Event for ${event.sessionId}: ${event.type}`);

    // Handle session_started event - store Claude session ID for resume support
    if (event.payload.type === "session_started") {
      const { claudeSessionId } = event.payload;
      pending.claudeSessionId = claudeSessionId;

      // Also update the InterviewStore if provided
      if (store) {
        store.setClaudeSessionId(event.sessionId, claudeSessionId);
        store.setOriginalWorkerId(event.sessionId, pending.workerId);
      }

      console.log(
        `[WorkerProxy] Session ${event.sessionId} started with Claude session ID: ${claudeSessionId}`,
      );
    }

    // Forward to callback
    pending.onEvent(event);

    // Clean up on completion/error
    if (
      event.type === "complete" ||
      event.type === "error" ||
      event.type === "timeout"
    ) {
      this.pendingInterviews.delete(event.sessionId);
      this.router.unassignSession(event.sessionId, event.type);
    }
  }

  /**
   * Send answer to interview question
   *
   * @param threadTs - Slack thread timestamp (session identifier)
   * @param toolUseId - Tool use ID to respond to
   * @param answers - Answers keyed by question header
   */
  sendAnswer(
    threadTs: string,
    toolUseId: string,
    answers: AnswerPayload,
  ): boolean {
    const workerId = this.router.getWorkerForSession(threadTs);
    if (!workerId) {
      console.error(`[WorkerProxy] No worker for session ${threadTs}`);
      return false;
    }

    const worker = this.registry.getWorker(workerId);
    if (!worker) {
      console.error(`[WorkerProxy] Worker ${workerId} not found`);
      return false;
    }

    const request: AnswerRequest = {
      sessionId: threadTs,
      toolUseId,
      answers,
    };

    this.sendToWorker(worker.socket, {
      type: "answer",
      payload: request,
    });

    console.log(`[WorkerProxy] Answer sent to ${workerId} for ${threadTs}`);
    return true;
  }

  /**
   * Send a follow-up message to interview
   *
   * @param threadTs - Slack thread timestamp
   * @param message - User message
   */
  sendMessage(threadTs: string, message: string): boolean {
    const workerId = this.router.getWorkerForSession(threadTs);
    if (!workerId) {
      console.error(`[WorkerProxy] No worker for session ${threadTs}`);
      return false;
    }

    const worker = this.registry.getWorker(workerId);
    if (!worker) {
      console.error(`[WorkerProxy] Worker ${workerId} not found`);
      return false;
    }

    const request: MessageRequest = {
      sessionId: threadTs,
      message,
    };

    this.sendToWorker(worker.socket, {
      type: "message",
      payload: request,
    });

    console.log(`[WorkerProxy] Message sent to ${workerId} for ${threadTs}`);
    return true;
  }

  /**
   * Cancel an interview session
   *
   * @param threadTs - Slack thread timestamp
   * @param reason - Reason for cancellation
   */
  cancelSession(threadTs: string, reason?: string): boolean {
    const workerId = this.router.getWorkerForSession(threadTs);
    if (!workerId) {
      return false;
    }

    const worker = this.registry.getWorker(workerId);
    if (!worker) {
      return false;
    }

    const request: CancelRequest = {
      sessionId: threadTs,
      reason,
    };

    this.sendToWorker(worker.socket, {
      type: "cancel",
      payload: request,
    });

    this.pendingInterviews.delete(threadTs);
    this.router.unassignSession(threadTs, reason || "cancelled");

    console.log(`[WorkerProxy] Cancelled session ${threadTs}`);
    return true;
  }

  /**
   * Check if a session has an active worker
   */
  hasActiveSession(threadTs: string): boolean {
    return this.router.isSessionAssigned(threadTs);
  }

  /**
   * Check if a session is orphaned (exists in pending but no active worker)
   */
  isSessionOrphaned(threadTs: string): boolean {
    // Session has no worker assigned in router
    return !this.router.isSessionAssigned(threadTs);
  }

  /**
   * Resume an orphaned session by reassigning to a new worker
   * Returns the new worker ID, whether true resume was possible, or an error
   *
   * True resume (using Claude CLI --resume) only works when the same worker reconnects,
   * since Claude CLI stores sessions locally on the worker's filesystem.
   */
  resumeSession(
    threadTs: string,
    channel: string,
    initiatorId: string,
    initialPrompt: string,
    onEvent: InterviewEventCallback,
    mode?: SessionMode,
    linearIssueUrls?: string[],
    store?: InterviewStore,
  ): Effect.Effect<{ workerId: string; resumed: boolean }, WorkerProxyError> {
    return Effect.gen(this, function* () {
      console.log(`[WorkerProxy] Attempting to resume session ${threadTs}`);

      // Get session state to check if we can do a true resume
      const originalWorkerId = store?.getOriginalWorkerId(threadTs);
      const claudeSessionId = store?.getClaudeSessionId(threadTs);

      // Assign to a worker (preferably the original one if available)
      const workerId = this.router.assignSession(threadTs);
      if (!workerId) {
        return yield* Effect.fail(
          new WorkerProxyError({
            message: "No workers available to resume session.",
            reason: "no_workers",
          }),
        );
      }

      // Get worker socket
      const worker = this.registry.getWorker(workerId);
      if (!worker) {
        this.router.unassignSession(threadTs, "worker not found");
        return yield* Effect.fail(
          new WorkerProxyError({
            message: "Worker not found. Please try again.",
            reason: "worker_not_found",
          }),
        );
      }

      // Check if we can do a true resume (same worker reconnected)
      const canResume = workerId === originalWorkerId && !!claudeSessionId;

      console.log(
        `[WorkerProxy] Resume check: originalWorker=${originalWorkerId}, newWorker=${workerId}, claudeSessionId=${claudeSessionId}, canResume=${canResume}`,
      );

      // Determine effective mode and model
      const effectiveMode = mode ?? "plan";
      const model = effectiveMode === "build" ? "sonnet" : "opus";

      // Create interview request
      // If same worker reconnected, include claudeSessionId for true resume
      const request: InterviewRequest = {
        sessionId: threadTs,
        threadTs,
        channel,
        initiatorId,
        initialPrompt,
        model,
        mode: effectiveMode,
        linearIssueUrls,
        claudeSessionId: canResume ? claudeSessionId : undefined,
      };

      // Track pending interview with new callback
      this.pendingInterviews.set(threadTs, {
        sessionId: threadTs,
        workerId,
        onEvent,
        claudeSessionId: canResume ? claudeSessionId : undefined,
      });

      // Send to worker
      this.sendToWorker(worker.socket, {
        type: "start_interview",
        payload: request,
      });

      if (canResume) {
        console.log(
          `[WorkerProxy] Session ${threadTs} RESUMED on original worker ${workerId} with Claude session ${claudeSessionId}`,
        );
      } else {
        console.log(
          `[WorkerProxy] Session ${threadTs} RESTARTED on worker ${workerId} (different worker or no Claude session)`,
        );
      }

      return { workerId, resumed: canResume };
    });
  }

  /**
   * Get worker ID for a session
   */
  getWorkerForSession(threadTs: string): string | undefined {
    return this.router.getWorkerForSession(threadTs);
  }

  /**
   * Send message to worker
   */
  private sendToWorker(
    socket: WebSocket,
    message: CentralToWorkerMessage,
  ): void {
    if (socket.readyState !== 1) {
      // WebSocket.OPEN
      console.error("[WorkerProxy] Cannot send - socket not open");
      return;
    }
    socket.send(JSON.stringify(message));
  }

  /**
   * Close all sessions
   */
  closeAll(): void {
    for (const sessionId of this.pendingInterviews.keys()) {
      this.cancelSession(sessionId, "server shutdown");
    }
  }

  /**
   * Get active session count
   */
  get activeSessionCount(): number {
    return this.pendingInterviews.size;
  }
}
