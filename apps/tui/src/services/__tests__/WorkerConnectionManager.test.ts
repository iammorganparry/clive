/**
 * WorkerConnectionManager Tests
 *
 * Tests the WebSocket connection lifecycle management including:
 * - Connection establishment
 * - Heartbeat management
 * - Reconnection with backoff
 * - Message handling
 * - Event emission
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerConfig } from "../../types/views";

// Track WebSocket instances for test assertions
let mockWsInstances: any[] = [];

// Mock the ws module before importing the manager
vi.mock("ws", async () => {
  // Dynamically import EventEmitter inside the factory to avoid hoisting issues
  const { EventEmitter } = await import("node:events");

  // Define MockWebSocket inside the factory
  class MockWebSocket extends EventEmitter {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = 0; // CONNECTING
    url: string;
    options: any;

    send = vi.fn();
    close = vi.fn(function (this: MockWebSocket, code?: number, reason?: string) {
      this.readyState = 3; // CLOSED
      this.emit("close", code, Buffer.from(reason || ""));
    });

    constructor(url: string, options?: any) {
      super();
      this.url = url;
      this.options = options;
      mockWsInstances.push(this);
    }

    // Helper to simulate connection open
    simulateOpen() {
      this.readyState = 1; // OPEN
      this.emit("open");
    }

    // Helper to simulate message
    simulateMessage(data: any) {
      this.emit("message", JSON.stringify(data));
    }

    // Helper to simulate close
    simulateClose(code: number, reason: string) {
      this.readyState = 3; // CLOSED
      this.emit("close", code, Buffer.from(reason));
    }

    // Helper to simulate error
    simulateError(error: Error) {
      this.emit("error", error);
    }
  }

  return { default: MockWebSocket };
});

// Import after mocking
import { WorkerConnectionManager } from "../WorkerConnectionManager";

describe("WorkerConnectionManager", () => {
  let manager: WorkerConnectionManager;
  const workspaceRoot = "/test/workspace";

  const validConfig: WorkerConfig = {
    enabled: true,
    centralUrl: "wss://test.example.com/ws",
    token: "test-token",
    autoConnect: true,
  };

  // Helper to get the latest WebSocket instance
  const getLatestWs = (): any | undefined => {
    return mockWsInstances[mockWsInstances.length - 1];
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockWsInstances = [];
    manager = new WorkerConnectionManager(workspaceRoot);
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("Initial State", () => {
    it("starts in disconnected state", () => {
      expect(manager.status).toBe("disconnected");
      expect(manager.isConnected).toBe(false);
      expect(manager.error).toBeNull();
      expect(manager.activeSessions).toEqual([]);
    });

    it("generates a unique worker ID", () => {
      expect(manager.workerId).toMatch(/^worker-[a-f0-9]{8}$/);
    });

    it("generates different IDs for different managers", () => {
      const manager2 = new WorkerConnectionManager(workspaceRoot);
      expect(manager.workerId).not.toBe(manager2.workerId);
      manager2.destroy();
    });
  });

  describe("Configuration", () => {
    it("does not connect without configuration", () => {
      manager.connect();
      expect(mockWsInstances).toHaveLength(0);
    });

    it("does not connect when disabled", () => {
      manager.configure({ ...validConfig, enabled: false });
      manager.connect();
      expect(mockWsInstances).toHaveLength(0);
    });

    it("does not connect without centralUrl", () => {
      manager.configure({ ...validConfig, centralUrl: "" });
      manager.connect();
      expect(mockWsInstances).toHaveLength(0);
    });

    it("does not connect without token", () => {
      manager.configure({ ...validConfig, token: "" });
      manager.connect();
      expect(mockWsInstances).toHaveLength(0);
    });
  });

  describe("Connection", () => {
    it("connects with valid configuration", () => {
      manager.configure(validConfig);
      manager.connect();

      const ws = getLatestWs();
      expect(ws).toBeDefined();
      expect(ws!.url).toBe(validConfig.centralUrl);
      expect(ws!.options.headers.Authorization).toBe(`Bearer ${validConfig.token}`);
    });

    it("emits connecting status when connecting", () => {
      const statusHandler = vi.fn();
      manager.on("status", statusHandler);

      manager.configure(validConfig);
      manager.connect();

      expect(statusHandler).toHaveBeenCalledWith("connecting");
    });

    it("emits ready status when connection opens", () => {
      const statusHandler = vi.fn();
      manager.on("status", statusHandler);

      manager.configure(validConfig);
      manager.connect();
      getLatestWs()!.simulateOpen();

      expect(statusHandler).toHaveBeenCalledWith("ready");
      expect(manager.status).toBe("ready");
      expect(manager.isConnected).toBe(true);
    });

    it("sends registration message on open", () => {
      manager.configure(validConfig);
      manager.connect();
      const ws = getLatestWs()!;
      ws.simulateOpen();

      expect(ws.send).toHaveBeenCalledTimes(1);
      const sentMessage = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe("register");
      expect(sentMessage.payload.workerId).toBe(manager.workerId);
      expect(sentMessage.payload.apiToken).toBe(validConfig.token);
      expect(sentMessage.payload.projects).toHaveLength(1);
      expect(sentMessage.payload.projects[0].name).toBe("workspace");
    });

    it("prevents duplicate connections", () => {
      manager.configure(validConfig);
      manager.connect();
      getLatestWs()!.simulateOpen();

      const countBefore = mockWsInstances.length;
      manager.connect(); // Try to connect again

      expect(mockWsInstances.length).toBe(countBefore); // No new instance
    });

    it("prevents connection while connecting", () => {
      manager.configure(validConfig);
      manager.connect();

      const countBefore = mockWsInstances.length;
      manager.connect(); // Try to connect again while still connecting

      expect(mockWsInstances.length).toBe(countBefore);
    });
  });

  describe("Heartbeat", () => {
    it("starts heartbeat interval on connection", () => {
      manager.configure(validConfig);
      manager.connect();
      const ws = getLatestWs()!;
      ws.simulateOpen();

      // Clear registration message
      ws.send.mockClear();

      // Advance 30 seconds (heartbeat interval)
      vi.advanceTimersByTime(30000);

      expect(ws.send).toHaveBeenCalledTimes(1);
      const sentMessage = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe("heartbeat");
      expect(sentMessage.payload.workerId).toBe(manager.workerId);
    });

    it("stops heartbeat on disconnect", () => {
      manager.configure(validConfig);
      manager.connect();
      const ws = getLatestWs()!;
      ws.simulateOpen();

      manager.disconnect();
      ws.send.mockClear();

      // Advance 30 seconds
      vi.advanceTimersByTime(30000);

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe("Message Handling", () => {
    let ws: any;

    // Valid message payloads matching the schema
    const createInterviewRequest = (sessionId: string) => ({
      type: "start_interview",
      payload: {
        sessionId,
        threadTs: "1234567890.123456",
        channel: "C123456",
        initiatorId: "U123456",
        initialPrompt: "Test prompt",
      },
    });

    beforeEach(() => {
      manager.configure(validConfig);
      manager.connect();
      ws = getLatestWs()!;
      ws.simulateOpen();
    });

    it("handles start_interview message", () => {
      const interviewHandler = vi.fn();
      const sessionAddedHandler = vi.fn();
      manager.on("interviewRequest", interviewHandler);
      manager.on("sessionAdded", sessionAddedHandler);

      ws.simulateMessage(createInterviewRequest("session-123"));

      expect(interviewHandler).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "session-123" })
      );
      expect(sessionAddedHandler).toHaveBeenCalledWith("session-123");
      expect(manager.activeSessions).toContain("session-123");
      expect(manager.status).toBe("busy");
    });

    it("handles answer message", () => {
      const answerHandler = vi.fn();
      manager.on("answer", answerHandler);

      ws.simulateMessage({
        type: "answer",
        payload: {
          sessionId: "session-123",
          toolUseId: "tool-456",
          answers: { question1: "answer1" },
        },
      });

      expect(answerHandler).toHaveBeenCalledWith(
        "session-123",
        "tool-456",
        { question1: "answer1" }
      );
    });

    it("handles message message", () => {
      const messageHandler = vi.fn();
      manager.on("message", messageHandler);

      ws.simulateMessage({
        type: "message",
        payload: {
          sessionId: "session-123",
          message: "Hello from Slack",
        },
      });

      expect(messageHandler).toHaveBeenCalledWith("session-123", "Hello from Slack");
    });

    it("handles cancel message", () => {
      // First add a session with valid payload
      ws.simulateMessage(createInterviewRequest("session-123"));

      const cancelHandler = vi.fn();
      const sessionRemovedHandler = vi.fn();
      manager.on("cancel", cancelHandler);
      manager.on("sessionRemoved", sessionRemovedHandler);

      ws.simulateMessage({
        type: "cancel",
        payload: { sessionId: "session-123" },
      });

      expect(cancelHandler).toHaveBeenCalledWith("session-123");
      expect(sessionRemovedHandler).toHaveBeenCalledWith("session-123");
      expect(manager.activeSessions).not.toContain("session-123");
      expect(manager.status).toBe("ready");
    });

    it("handles ping message with pong", () => {
      ws.send.mockClear();

      ws.simulateMessage({ type: "ping" });

      expect(ws.send).toHaveBeenCalledTimes(1);
      const sentMessage = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe("pong");
    });
  });

  describe("Disconnection", () => {
    it("emits disconnected status on close", () => {
      manager.configure(validConfig);
      manager.connect();
      const ws = getLatestWs()!;
      ws.simulateOpen();

      const statusHandler = vi.fn();
      manager.on("status", statusHandler);
      // Add error listener to prevent unhandled error (close still triggers error event)
      manager.on("error", vi.fn());

      ws.simulateClose(1000, "Normal closure");

      expect(statusHandler).toHaveBeenCalledWith("disconnected");
      expect(manager.status).toBe("disconnected");
      expect(manager.isConnected).toBe(false);
    });

    it("sets error on unexpected close", () => {
      manager.configure(validConfig);
      manager.connect();
      const ws = getLatestWs()!;
      ws.simulateOpen();

      const errorHandler = vi.fn();
      manager.on("error", errorHandler);

      ws.simulateClose(1006, "Connection lost");

      expect(errorHandler).toHaveBeenCalled();
      expect(manager.error).toContain("Disconnected");
    });

    it("does not reconnect when shutdown is intentional", () => {
      manager.configure(validConfig);
      manager.connect();
      const ws = getLatestWs()!;
      ws.simulateOpen();

      const countBefore = mockWsInstances.length;
      manager.disconnect();

      vi.advanceTimersByTime(10000); // Wait for potential reconnect

      expect(mockWsInstances.length).toBe(countBefore); // No new connections
      expect(manager.status).toBe("disconnected");
    });
  });

  describe("Reconnection", () => {
    it("attempts reconnection with exponential backoff", () => {
      manager.configure(validConfig);
      manager.connect();
      getLatestWs()!.simulateOpen();

      // Add error listener to prevent unhandled error
      manager.on("error", vi.fn());

      // Simulate unexpected close
      getLatestWs()!.simulateClose(1006, "Connection lost");

      const countBefore = mockWsInstances.length;

      // First reconnect after 5 seconds (base delay)
      vi.advanceTimersByTime(5000);
      expect(mockWsInstances.length).toBe(countBefore + 1);

      // Simulate another close
      getLatestWs()!.simulateClose(1006, "Connection lost");

      // Second reconnect after 10 seconds (2x base delay)
      vi.advanceTimersByTime(10000);
      expect(mockWsInstances.length).toBe(countBefore + 2);
    });

    it("resets reconnect attempts on successful connection", () => {
      manager.configure(validConfig);
      manager.connect();
      getLatestWs()!.simulateOpen();

      // Add error listener to prevent unhandled error
      manager.on("error", vi.fn());

      // Simulate close and reconnect
      getLatestWs()!.simulateClose(1006, "Connection lost");
      vi.advanceTimersByTime(5000);
      getLatestWs()!.simulateOpen();

      // Simulate another close - should use base delay again
      getLatestWs()!.simulateClose(1006, "Connection lost");

      const statusHandler = vi.fn();
      manager.on("status", statusHandler);

      vi.advanceTimersByTime(5000); // Base delay, not 10s
      getLatestWs()!.simulateOpen();

      expect(statusHandler).toHaveBeenCalledWith("ready");
    });

    it("can reset and reconnect after max attempts", () => {
      manager.configure(validConfig);
      manager.connect();
      getLatestWs()!.simulateOpen();

      // Add error listener to prevent unhandled error
      manager.on("error", vi.fn());

      // Exhaust all reconnect attempts (10)
      for (let i = 0; i < 10; i++) {
        getLatestWs()!.simulateClose(1006, "Connection lost");
        vi.advanceTimersByTime(5000 * Math.pow(2, i));
      }

      // One more close after max attempts
      getLatestWs()!.simulateClose(1006, "Connection lost");
      expect(manager.error).toContain("Max reconnect attempts");

      // Reset and try again
      const countBefore = mockWsInstances.length;
      manager.reset();
      manager.connect();

      expect(mockWsInstances.length).toBe(countBefore + 1);
      getLatestWs()!.simulateOpen();
      expect(manager.status).toBe("ready");
    });
  });

  describe("Session Management", () => {
    let ws: any;

    // Valid message payloads matching the schema
    const createInterviewRequest = (sessionId: string) => ({
      type: "start_interview",
      payload: {
        sessionId,
        threadTs: "1234567890.123456",
        channel: "C123456",
        initiatorId: "U123456",
        initialPrompt: "Test prompt",
      },
    });

    beforeEach(() => {
      manager.configure(validConfig);
      manager.connect();
      ws = getLatestWs()!;
      ws.simulateOpen();
    });

    it("tracks active sessions", () => {
      ws.simulateMessage(createInterviewRequest("session-1"));
      ws.simulateMessage(createInterviewRequest("session-2"));

      expect(manager.activeSessions).toEqual(["session-1", "session-2"]);
    });

    it("completes session and removes from active", () => {
      ws.simulateMessage(createInterviewRequest("session-1"));

      const sessionRemovedHandler = vi.fn();
      manager.on("sessionRemoved", sessionRemovedHandler);

      manager.completeSession("session-1");

      expect(sessionRemovedHandler).toHaveBeenCalledWith("session-1");
      expect(manager.activeSessions).not.toContain("session-1");
      expect(manager.status).toBe("ready");
    });

    it("remains busy when other sessions still active", () => {
      ws.simulateMessage(createInterviewRequest("session-1"));
      ws.simulateMessage(createInterviewRequest("session-2"));

      manager.completeSession("session-1");

      expect(manager.status).toBe("busy");
    });
  });

  describe("Event Sending", () => {
    let ws: any;

    beforeEach(() => {
      manager.configure(validConfig);
      manager.connect();
      ws = getLatestWs()!;
      ws.simulateOpen();
      ws.send.mockClear();
    });

    it("sends events to central service", () => {
      manager.sendEvent({
        sessionId: "session-123",
        type: "text",
        payload: { type: "text", content: "Hello from worker" },
        timestamp: new Date().toISOString(),
      });

      expect(ws.send).toHaveBeenCalledTimes(1);
      const sentMessage = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe("event");
      expect(sentMessage.payload.sessionId).toBe("session-123");
      expect(sentMessage.payload.payload.content).toBe("Hello from worker");
    });

    it("does not send when not connected", () => {
      manager.disconnect();
      ws.send.mockClear();

      manager.sendEvent({
        sessionId: "session-123",
        type: "text",
        payload: { type: "text", content: "Hello" },
        timestamp: new Date().toISOString(),
      });

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe("Cleanup", () => {
    it("destroys manager and cleans up resources", () => {
      manager.configure(validConfig);
      manager.connect();
      const ws = getLatestWs()!;
      ws.simulateOpen();

      manager.destroy();

      expect(manager.status).toBe("disconnected");
      expect(ws.close).toHaveBeenCalled();
    });
  });
});
