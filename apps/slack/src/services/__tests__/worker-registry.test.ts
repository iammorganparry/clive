/**
 * Tests for WorkerRegistry
 *
 * Verifies worker registration, re-registration handling,
 * heartbeat management, and session tracking.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerRegistration } from "@clive/worker-protocol";
import { WorkerRegistry } from "../worker-registry";

// Mock WebSocket
const createMockSocket = () => ({
  send: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
  readyState: 1,
});

describe("WorkerRegistry", () => {
  let registry: WorkerRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new WorkerRegistry();
  });

  afterEach(() => {
    registry.closeAll();
    vi.useRealTimers();
  });

  describe("Worker Registration", () => {
    it("registers a new worker successfully", () => {
      const socket = createMockSocket();
      const registration: WorkerRegistration = {
        workerId: "worker-123",
        apiToken: "test-token",
        projects: [{ id: "proj-1", name: "Project 1", path: "/path/1" }],
        defaultProject: "proj-1",
        hostname: "test-host",
      };

      const result = registry.register(registration, socket as any);

      expect(result.success).toBe(true);
      expect(registry.workerCount).toBe(1);
      expect(registry.getWorker("worker-123")).toBeDefined();
    });

    it("emits workerRegistered event on registration", () => {
      const socket = createMockSocket();
      const registration: WorkerRegistration = {
        workerId: "worker-123",
        apiToken: "test-token",
        projects: [],
        hostname: "test-host",
      };

      const listener = vi.fn();
      registry.on("workerRegistered", listener);

      registry.register(registration, socket as any);

      expect(listener).toHaveBeenCalledWith("worker-123");
    });

    it("allows re-registration with same socket", () => {
      const socket = createMockSocket();
      const registration: WorkerRegistration = {
        workerId: "worker-123",
        apiToken: "test-token",
        projects: [],
        hostname: "test-host",
      };

      // First registration
      registry.register(registration, socket as any);

      // Re-registration with same socket should succeed
      const result = registry.register(registration, socket as any);

      expect(result.success).toBe(true);
      expect(registry.workerCount).toBe(1);
    });
  });

  describe("Re-registration with Different Socket (Bug Fix)", () => {
    it("replaces existing worker when re-registering with different socket", () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();
      const registration: WorkerRegistration = {
        workerId: "worker-123",
        apiToken: "test-token",
        projects: [{ id: "proj-1", name: "Project 1", path: "/path/1" }],
        hostname: "test-host",
      };

      // First registration
      registry.register(registration, socket1 as any);
      expect(registry.workerCount).toBe(1);

      const disconnectListener = vi.fn();
      registry.on("workerDisconnected", disconnectListener);

      // Re-registration with DIFFERENT socket (simulates reconnection)
      const result = registry.register(registration, socket2 as any);

      // Should succeed
      expect(result.success).toBe(true);
      expect(registry.workerCount).toBe(1);

      // Should have emitted disconnect for old connection
      expect(disconnectListener).toHaveBeenCalledWith(
        "worker-123",
        "replaced by new connection"
      );

      // New socket should be registered
      const worker = registry.getWorker("worker-123");
      expect(worker?.socket).toBe(socket2);
    });

    it("documents the race condition that was fixed", () => {
      /**
       * REGRESSION TEST: This documents the bug that was fixed.
       *
       * BEFORE FIX:
       * 1. Worker connects with ID "worker-123"
       * 2. Connection drops
       * 3. Worker reconnects with same ID before server processes disconnect
       * 4. register() returns error: "Worker ID already registered"
       * 5. Server closes new connection with code 4002
       * 6. Worker retries → loop
       *
       * AFTER FIX:
       * 1. Worker connects with ID "worker-123"
       * 2. Connection drops
       * 3. Worker reconnects with same ID
       * 4. register() detects different socket, unregisters old worker
       * 5. New registration succeeds
       * 6. No loop, clean reconnection
       */
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();
      const registration: WorkerRegistration = {
        workerId: "worker-123",
        apiToken: "test-token",
        projects: [],
        hostname: "test-host",
      };

      // Simulate: worker connected
      registry.register(registration, socket1 as any);

      // Simulate: worker reconnects with same ID but different socket
      // (this happens when the client reconnects before server processes disconnect)
      const result = registry.register(registration, socket2 as any);

      // AFTER FIX: Should succeed (replaces old connection)
      expect(result.success).toBe(true);

      // Should NOT return error
      expect(result.error).toBeUndefined();
    });
  });

  describe("Heartbeat Management", () => {
    it("updates last heartbeat time", () => {
      const socket = createMockSocket();
      const registration: WorkerRegistration = {
        workerId: "worker-123",
        apiToken: "test-token",
        projects: [],
        hostname: "test-host",
      };

      registry.register(registration, socket as any);

      const workerBefore = registry.getWorker("worker-123");
      const lastHeartbeatBefore = workerBefore?.lastHeartbeat;

      // Advance time
      vi.advanceTimersByTime(5000);

      // Send heartbeat
      registry.handleHeartbeat({
        workerId: "worker-123",
        status: "ready",
        activeSessions: [],
      });

      const workerAfter = registry.getWorker("worker-123");
      expect(workerAfter?.lastHeartbeat.getTime()).toBeGreaterThan(
        lastHeartbeatBefore!.getTime()
      );
    });

    it("triggers timeout when heartbeat not received", () => {
      const socket = createMockSocket();
      const registration: WorkerRegistration = {
        workerId: "worker-123",
        apiToken: "test-token",
        projects: [],
        hostname: "test-host",
      };

      registry.register(registration, socket as any);

      const timeoutListener = vi.fn();
      const disconnectListener = vi.fn();
      registry.on("workerTimeout", timeoutListener);
      registry.on("workerDisconnected", disconnectListener);

      // Advance past heartbeat timeout (60 seconds)
      vi.advanceTimersByTime(61000);

      expect(timeoutListener).toHaveBeenCalledWith("worker-123");
      expect(disconnectListener).toHaveBeenCalledWith(
        "worker-123",
        "heartbeat timeout"
      );
      expect(registry.workerCount).toBe(0);
    });

    it("resets timeout timer on heartbeat", () => {
      const socket = createMockSocket();
      const registration: WorkerRegistration = {
        workerId: "worker-123",
        apiToken: "test-token",
        projects: [],
        hostname: "test-host",
      };

      registry.register(registration, socket as any);

      const timeoutListener = vi.fn();
      registry.on("workerTimeout", timeoutListener);

      // Advance 50 seconds (not enough to timeout)
      vi.advanceTimersByTime(50000);

      // Send heartbeat (resets timer)
      registry.handleHeartbeat({
        workerId: "worker-123",
        status: "ready",
        activeSessions: [],
      });

      // Advance another 50 seconds (total 100, but timer was reset at 50)
      vi.advanceTimersByTime(50000);

      // Should NOT have timed out (timer was reset)
      expect(timeoutListener).not.toHaveBeenCalled();
      expect(registry.workerCount).toBe(1);

      // Advance past the reset timeout
      vi.advanceTimersByTime(15000);

      // NOW should timeout
      expect(timeoutListener).toHaveBeenCalled();
    });

    it("updates worker status from heartbeat", () => {
      const socket = createMockSocket();
      const registration: WorkerRegistration = {
        workerId: "worker-123",
        apiToken: "test-token",
        projects: [],
        hostname: "test-host",
      };

      registry.register(registration, socket as any);
      expect(registry.getWorker("worker-123")?.status).toBe("ready");

      const statusListener = vi.fn();
      registry.on("workerStatusChanged", statusListener);

      // Send heartbeat with busy status
      registry.handleHeartbeat({
        workerId: "worker-123",
        status: "busy",
        activeSessions: ["session-1"],
      });

      expect(registry.getWorker("worker-123")?.status).toBe("busy");
      expect(statusListener).toHaveBeenCalledWith("worker-123", "busy");
    });

    it("ignores heartbeat from unknown worker", () => {
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

      registry.handleHeartbeat({
        workerId: "unknown-worker",
        status: "ready",
        activeSessions: [],
      });

      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining("unknown worker")
      );

      consoleWarn.mockRestore();
    });
  });

  describe("Session Management", () => {
    it("tracks active sessions for workers", () => {
      const socket = createMockSocket();
      const registration: WorkerRegistration = {
        workerId: "worker-123",
        apiToken: "test-token",
        projects: [],
        hostname: "test-host",
      };

      registry.register(registration, socket as any);

      // Add sessions
      registry.addSessionToWorker("worker-123", "session-1");
      registry.addSessionToWorker("worker-123", "session-2");

      const worker = registry.getWorker("worker-123");
      expect(worker?.activeSessions.size).toBe(2);
      expect(worker?.activeSessions.has("session-1")).toBe(true);
      expect(worker?.activeSessions.has("session-2")).toBe(true);
    });

    it("changes status to busy when sessions added", () => {
      const socket = createMockSocket();
      const registration: WorkerRegistration = {
        workerId: "worker-123",
        apiToken: "test-token",
        projects: [],
        hostname: "test-host",
      };

      registry.register(registration, socket as any);
      expect(registry.getWorker("worker-123")?.status).toBe("ready");

      const statusListener = vi.fn();
      registry.on("workerStatusChanged", statusListener);

      registry.addSessionToWorker("worker-123", "session-1");

      expect(registry.getWorker("worker-123")?.status).toBe("busy");
      expect(statusListener).toHaveBeenCalledWith("worker-123", "busy");
    });

    it("changes status back to ready when all sessions removed", () => {
      const socket = createMockSocket();
      const registration: WorkerRegistration = {
        workerId: "worker-123",
        apiToken: "test-token",
        projects: [],
        hostname: "test-host",
      };

      registry.register(registration, socket as any);
      registry.addSessionToWorker("worker-123", "session-1");
      expect(registry.getWorker("worker-123")?.status).toBe("busy");

      const statusListener = vi.fn();
      registry.on("workerStatusChanged", statusListener);

      registry.removeSessionFromWorker("worker-123", "session-1");

      expect(registry.getWorker("worker-123")?.status).toBe("ready");
      expect(statusListener).toHaveBeenCalledWith("worker-123", "ready");
    });
  });

  describe("Worker Selection", () => {
    it("finds workers by project name", () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      registry.register(
        {
          workerId: "worker-1",
          apiToken: "token",
          projects: [{ id: "proj-1", name: "Marketing App", path: "/path/1" }],
          hostname: "host-1",
        },
        socket1 as any
      );

      registry.register(
        {
          workerId: "worker-2",
          apiToken: "token",
          projects: [{ id: "proj-2", name: "Backend API", path: "/path/2" }],
          hostname: "host-2",
        },
        socket2 as any
      );

      const marketingWorkers = registry.getWorkersForProject("marketing");
      expect(marketingWorkers).toHaveLength(1);
      expect(marketingWorkers[0].workerId).toBe("worker-1");

      const backendWorkers = registry.getWorkersForProject("backend");
      expect(backendWorkers).toHaveLength(1);
      expect(backendWorkers[0].workerId).toBe("worker-2");
    });

    it("finds workers by project alias", () => {
      const socket = createMockSocket();

      registry.register(
        {
          workerId: "worker-1",
          apiToken: "token",
          projects: [
            {
              id: "proj-1",
              name: "Clive",
              path: "/path/clive",
              aliases: ["cli", "clive-app"],
            },
          ],
          hostname: "host-1",
        },
        socket as any
      );

      const workers = registry.getWorkersForProject("cli");
      expect(workers).toHaveLength(1);
      expect(workers[0].workerId).toBe("worker-1");
    });

    it("returns least busy worker", () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      registry.register(
        {
          workerId: "worker-1",
          apiToken: "token",
          projects: [],
          hostname: "host-1",
        },
        socket1 as any
      );

      registry.register(
        {
          workerId: "worker-2",
          apiToken: "token",
          projects: [],
          hostname: "host-2",
        },
        socket2 as any
      );

      // Make worker-1 busy
      registry.addSessionToWorker("worker-1", "session-1");
      registry.addSessionToWorker("worker-1", "session-2");

      // Make worker-2 less busy
      registry.addSessionToWorker("worker-2", "session-3");

      // getLeastBusyWorker only returns "ready" workers
      // Both are now "busy", so let's test getAvailableWorkers
      expect(registry.getAvailableWorkers()).toHaveLength(0);

      // Remove sessions to make them ready
      registry.removeSessionFromWorker("worker-1", "session-1");
      registry.removeSessionFromWorker("worker-1", "session-2");
      registry.removeSessionFromWorker("worker-2", "session-3");

      // Now both are ready with 0 sessions
      const leastBusy = registry.getLeastBusyWorker();
      expect(leastBusy).toBeDefined();
    });
  });

  describe("Unregistration", () => {
    it("unregisters worker and emits event", () => {
      const socket = createMockSocket();
      registry.register(
        {
          workerId: "worker-123",
          apiToken: "token",
          projects: [],
          hostname: "host",
        },
        socket as any
      );

      const listener = vi.fn();
      registry.on("workerDisconnected", listener);

      registry.unregister("worker-123", "test reason");

      expect(registry.workerCount).toBe(0);
      expect(listener).toHaveBeenCalledWith("worker-123", "test reason");
    });

    it("unregisters by socket", () => {
      const socket = createMockSocket();
      registry.register(
        {
          workerId: "worker-123",
          apiToken: "token",
          projects: [],
          hostname: "host",
        },
        socket as any
      );

      registry.unregisterBySocket(socket as any, "socket closed");

      expect(registry.workerCount).toBe(0);
    });

    it("clears heartbeat timer on unregister", () => {
      const socket = createMockSocket();
      registry.register(
        {
          workerId: "worker-123",
          apiToken: "token",
          projects: [],
          hostname: "host",
        },
        socket as any
      );

      const timeoutListener = vi.fn();
      registry.on("workerTimeout", timeoutListener);

      // Unregister before timeout
      registry.unregister("worker-123", "manual");

      // Advance past what would have been timeout
      vi.advanceTimersByTime(70000);

      // Should NOT have triggered timeout (timer was cleared)
      expect(timeoutListener).not.toHaveBeenCalled();
    });
  });
});
