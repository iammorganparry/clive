/**
 * Worker Client Service
 *
 * Effect-TS service for managing WebSocket connection to central service.
 * Routes messages between central service and local executor.
 */

import { randomUUID } from "node:crypto";
import type {
  CentralToWorkerMessage,
  InterviewEvent,
  InterviewRequest,
  NgrokConfig,
  PrFeedbackRequest,
  PrReviewFeedback,
  WorkerHeartbeat,
  WorkerRegistration,
  WorkerStatus,
  WorkerToCentralMessage,
} from "@clive/worker-protocol";
import { CentralToWorkerMessageSchema } from "@clive/worker-protocol";
import { execSync } from "node:child_process";
import { Context, Data, Duration, Effect, Fiber, Layer, Queue, Ref, Stream } from "effect";
import WebSocket from "ws";
import type { WorkerConfig } from "./config.js";
import { LocalExecutor } from "./local-executor.js";
import { setupRepo } from "./repo-setup.js";
import { TunnelManager } from "./tunnel-manager.js";
import { WorktreeManager } from "./worktree-manager.js";

/**
 * Error when WorkerClient operations fail
 */
export class WorkerClientError extends Data.TaggedError("WorkerClientError")<{
  message: string;
  reason: "connection_failed" | "send_failed" | "already_connecting" | "shutting_down";
  cause?: unknown;
}> {}

/**
 * Worker client events emitted via queue
 */
export type WorkerClientEvent =
  | { type: "connected" }
  | { type: "disconnected"; reason: string }
  | { type: "registered"; workerId: string }
  | { type: "error"; error: Error }
  | { type: "configUpdate"; config: { ngrokConfig?: NgrokConfig } };

/**
 * Generate a unique worker ID
 */
function generateWorkerId(): string {
  return `worker-${randomUUID().slice(0, 8)}`;
}

/**
 * WorkerClient service interface
 */
export interface WorkerClientService {
  readonly connect: Effect.Effect<void, WorkerClientError>;
  readonly shutdown: Effect.Effect<void, never>;
  readonly getStatus: Effect.Effect<WorkerStatus, never>;
  readonly getWorkerId: Effect.Effect<string, never>;
  readonly getActiveSessionCount: Effect.Effect<number, never>;
  readonly getTunnelUrl: Effect.Effect<string | null, never>;
  readonly events: Stream.Stream<WorkerClientEvent, never>;
}

/**
 * WorkerClient service tag
 */
export class WorkerClient extends Context.Tag("WorkerClient")<
  WorkerClient,
  WorkerClientService
>() {}

/**
 * Internal state for the worker client
 */
interface WorkerClientState {
  ws: WebSocket | null;
  status: WorkerStatus;
  heartbeatFiber: Fiber.RuntimeFiber<void, never> | null;
  reconnectAttempts: number;
  isShuttingDown: boolean;
  isConnecting: boolean;
}

/**
 * Create WorkerClient service implementation
 */
