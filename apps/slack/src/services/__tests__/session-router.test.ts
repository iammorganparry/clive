/**
 * Tests for SessionRouter
 *
 * Verifies session assignment, unassignment, and worker disconnection handling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionRouter } from "../session-router";
import { WorkerRegistry } from "../worker-registry";

// Mock WebSocket
const createMockSocket = (readyState = 1) => ({
  send: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
  readyState,
});

describe("SessionRouter", () => {
  let registry: WorkerRegistry;
  let router: SessionRouter;

  beforeEach(() => {
    vi.useFakeTimers();
    // Create fresh instances for each test
    registry = new WorkerRegistry();
    router = new SessionRouter(registry);
  });

  afterEach(() => {
    // Clean up all router state first
    router.clearAll();
    // Then clean up registry
    registry.closeAll();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("Session Assignment", () => {
    it("assigns session to available worker", () => {
      const socket = createMockSocket();

      registry.register(
        {
          workerId: "worker-123",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      const workerId = router.assignSession("session-1");

      expect(workerId).toBe("worker-123");
      expect(router.isSessionAssigned("session-1")).toBe(true);
      expect(router.getWorkerForSession("session-1")).toBe("worker-123");
    });

    it("returns existing assignment if session already assigned", () => {
      const socket = createMockSocket();

      registry.register(
        {
          workerId: "worker-123",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      const firstAssignment = router.assignSession("session-1");
      const secondAssignment = router.assignSession("session-1");

      expect(firstAssignment).toBe("worker-123");
      expect(secondAssignment).toBe("worker-123");
      expect(router.assignmentCount).toBe(1);
    });

    it("returns null when no workers available", () => {
      const eventHandler = vi.fn();
      router.on("noWorkersAvailable", eventHandler);

      const workerId = router.assignSession("session-1");

      expect(workerId).toBeNull();
      expect(router.isSessionAssigned("session-1")).toBe(false);
      expect(eventHandler).toHaveBeenCalledWith("session-1");
    });

    it("assigns to least busy worker", () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      registry.register(
        {
          workerId: "worker-1",
          apiToken: "test-token",
          projects: [],
        },
        socket1 as any,
      );
      registry.register(
        {
          workerId: "worker-2",
          apiToken: "test-token",
          projects: [],
        },
        socket2 as any,
      );

      // Assign first session
      router.assignSession("session-1");

      // Worker-1 now has 1 session, so session-2 should go to worker-2
      const secondWorkerId = router.assignSession("session-2");

      expect(secondWorkerId).toBe("worker-2");
    });

    it("emits sessionAssigned event", () => {
      const socket = createMockSocket();
      const eventHandler = vi.fn();
      router.on("sessionAssigned", eventHandler);

      registry.register(
        {
          workerId: "worker-123",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      router.assignSession("session-1");

      expect(eventHandler).toHaveBeenCalledWith("session-1", "worker-123");
    });
  });

  describe("Session Assignment with Project Query", () => {
    it("assigns to worker with matching project", () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      registry.register(
        {
          workerId: "worker-1",
          apiToken: "test-token",
          projects: [{ id: "proj-1", name: "Frontend App", path: "/app/frontend" }],
        },
        socket1 as any,
      );
      registry.register(
        {
          workerId: "worker-2",
          apiToken: "test-token",
          projects: [{ id: "proj-2", name: "Backend API", path: "/app/backend" }],
        },
        socket2 as any,
      );

      const workerId = router.assignSession("session-1", "Backend");

      expect(workerId).toBe("worker-2");
      expect(router.getProjectPathForSession("session-1")).toBe("/app/backend");
    });

    it("falls back to any worker when project not found", () => {
      const socket = createMockSocket();

      registry.register(
        {
          workerId: "worker-1",
          apiToken: "test-token",
          projects: [{ id: "proj-1", name: "Some Project", path: "/path" }],
        },
        socket as any,
      );

      const workerId = router.assignSession("session-1", "nonexistent-project");

      expect(workerId).toBe("worker-1");
      expect(router.getProjectPathForSession("session-1")).toBeUndefined();
    });
  });

  describe("Session Unassignment", () => {
    it("unassigns session from worker", () => {
      const socket = createMockSocket();

      registry.register(
        {
          workerId: "worker-123",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      router.assignSession("session-1");
      router.unassignSession("session-1", "test reason");

      expect(router.isSessionAssigned("session-1")).toBe(false);
      expect(router.getWorkerForSession("session-1")).toBeUndefined();
      expect(router.assignmentCount).toBe(0);
    });

    it("emits sessionUnassigned event", () => {
      const socket = createMockSocket();
      const eventHandler = vi.fn();
      router.on("sessionUnassigned", eventHandler);

      registry.register(
        {
          workerId: "worker-123",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      router.assignSession("session-1");
      router.unassignSession("session-1", "test reason");

      expect(eventHandler).toHaveBeenCalledWith("session-1", "worker-123", "test reason");
    });

    it("does nothing if session not assigned", () => {
      const eventHandler = vi.fn();
      router.on("sessionUnassigned", eventHandler);

      router.unassignSession("nonexistent-session", "test reason");

      expect(eventHandler).not.toHaveBeenCalled();
    });
  });

  describe("Worker Disconnection Handling", () => {
    it("unassigns session when worker disconnects", () => {
      const socket = createMockSocket();
      const eventHandler = vi.fn();
      router.on("sessionUnassigned", eventHandler);

      registry.register(
        {
          workerId: "worker-disconnect-test",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      const workerId = router.assignSession("session-disconnect-1");
      expect(workerId).toBe("worker-disconnect-test");

      // Simulate worker disconnect
      registry.unregister("worker-disconnect-test", "connection lost");

      expect(router.isSessionAssigned("session-disconnect-1")).toBe(false);
      expect(eventHandler).toHaveBeenCalledTimes(1);
      expect(eventHandler).toHaveBeenCalledWith(
        "session-disconnect-1",
        "worker-disconnect-test",
        expect.stringContaining("connection lost"),
      );
    });

    it("handles heartbeat timeout disconnection", () => {
      const socket = createMockSocket();
      const eventHandler = vi.fn();
      router.on("sessionUnassigned", eventHandler);

      registry.register(
        {
          workerId: "worker-123",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      router.assignSession("session-1");

      // Advance past heartbeat timeout
      vi.advanceTimersByTime(60001);

      expect(router.isSessionAssigned("session-1")).toBe(false);
      expect(eventHandler).toHaveBeenCalledWith(
        "session-1",
        "worker-123",
        expect.stringContaining("heartbeat timeout"),
      );
    });
  });

  describe("Session Queries", () => {
    it("gets session for a worker", () => {
      const socket = createMockSocket();

      registry.register(
        {
          workerId: "worker-query-test",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      const workerId = router.assignSession("session-query-1");
      expect(workerId).toBe("worker-query-test");

      const sessions = router.getSessionsForWorker("worker-query-test");

      expect(sessions).toHaveLength(1);
      expect(sessions).toContain("session-query-1");
    });

    it("returns sessions for multiple workers", () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      registry.register(
        {
          workerId: "worker-1",
          apiToken: "test-token",
          projects: [],
        },
        socket1 as any,
      );
      registry.register(
        {
          workerId: "worker-2",
          apiToken: "test-token",
          projects: [],
        },
        socket2 as any,
      );

      const workerId1 = router.assignSession("session-1");
      const workerId2 = router.assignSession("session-2");

      expect(workerId1).toBe("worker-1");
      expect(workerId2).toBe("worker-2");

      expect(router.getSessionsForWorker("worker-1")).toContain("session-1");
      expect(router.getSessionsForWorker("worker-2")).toContain("session-2");
    });

    it("returns empty array for worker with no sessions", () => {
      const sessions = router.getSessionsForWorker("nonexistent-worker");

      expect(sessions).toHaveLength(0);
    });
  });

  describe("Clear All", () => {
    it("clears all assignments", () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();
      const eventHandler = vi.fn();
      router.on("sessionUnassigned", eventHandler);

      registry.register(
        {
          workerId: "worker-1",
          apiToken: "test-token",
          projects: [],
        },
        socket1 as any,
      );
      registry.register(
        {
          workerId: "worker-2",
          apiToken: "test-token",
          projects: [],
        },
        socket2 as any,
      );

      router.assignSession("session-1");
      router.assignSession("session-2");

      expect(router.assignmentCount).toBe(2);

      router.clearAll();

      expect(router.assignmentCount).toBe(0);
      expect(eventHandler).toHaveBeenCalledTimes(2);
    });
  });
});
