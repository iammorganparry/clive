/**
 * useWorkerConnection Hook Tests
 *
 * Tests the React hook that wraps WorkerConnectionManager with XState.
 */

import { act, renderHook } from "@testing-library/react";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerConfig } from "../../types/views";

// Create a mock manager class that extends EventEmitter
class MockWorkerConnectionManager extends EventEmitter {
  status = "disconnected" as const;
  workerId = "worker-test-123";
  activeSessions: string[] = [];
  error: string | null = null;
  isConnected = false;

  configure = vi.fn();
  connect = vi.fn();
  disconnect = vi.fn();
  sendEvent = vi.fn();
  completeSession = vi.fn();
  reset = vi.fn();
  destroy = vi.fn();

  constructor(_workspaceRoot: string) {
    super();
  }
}

// Track instances for test assertions
let mockManagerInstance: MockWorkerConnectionManager | null = null;
let instanceCount = 0;

// Mock the module with a proper class
vi.mock("../../services/WorkerConnectionManager", () => {
  return {
    WorkerConnectionManager: class extends EventEmitter {
      status = "disconnected" as const;
      workerId = "worker-test-123";
      activeSessions: string[] = [];
      error: string | null = null;
      isConnected = false;

      configure = vi.fn();
      connect = vi.fn();
      disconnect = vi.fn();
      sendEvent = vi.fn();
      completeSession = vi.fn();
      reset = vi.fn();
      destroy = vi.fn();

      constructor(_workspaceRoot: string) {
        super();
        instanceCount++;
        mockManagerInstance = this as any;
      }
    },
  };
});

// Import after mocking
import { useWorkerConnection } from "../useWorkerConnection";
import { WorkerConnectionManager } from "../../services/WorkerConnectionManager";