function makeWorkerClient(
  config: WorkerConfig,
): Effect.Effect<WorkerClientService, never> {
  return Effect.gen(function* () {
    const workerId = generateWorkerId();

    // Set up repo if CLIVE_REPO configured
    const repoSetup = yield* Effect.promise(() => setupRepo(config));

    let worktreeManager: WorktreeManager | undefined;
    let workspaceRoot: string;

    if (repoSetup) {
      workspaceRoot = repoSetup.repoPath;
      worktreeManager = new WorktreeManager(
        repoSetup.repoPath,
        repoSetup.worktreeBaseDir,
      );

      // Override projects to use cloned repo path
      const repoName = config.repo!.split("/").pop()!;
      config.projects = [
        {
          id: repoName,
          name: repoName,
          path: repoSetup.repoPath,
        },
      ];
    } else {
      const defaultProject =
        config.projects.find((p) => p.id === config.defaultProject) ||
        config.projects[0];
      workspaceRoot = defaultProject.path;
    }

    const executor = new LocalExecutor(workspaceRoot, worktreeManager);
    const tunnelManager = new TunnelManager();

    // Refresh GitHub App token periodically (every 50 min — tokens last 1h)
    if (repoSetup) {
      setInterval(async () => {
        try {
          const token = await repoSetup.refreshToken();
          execSync(`echo "${token}" | gh auth login --with-token`, {
            stdio: "pipe",
          });
          console.log("[WorkerClient] GitHub App token refreshed");
        } catch (error) {
          console.error("[WorkerClient] Token refresh failed:", error);
        }
      }, 50 * 60 * 1000);
    }

    // Create mutable state ref
    const stateRef = yield* Ref.make<WorkerClientState>({
      ws: null,
      status: "disconnected",
      heartbeatFiber: null,
      reconnectAttempts: 0,
      isShuttingDown: false,
      isConnecting: false,
    });

    // Create event queue for emitting events
    const eventQueue = yield* Queue.unbounded<WorkerClientEvent>();

    // Set up tunnel event handlers
    tunnelManager.on("connected", (url) => {
      console.log(`[WorkerClient] Tunnel connected: ${url}`);
    });

    tunnelManager.on("error", (error) => {
      console.error("[WorkerClient] Tunnel error:", error);
      Effect.runFork(Queue.offer(eventQueue, { type: "error", error }));
    });

    /**
     * Send a message to central service
     */
    const send = (message: WorkerToCentralMessage): Effect.Effect<void, WorkerClientError> =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
          return yield* Effect.fail(
            new WorkerClientError({
              message: "Cannot send - not connected",
              reason: "send_failed",
            }),
          );
        }
        state.ws.send(JSON.stringify(message));
      });

    /**
     * Send an event to central service
     */
    const sendEvent = (event: InterviewEvent): Effect.Effect<void, WorkerClientError> =>
      send({ type: "event", payload: event });

    /**
     * Register with central service
     */
    const register = (): Effect.Effect<void, WorkerClientError> =>
      Effect.gen(function* () {
        const registration: WorkerRegistration = {
          workerId,
          apiToken: config.apiToken,
          projects: config.projects,
          defaultProject: config.defaultProject,
          hostname: config.hostname,
          maxConcurrentSessions: config.maxConcurrentSessions,
        };

        yield* send({ type: "register", payload: registration });

        const projectNames = config.projects.map((p) => p.name).join(", ");
        console.log(
          `[WorkerClient] Registration sent for ${workerId} with projects: [${projectNames}]`,
        );
      });

    /**
     * Send heartbeat to central service
     */
    const sendHeartbeat = (): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
          return;
        }

        const heartbeat: WorkerHeartbeat = {
          workerId,
          status: state.status,
          activeSessions: executor.getActiveSessions(),
          stats: {
            cpuUsage: process.cpuUsage().user / 1000000,
            memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
            uptime: process.uptime(),
          },
        };

        yield* send({ type: "heartbeat", payload: heartbeat }).pipe(
          Effect.catchAll(() => Effect.void),
        );
      });

    /**
     * Start heartbeat fiber
     */
    const startHeartbeat = (): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.heartbeatFiber) {
          yield* Fiber.interrupt(state.heartbeatFiber);
        }

        const fiber = yield* Effect.fork(
          Effect.forever(
            sendHeartbeat().pipe(
              Effect.andThen(Effect.sleep(Duration.millis(config.heartbeatInterval))),
            ),
          ),
        );

        yield* Ref.update(stateRef, (s) => ({ ...s, heartbeatFiber: fiber }));
      });

    /**
     * Stop heartbeat fiber
     */
    const stopHeartbeat = (): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.heartbeatFiber) {
          yield* Fiber.interrupt(state.heartbeatFiber);
          yield* Ref.update(stateRef, (s) => ({ ...s, heartbeatFiber: null }));
        }
      });

    /**
     * Handle start_interview request
     */
    const handleStartInterview = (request: InterviewRequest): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        console.log(
          `[WorkerClient] Starting interview ${request.sessionId}${request.projectId ? ` for project "${request.projectId}"` : ""}`,
        );
        // Only set "busy" when at capacity
        const sessionCount = executor.activeSessionCount + 1; // +1 for session about to start
        if (sessionCount >= config.maxConcurrentSessions) {
          yield* Ref.update(stateRef, (s) => ({ ...s, status: "busy" as WorkerStatus }));
        }

        // Find the appropriate project path
        let workspacePath: string;
        if (request.projectId) {
          const project = config.projects.find(
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
            const defProject =
              config.projects.find((p) => p.id === config.defaultProject) ||
              config.projects[0];
            workspacePath = defProject.path;
            console.log(
              `[WorkerClient] Project "${request.projectId}" not found, using default: ${workspacePath}`,
            );
          }
        } else {
          const defProject =
            config.projects.find((p) => p.id === config.defaultProject) ||
            config.projects[0];
          workspacePath = defProject.path;
        }

        executor.setWorkspace(workspacePath);

        yield* Effect.tryPromise({
          try: () =>
            executor.startInterview(request, (event) => {
              Effect.runFork(
                sendEvent(event).pipe(Effect.catchAll(() => Effect.void)),
              );
            }),
          catch: (error) => error,
        }).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              console.error(`[WorkerClient] Interview failed:`, error);
              yield* sendEvent({
                sessionId: request.sessionId,
                type: "error",
                payload: { type: "error", message: String(error) },
                timestamp: new Date().toISOString(),
              }).pipe(Effect.catchAll(() => Effect.void));
            }),
          ),
        );

        if (executor.activeSessionCount < config.maxConcurrentSessions) {
          yield* Ref.update(stateRef, (s) => ({ ...s, status: "ready" as WorkerStatus }));
        }
      });

    /**
     * Format PR review feedback into a prompt for Claude
     */
    const formatPrFeedbackPrompt = (request: PrFeedbackRequest): string => {
      const lines: string[] = [
        `You previously created PR #${request.prNumber} for ${request.repo}.`,
        `PR URL: ${request.prUrl}`,
        "",
        "The PR has received review feedback that needs to be addressed:",
        "",
      ];

      for (const fb of request.feedback) {
        lines.push(`**${fb.author}**${fb.state ? ` (${fb.state})` : ""}:`);
        if (fb.path) {
          lines.push(`  File: \`${fb.path}\`${fb.line ? `:${fb.line}` : ""}`);
        }
        lines.push(`  ${fb.body}`);
        lines.push("");
      }

      lines.push(
        "Please address each piece of feedback, push the fixes, and respond with a summary of changes made.",
        "When you're done, provide a JSON block with the following structure for each addressed comment:",
        "```json",
        '{ "summary": "Brief description of all changes", "commentReplies": [{ "commentId": <id>, "reply": "What was changed" }] }',
        "```",
      );

      return lines.join("\n");
    };

    /**
     * Handle pr_feedback request — resume original Claude session to address review feedback
     */
    const handlePrFeedback = (request: PrFeedbackRequest): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        console.log(
          `[WorkerClient] Handling PR feedback for ${request.repo}#${request.prNumber} (session: ${request.sessionId})`,
        );

        // Find the appropriate project workspace
        let workspacePath: string;
        if (request.projectId) {
          const project = config.projects.find(
            (p) =>
              p.id === request.projectId ||
              p.name.toLowerCase() === request.projectId?.toLowerCase() ||
              p.aliases?.some(
                (a: string) => a.toLowerCase() === request.projectId?.toLowerCase(),
              ),
          );
          workspacePath = project?.path ?? (config.projects.find((p) => p.id === config.defaultProject) || config.projects[0]).path;
        } else {
          workspacePath = (config.projects.find((p) => p.id === config.defaultProject) || config.projects[0]).path;
        }

        executor.setWorkspace(workspacePath);

        // Format feedback into a prompt
        const prompt = formatPrFeedbackPrompt(request);

        // Create an InterviewRequest to reuse existing startInterview infrastructure
        const interviewRequest: InterviewRequest = {
          sessionId: request.sessionId,
          threadTs: request.sessionId, // Use the feedback session ID
          channel: "", // Not needed for worker-side execution
          initiatorId: "",
          initialPrompt: prompt,
          model: "sonnet",
          projectId: request.projectId,
          mode: "build",
          claudeSessionId: request.claudeSessionId, // Resume the original session
        };

        // Only set "busy" when at capacity
        const sessionCount = executor.activeSessionCount + 1;
        if (sessionCount >= config.maxConcurrentSessions) {
          yield* Ref.update(stateRef, (s) => ({ ...s, status: "busy" as WorkerStatus }));
        }

        yield* Effect.tryPromise({
          try: () =>
            executor.startInterview(interviewRequest, (event) => {
              Effect.runFork(
                sendEvent(event).pipe(Effect.catchAll(() => Effect.void)),
              );
            }),
          catch: (error) => error,
        }).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              console.error(`[WorkerClient] PR feedback handling failed:`, error);
              yield* sendEvent({
                sessionId: request.sessionId,
                type: "error",
                payload: { type: "error", message: String(error) },
                timestamp: new Date().toISOString(),
              }).pipe(Effect.catchAll(() => Effect.void));
            }),
          ),
        );

        if (executor.activeSessionCount < config.maxConcurrentSessions) {
          yield* Ref.update(stateRef, (s) => ({ ...s, status: "ready" as WorkerStatus }));
        }
      });

    /**
     * Set up tunnel with provided config
     */
    const setupTunnel = (ngrokConfig: NgrokConfig): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        console.log("[WorkerClient] Setting up tunnel with provided config...");
        tunnelManager.setConfig(ngrokConfig);
        const url = yield* Effect.tryPromise(() => tunnelManager.connect()).pipe(
          Effect.catchAll(() => Effect.succeed(null)),
        );
        if (url) {
          console.log(`[WorkerClient] Tunnel URL: ${url}`);
        }
      });

    /**
     * Handle incoming message from central service
     */
    const handleMessage = (data: string): Effect.Effect<void, never> =>
      Effect.gen(function* () {
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
              yield* handleStartInterview(message.payload as InterviewRequest);
              break;

            case "answer": {
              const answerPayload = message.payload as {
                sessionId: string;
                toolUseId: string;
                answers: Record<string, string>;
              };
              executor.sendAnswer(
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
              executor.sendMessage(msgPayload.sessionId, msgPayload.message);
              break;
            }

            case "cancel": {
              const cancelPayload = message.payload as { sessionId: string };
              executor.cancelSession(cancelPayload.sessionId);
              break;
            }

            case "pr_feedback": {
              const prFeedbackPayload = message.payload as PrFeedbackRequest;
              yield* handlePrFeedback(prFeedbackPayload);
              break;
            }

            case "ping":
              yield* send({ type: "pong" }).pipe(Effect.catchAll(() => Effect.void));
              break;

            case "config_update": {
              const configPayload = message.payload as {
                ngrokConfig?: NgrokConfig;
              };
              yield* Queue.offer(eventQueue, { type: "configUpdate", config: configPayload });
              if (configPayload.ngrokConfig) {
                yield* setupTunnel(configPayload.ngrokConfig);
              }
              break;
            }
          }
        } catch (error) {
          console.error("[WorkerClient] Failed to parse message:", error);
        }
      });

    /**
     * Handle disconnection
     */
    const handleDisconnect = (reason: string): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        yield* Ref.update(stateRef, (s) => ({ ...s, status: "disconnected" as WorkerStatus }));
        yield* stopHeartbeat();

        const state = yield* Ref.get(stateRef);
        if (state.isShuttingDown) {
          return;
        }

        yield* Queue.offer(eventQueue, { type: "disconnected", reason });

        // Attempt reconnection
        if (state.reconnectAttempts < config.maxReconnectAttempts) {
          const attempts = state.reconnectAttempts + 1;
          yield* Ref.update(stateRef, (s) => ({ ...s, reconnectAttempts: attempts }));
          const delay = config.reconnectDelay * 2 ** (attempts - 1);
          console.log(
            `[WorkerClient] Reconnecting in ${delay}ms (attempt ${attempts})`,
          );

          yield* Effect.fork(
            Effect.sleep(Duration.millis(delay)).pipe(
              Effect.andThen(connect),
              Effect.catchAll((error) =>
                Effect.sync(() =>
                  console.error("[WorkerClient] Reconnection failed:", error),
                ),
              ),
            ),
          );
        } else {
          console.error("[WorkerClient] Max reconnect attempts reached");
        }
      });

    /**
     * Connect to central service
     */
    const connect: Effect.Effect<void, WorkerClientError> = Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);

      if (state.isShuttingDown) {
        return yield* Effect.fail(
          new WorkerClientError({
            message: "Worker is shutting down",
            reason: "shutting_down",
          }),
        );
      }

      if (state.isConnecting) {
        console.log("[WorkerClient] Connection already in progress, skipping");
        return yield* Effect.fail(
          new WorkerClientError({
            message: "Connection already in progress",
            reason: "already_connecting",
          }),
        );
      }

      // Clean up existing connection
      if (state.ws) {
        console.log("[WorkerClient] Cleaning up existing connection");
        state.ws.removeAllListeners();
        if (
          state.ws.readyState === WebSocket.OPEN ||
          state.ws.readyState === WebSocket.CONNECTING
        ) {
          state.ws.close(1000, "Reconnecting");
        }
      }

      yield* Ref.update(stateRef, (s) => ({
        ...s,
        ws: null,
        isConnecting: true,
        status: "connecting" as WorkerStatus,
      }));

      console.log(`[WorkerClient] Connecting to ${config.centralServiceUrl}...`);

      yield* Effect.async<void, WorkerClientError>((resume) => {
        try {
          const ws = new WebSocket(config.centralServiceUrl, {
            headers: {
              Authorization: `Bearer ${config.apiToken}`,
            },
          });

          ws.on("open", () => {
            console.log("[WorkerClient] WebSocket connected");
            Effect.runFork(
              Effect.gen(function* () {
                yield* Ref.update(stateRef, (s) => ({
                  ...s,
                  ws,
                  isConnecting: false,
                  reconnectAttempts: 0,
                }));
                yield* register().pipe(Effect.catchAll(() => Effect.void));
                yield* startHeartbeat();
                yield* Queue.offer(eventQueue, { type: "connected" });
                resume(Effect.void);
              }),
            );
          });

          ws.on("message", (data) => {
            Effect.runFork(handleMessage(data.toString()));
          });

          ws.on("close", (code, reason) => {
            console.log(`[WorkerClient] WebSocket closed: ${code} ${reason}`);
            Effect.runFork(
              Effect.gen(function* () {
                yield* Ref.update(stateRef, (s) => ({ ...s, isConnecting: false }));
                yield* handleDisconnect(reason.toString());
              }),
            );
          });

          ws.on("error", (error) => {
            console.error("[WorkerClient] WebSocket error:", error);
            Effect.runFork(
              Effect.gen(function* () {
                yield* Ref.update(stateRef, (s) => ({ ...s, isConnecting: false }));
                yield* Queue.offer(eventQueue, { type: "error", error });
              }),
            );
            resume(
              Effect.fail(
                new WorkerClientError({
                  message: `WebSocket error: ${error.message}`,
                  reason: "connection_failed",
                  cause: error,
                }),
              ),
            );
          });
        } catch (error) {
          Effect.runFork(
            Ref.update(stateRef, (s) => ({ ...s, isConnecting: false })),
          );
          resume(
            Effect.fail(
              new WorkerClientError({
                message: `Failed to create WebSocket: ${String(error)}`,
                reason: "connection_failed",
                cause: error,
              }),
            ),
          );
        }
      });
    });

    /**
     * Graceful shutdown
     */
    const shutdown: Effect.Effect<void, never> = Effect.gen(function* () {
      console.log("[WorkerClient] Shutting down...");
      yield* Ref.update(stateRef, (s) => ({ ...s, isShuttingDown: true }));

      yield* stopHeartbeat();
      executor.closeAll();

      yield* Effect.tryPromise(() => tunnelManager.disconnect()).pipe(
        Effect.catchAll(() => Effect.void),
      );

      const state = yield* Ref.get(stateRef);
      if (state.ws) {
        state.ws.close(1000, "Worker shutting down");
        yield* Ref.update(stateRef, (s) => ({ ...s, ws: null }));
      }

      console.log("[WorkerClient] Shutdown complete");
    });

    // Return the service implementation
    return {
      connect,
      shutdown,
      getStatus: Ref.get(stateRef).pipe(Effect.map((s) => s.status)),
      getWorkerId: Effect.succeed(workerId),
      getActiveSessionCount: Effect.succeed(executor.activeSessionCount),
      getTunnelUrl: Effect.succeed(tunnelManager.getUrl()),
      events: Stream.fromQueue(eventQueue),
    };
  });
}

/**
 * Create WorkerClient layer from config
 */
export const makeWorkerClientLayer = (
  config: WorkerConfig,
): Layer.Layer<WorkerClient, never, never> =>
  Layer.effect(WorkerClient, makeWorkerClient(config));
