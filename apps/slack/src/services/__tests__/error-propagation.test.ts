/**
 * Tests for Error Propagation
 *
 * Verifies that Effect-based errors are properly propagated and handled.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Effect, Exit } from "effect";
import { WorkerProxy, WorkerProxyError } from "../worker-proxy";
import { WorkerRegistry } from "../worker-registry";
import { SessionRouter } from "../session-router";
import { InterviewStore } from "../../store/interview-store";

// Mock WebSocket
const createMockSocket = (readyState = 1) => ({
  send: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
  readyState,
});

describe("Error Propagation", () => {
  describe("WorkerProxyError", () => {
    let registry: WorkerRegistry;
    let router: SessionRouter;
    let proxy: WorkerProxy;
    let store: InterviewStore;

    beforeEach(() => {
      vi.useFakeTimers();
      registry = new WorkerRegistry();
      router = new SessionRouter(registry);
      proxy = new WorkerProxy(registry, router);
      store = new InterviewStore();
    });

    afterEach(() => {
      proxy.closeAll();
      registry.closeAll();
      store.closeAll();
      vi.useRealTimers();
    });

    it("fails with no_workers error when no workers available", async () => {
      const onEvent = vi.fn();

      // Try to start interview with no workers registered
      const result = await Effect.runPromiseExit(
        proxy.startInterview(
          "thread-123",
          "channel-456",
          "user-789",
          "Build a feature",
          onEvent,
        ),
      );

      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result)) {
        const error = result.cause;
        // Check if it's a WorkerProxyError with reason "no_workers"
        expect(error._tag).toBe("Fail");
        if (error._tag === "Fail") {
          const workerError = error.error as WorkerProxyError;
          expect(workerError._tag).toBe("WorkerProxyError");
          expect(workerError.reason).toBe("no_workers");
          expect(workerError.message).toContain("No workers available");
        }
      }
    });

    it("propagates error in resumeSession when no workers available", async () => {
      const onEvent = vi.fn();

      // Try to resume session with no workers
      const result = await Effect.runPromiseExit(
        proxy.resumeSession(
          "thread-123",
          "channel-456",
          "user-789",
          "Continue the conversation",
          onEvent,
          "plan",
          undefined,
          store,
        ),
      );

      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result)) {
        const error = result.cause;
        expect(error._tag).toBe("Fail");
        if (error._tag === "Fail") {
          const workerError = error.error as WorkerProxyError;
          expect(workerError._tag).toBe("WorkerProxyError");
          expect(workerError.reason).toBe("no_workers");
        }
      }
    });

    it("succeeds when worker is available", async () => {
      const socket = createMockSocket();

      // Register a worker
      registry.register(
        {
          workerId: "worker-123",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      const onEvent = vi.fn();

      const result = await Effect.runPromiseExit(
        proxy.startInterview(
          "thread-123",
          "channel-456",
          "user-789",
          "Build a feature",
          onEvent,
        ),
      );

      expect(Exit.isSuccess(result)).toBe(true);

      if (Exit.isSuccess(result)) {
        expect("workerId" in result.value && result.value.workerId).toBe("worker-123");
      }
    });

    it("catchTag allows handling specific error types", async () => {
      const onEvent = vi.fn();

      // Try to start interview with no workers, but catch the error
      const result = await Effect.runPromise(
        proxy.startInterview(
          "thread-123",
          "channel-456",
          "user-789",
          "Build a feature",
          onEvent,
        ).pipe(
          Effect.catchTag("WorkerProxyError", (error) =>
            Effect.succeed({
              workerId: "fallback",
              errorReason: error.reason,
            }),
          ),
        ),
      );

      expect("workerId" in result && result.workerId).toBe("fallback");
      expect("errorReason" in result && result.errorReason).toBe("no_workers");
    });
  });

  describe("Error type checking", () => {
    it("WorkerProxyError has correct tagged error structure", () => {
      const error = new WorkerProxyError({
        message: "Test error",
        reason: "no_workers",
      });

      expect(error._tag).toBe("WorkerProxyError");
      expect(error.message).toBe("Test error");
      expect(error.reason).toBe("no_workers");
    });

    it("WorkerProxyError supports all reason types", () => {
      const reasons = ["no_workers", "worker_not_found", "socket_closed", "session_not_found"] as const;

      for (const reason of reasons) {
        const error = new WorkerProxyError({
          message: `Error: ${reason}`,
          reason,
        });

        expect(error.reason).toBe(reason);
      }
    });
  });
});