describe("useWorkerConnection", () => {
  const workspaceRoot = "/test/workspace";
  const validConfig: WorkerConfig = {
    enabled: true,
    centralUrl: "wss://test.example.com/ws",
    token: "test-token",
    autoConnect: true,
  };

  beforeEach(() => {
    mockManagerInstance = null;
    instanceCount = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Initialization", () => {
    it("creates manager on mount", () => {
      renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      expect(instanceCount).toBe(1);
      expect(mockManagerInstance).not.toBeNull();
    });

    it("configures manager with provided config", () => {
      renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      expect(mockManagerInstance!.configure).toHaveBeenCalledWith(validConfig);
    });

    it("auto-connects when enabled and autoConnect is true", () => {
      renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      expect(mockManagerInstance!.connect).toHaveBeenCalled();
    });

    it("does not auto-connect when autoConnect is false", () => {
      const config = { ...validConfig, autoConnect: false };

      renderHook(() => useWorkerConnection(config, workspaceRoot));

      expect(mockManagerInstance!.connect).not.toHaveBeenCalled();
    });

    it("does not auto-connect when disabled", () => {
      const config = { ...validConfig, enabled: false };

      renderHook(() => useWorkerConnection(config, workspaceRoot));

      expect(mockManagerInstance!.connect).not.toHaveBeenCalled();
    });

    it("sets up event listeners on mount", () => {
      renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      // Check that listeners were registered
      expect(mockManagerInstance!.listenerCount("status")).toBeGreaterThan(0);
      expect(mockManagerInstance!.listenerCount("error")).toBeGreaterThan(0);
      expect(mockManagerInstance!.listenerCount("sessionAdded")).toBeGreaterThan(0);
      expect(mockManagerInstance!.listenerCount("sessionRemoved")).toBeGreaterThan(0);
      expect(mockManagerInstance!.listenerCount("interviewRequest")).toBeGreaterThan(0);
    });

    it("destroys manager on unmount", () => {
      const { unmount } = renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      unmount();

      expect(mockManagerInstance!.destroy).toHaveBeenCalled();
    });
  });

  describe("State Synchronization", () => {
    it("returns initial disconnected state", () => {
      const { result } = renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      expect(result.current.status).toBe("disconnected");
      expect(result.current.isConnected).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.activeSessions).toEqual([]);
    });

    it("updates status when manager emits status event", () => {
      const { result } = renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      act(() => {
        mockManagerInstance!.emit("status", "ready");
      });

      expect(result.current.status).toBe("ready");
      expect(result.current.isConnected).toBe(true);
    });

    it("updates workerId when connected", () => {
      const { result } = renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      act(() => {
        mockManagerInstance!.emit("status", "ready");
      });

      expect(result.current.workerId).toBe(mockManagerInstance!.workerId);
    });

    it("updates error when manager emits error event", () => {
      const { result } = renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      act(() => {
        mockManagerInstance!.emit("error", "Connection failed");
      });

      expect(result.current.error).toBe("Connection failed");
    });

    it("adds session when manager emits sessionAdded event", () => {
      const { result } = renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      act(() => {
        mockManagerInstance!.emit("sessionAdded", "session-123");
      });

      expect(result.current.activeSessions).toContain("session-123");
    });

    it("removes session when manager emits sessionRemoved event", () => {
      const { result } = renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      act(() => {
        mockManagerInstance!.emit("sessionAdded", "session-123");
        mockManagerInstance!.emit("sessionAdded", "session-456");
      });

      act(() => {
        mockManagerInstance!.emit("sessionRemoved", "session-123");
      });

      expect(result.current.activeSessions).not.toContain("session-123");
      expect(result.current.activeSessions).toContain("session-456");
    });
  });

  describe("Callback Forwarding", () => {
    it("forwards interviewRequest event to callback", () => {
      const onInterviewRequest = vi.fn();
      const callbacks = { onInterviewRequest };

      renderHook(() => useWorkerConnection(validConfig, workspaceRoot, callbacks));

      act(() => {
        mockManagerInstance!.emit("interviewRequest", { sessionId: "session-123" });
      });

      expect(onInterviewRequest).toHaveBeenCalledWith({ sessionId: "session-123" });
    });

    it("forwards answer event to callback", () => {
      const onAnswer = vi.fn();
      const callbacks = { onAnswer };

      renderHook(() => useWorkerConnection(validConfig, workspaceRoot, callbacks));

      act(() => {
        mockManagerInstance!.emit("answer", "session-123", "tool-456", { q1: "a1" });
      });

      expect(onAnswer).toHaveBeenCalledWith("session-123", "tool-456", { q1: "a1" });
    });

    it("forwards message event to callback", () => {
      const onMessage = vi.fn();
      const callbacks = { onMessage };

      renderHook(() => useWorkerConnection(validConfig, workspaceRoot, callbacks));

      act(() => {
        mockManagerInstance!.emit("message", "session-123", "Hello");
      });

      expect(onMessage).toHaveBeenCalledWith("session-123", "Hello");
    });

    it("forwards cancel event to callback", () => {
      const onCancel = vi.fn();
      const callbacks = { onCancel };

      renderHook(() => useWorkerConnection(validConfig, workspaceRoot, callbacks));

      act(() => {
        mockManagerInstance!.emit("cancel", "session-123");
      });

      expect(onCancel).toHaveBeenCalledWith("session-123");
    });

    it("uses updated callbacks without reconnecting", () => {
      const onInterviewRequest1 = vi.fn();
      const onInterviewRequest2 = vi.fn();

      const { rerender } = renderHook(
        ({ callbacks }) => useWorkerConnection(validConfig, workspaceRoot, callbacks),
        { initialProps: { callbacks: { onInterviewRequest: onInterviewRequest1 } } }
      );

      // Remember initial connect count
      const connectCount = mockManagerInstance!.connect.mock.calls.length;

      // Rerender with new callback
      rerender({ callbacks: { onInterviewRequest: onInterviewRequest2 } });

      // Should not have reconnected
      expect(mockManagerInstance!.connect.mock.calls.length).toBe(connectCount);

      // New callback should be used
      act(() => {
        mockManagerInstance!.emit("interviewRequest", { sessionId: "session-123" });
      });

      expect(onInterviewRequest1).not.toHaveBeenCalled();
      expect(onInterviewRequest2).toHaveBeenCalled();
    });
  });

  describe("Actions", () => {
    it("connect() resets and connects manager", () => {
      const { result } = renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      // Clear initial calls
      mockManagerInstance!.connect.mockClear();
      mockManagerInstance!.reset.mockClear();

      act(() => {
        result.current.connect();
      });

      expect(mockManagerInstance!.reset).toHaveBeenCalled();
      expect(mockManagerInstance!.connect).toHaveBeenCalled();
    });

    it("disconnect() disconnects manager", () => {
      const { result } = renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      act(() => {
        result.current.disconnect();
      });

      expect(mockManagerInstance!.disconnect).toHaveBeenCalled();
    });

    it("sendEvent() sends event to manager", () => {
      const { result } = renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      const event = {
        sessionId: "session-123",
        type: "text" as const,
        payload: { type: "text" as const, content: "Hello" },
        timestamp: new Date().toISOString(),
      };

      act(() => {
        result.current.sendEvent(event);
      });

      expect(mockManagerInstance!.sendEvent).toHaveBeenCalledWith(event);
    });

    it("completeSession() completes session on manager", () => {
      const { result } = renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      act(() => {
        result.current.completeSession("session-123");
      });

      expect(mockManagerInstance!.completeSession).toHaveBeenCalledWith("session-123");
    });
  });

  describe("Config Changes", () => {
    it("reconnects when config becomes enabled", () => {
      const disabledConfig = { ...validConfig, enabled: false };

      const { rerender } = renderHook(
        ({ config }) => useWorkerConnection(config, workspaceRoot),
        { initialProps: { config: disabledConfig } }
      );

      mockManagerInstance!.connect.mockClear();
      mockManagerInstance!.reset.mockClear();
      mockManagerInstance!.isConnected = false;

      // Enable config
      rerender({ config: validConfig });

      expect(mockManagerInstance!.configure).toHaveBeenCalledWith(validConfig);
      expect(mockManagerInstance!.reset).toHaveBeenCalled();
      expect(mockManagerInstance!.connect).toHaveBeenCalled();
    });

    it("disconnects when config becomes disabled", () => {
      const { rerender } = renderHook(
        ({ config }) => useWorkerConnection(config, workspaceRoot),
        { initialProps: { config: validConfig } }
      );

      // Simulate connected state
      mockManagerInstance!.isConnected = true;

      // Disable config
      const disabledConfig = { ...validConfig, enabled: false };
      rerender({ config: disabledConfig });

      expect(mockManagerInstance!.disconnect).toHaveBeenCalled();
    });

    it("does not reconnect when already connected", () => {
      const { rerender } = renderHook(
        ({ config }) => useWorkerConnection(config, workspaceRoot),
        { initialProps: { config: validConfig } }
      );

      // Simulate connected state
      mockManagerInstance!.isConnected = true;
      mockManagerInstance!.connect.mockClear();

      // Update config (but stay enabled)
      const newConfig = { ...validConfig, token: "new-token" };
      rerender({ config: newConfig });

      // Should configure but not reconnect
      expect(mockManagerInstance!.configure).toHaveBeenCalledWith(newConfig);
      expect(mockManagerInstance!.connect).not.toHaveBeenCalled();
    });
  });

  describe("isConnected Calculation", () => {
    it("returns true when status is ready", () => {
      const { result } = renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      act(() => {
        mockManagerInstance!.emit("status", "ready");
      });

      expect(result.current.isConnected).toBe(true);
    });

    it("returns true when status is busy", () => {
      const { result } = renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      act(() => {
        mockManagerInstance!.emit("status", "busy");
      });

      expect(result.current.isConnected).toBe(true);
    });

    it("returns false when status is disconnected", () => {
      const { result } = renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      act(() => {
        mockManagerInstance!.emit("status", "disconnected");
      });

      expect(result.current.isConnected).toBe(false);
    });

    it("returns false when status is connecting", () => {
      const { result } = renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      act(() => {
        mockManagerInstance!.emit("status", "connecting");
      });

      expect(result.current.isConnected).toBe(false);
    });
  });

  describe("Single Initialization", () => {
    it("only creates one manager instance", () => {
      const { rerender } = renderHook(() => useWorkerConnection(validConfig, workspaceRoot));

      // Rerender multiple times
      rerender();
      rerender();
      rerender();

      // Should only have created one instance
      expect(instanceCount).toBe(1);
    });
  });
});
