/**
 * Tests for WorkerProxy Session Resume
 *
 * Verifies that session resume correctly identifies
 * when the same worker reconnects vs a different worker.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InterviewEvent } from "@clive/worker-protocol";
import { Effect } from "effect";
import { InterviewStore } from "../../store/interview-store";
import { SessionRouter } from "../session-router";
import { WorkerProxy } from "../worker-proxy";
import { WorkerRegistry } from "../worker-registry";

// Mock WebSocket
const createMockSocket = (readyState = 1) => ({
  send: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
  readyState,
});

describe("WorkerProxy Session Resume", () => {
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

  describe("handleWorkerEvent with session_started", () => {
    it("stores Claude session ID when session_started event is received", () => {
      const socket = createMockSocket();

      // Register worker
      registry.register(
        {
          workerId: "worker-123",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      // Create session in store
      store.create("thread-123", "channel-456", "user-789");

      // Start interview
      const onEvent = vi.fn();
      router.assignSession("thread-123");

      // Manually set up the pending interview (simulating startInterview)
      (proxy as any).pendingInterviews.set("thread-123", {
        sessionId: "thread-123",
        workerId: "worker-123",
        onEvent,
      });

      // Handle session_started event
      const event: InterviewEvent = {
        sessionId: "thread-123",
        type: "session_started",
        payload: {
          type: "session_started",
          claudeSessionId: "claude-abc-123",
        },
        timestamp: new Date().toISOString(),
      };

      proxy.handleWorkerEvent(event, store);

      // Claude session ID should be stored
      expect(store.getClaudeSessionId("thread-123")).toBe("claude-abc-123");
      expect(store.getOriginalWorkerId("thread-123")).toBe("worker-123");

      // Event should be forwarded to callback
      expect(onEvent).toHaveBeenCalledWith(event);
    });
  });

  describe("resumeSession with same worker", () => {
    it("includes claudeSessionId when same worker reconnects", async () => {
      const socket = createMockSocket();

      // Register original worker
      registry.register(
        {
          workerId: "worker-123",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      // Create session with resume data
      store.create("thread-123", "channel-456", "user-789");
      store.setClaudeSessionId("thread-123", "claude-abc-123");
      store.setOriginalWorkerId("thread-123", "worker-123");

      // Resume session
      const onEvent = vi.fn();
      const result = await Effect.runPromise(
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

      expect(result).toHaveProperty("workerId", "worker-123");
      expect(result).toHaveProperty("resumed", true);

      // Verify the message sent to worker includes claudeSessionId
      expect(socket.send).toHaveBeenCalled();
      const sentMessage = JSON.parse(socket.send.mock.calls[0]?.[0]);
      expect(sentMessage.type).toBe("start_interview");
      expect(sentMessage.payload.claudeSessionId).toBe("claude-abc-123");
    });
  });

  describe("resumeSession with different worker", () => {
    it("does not include claudeSessionId when different worker is assigned", async () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      // Register workers
      registry.register(
        {
          workerId: "worker-123",
          apiToken: "test-token",
          projects: [],
        },
        socket1 as any,
      );
      registry.register(
        {
          workerId: "worker-456",
          apiToken: "test-token",
          projects: [],
        },
        socket2 as any,
      );

      // Create session with resume data from worker-123
      store.create("thread-123", "channel-456", "user-789");
      store.setClaudeSessionId("thread-123", "claude-abc-123");
      store.setOriginalWorkerId("thread-123", "worker-123");

      // Simulate worker-123 disconnecting
      registry.unregister("worker-123", "disconnected");

      // Resume session - should get worker-456 now
      const onEvent = vi.fn();
      const result = await Effect.runPromise(
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

      expect(result).toHaveProperty("workerId", "worker-456");
      expect(result).toHaveProperty("resumed", false);

      // Verify the message sent does NOT include claudeSessionId
      expect(socket2.send).toHaveBeenCalled();
      const sentMessage = JSON.parse(socket2.send.mock.calls[0]?.[0]);
      expect(sentMessage.type).toBe("start_interview");
      expect(sentMessage.payload.claudeSessionId).toBeUndefined();
    });
  });

  describe("resumeSession without store", () => {
    it("starts fresh session when no store is provided", async () => {
      const socket = createMockSocket();

      // Register worker
      registry.register(
        {
          workerId: "worker-123",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      // Resume session without store
      const onEvent = vi.fn();
      const result = await Effect.runPromise(
        proxy.resumeSession(
          "thread-123",
          "channel-456",
          "user-789",
          "Continue the conversation",
          onEvent,
          "plan",
          undefined,
          undefined, // No store
        ),
      );

      expect(result).toHaveProperty("workerId", "worker-123");
      expect(result).toHaveProperty("resumed", false);

      // Verify no claudeSessionId in message
      const sentMessage = JSON.parse(socket.send.mock.calls[0]?.[0]);
      expect(sentMessage.payload.claudeSessionId).toBeUndefined();
    });
  });

  describe("startInterview sets original worker", () => {
    it("stores originalWorkerId when starting a new interview", async () => {
      const socket = createMockSocket();

      // Register worker
      registry.register(
        {
          workerId: "worker-123",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      // Create session
      store.create("thread-123", "channel-456", "user-789");

      // Start interview with store
      const onEvent = vi.fn();
      const result = await Effect.runPromise(
        proxy.startInterview(
          "thread-123",
          "channel-456",
          "user-789",
          "Build a feature",
          onEvent,
          undefined,
          undefined,
          undefined,
          store,
        ),
      );

      expect(result).toHaveProperty("workerId", "worker-123");
      expect(store.getOriginalWorkerId("thread-123")).toBe("worker-123");
    });
  });

  describe("sendPrFeedback", () => {
    it("sends pr_feedback message to the specified worker", () => {
      const socket = createMockSocket();

      registry.register(
        {
          workerId: "worker-123",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      const onEvent = vi.fn();
      const result = proxy.sendPrFeedback(
        "worker-123",
        {
          sessionId: "feedback-session-1",
          prUrl: "https://github.com/owner/repo/pull/42",
          prNumber: 42,
          repo: "owner/repo",
          claudeSessionId: "claude-abc",
          projectId: "proj-1",
          feedbackType: "changes_requested",
          feedback: [{ author: "reviewer", body: "Fix this" }],
        },
        onEvent,
      );

      expect(result).toBe(true);
      expect(socket.send).toHaveBeenCalledTimes(1);

      const sentMessage = JSON.parse(socket.send.mock.calls[0]?.[0]);
      expect(sentMessage.type).toBe("pr_feedback");
      expect(sentMessage.payload.prNumber).toBe(42);
      expect(sentMessage.payload.claudeSessionId).toBe("claude-abc");
      expect(sentMessage.payload.feedbackType).toBe("changes_requested");
    });

    it("tracks the feedback session in pendingInterviews", () => {
      const socket = createMockSocket();

      registry.register(
        {
          workerId: "worker-123",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      const onEvent = vi.fn();
      proxy.sendPrFeedback(
        "worker-123",
        {
          sessionId: "feedback-session-1",
          prUrl: "https://github.com/owner/repo/pull/42",
          prNumber: 42,
          repo: "owner/repo",
          claudeSessionId: "claude-abc",
          feedbackType: "review_comment",
          feedback: [],
        },
        onEvent,
      );

      // Verify event routing works by simulating a worker event
      const event = {
        sessionId: "feedback-session-1",
        type: "text" as const,
        payload: { type: "text" as const, content: "Working on it..." },
        timestamp: new Date().toISOString(),
      };

      proxy.handleWorkerEvent(event);
      expect(onEvent).toHaveBeenCalledWith(event);
    });

    it("returns false when worker is not found", () => {
      const onEvent = vi.fn();
      const result = proxy.sendPrFeedback(
        "worker-nonexistent",
        {
          sessionId: "feedback-session-1",
          prUrl: "https://github.com/owner/repo/pull/42",
          prNumber: 42,
          repo: "owner/repo",
          claudeSessionId: "claude-abc",
          feedbackType: "comment",
          feedback: [],
        },
        onEvent,
      );

      expect(result).toBe(false);
    });

    it("returns false when worker socket is not open", () => {
      const socket = createMockSocket(0); // CONNECTING state, not OPEN

      registry.register(
        {
          workerId: "worker-123",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      const onEvent = vi.fn();
      const result = proxy.sendPrFeedback(
        "worker-123",
        {
          sessionId: "feedback-session-1",
          prUrl: "https://github.com/owner/repo/pull/42",
          prNumber: 42,
          repo: "owner/repo",
          claudeSessionId: "claude-abc",
          feedbackType: "comment",
          feedback: [],
        },
        onEvent,
      );

      // sendToWorker checks readyState !== 1 (OPEN)
      expect(socket.send).not.toHaveBeenCalled();
    });

    it("stores claudeSessionId in pending interview for event routing", () => {
      const socket = createMockSocket();

      registry.register(
        {
          workerId: "worker-123",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      const onEvent = vi.fn();
      proxy.sendPrFeedback(
        "worker-123",
        {
          sessionId: "feedback-session-1",
          prUrl: "https://github.com/owner/repo/pull/42",
          prNumber: 42,
          repo: "owner/repo",
          claudeSessionId: "claude-abc",
          feedbackType: "changes_requested",
          feedback: [],
        },
        onEvent,
      );

      // Access internal state to verify claudeSessionId is tracked
      const pending = (proxy as any).pendingInterviews.get("feedback-session-1");
      expect(pending).toBeDefined();
      expect(pending.claudeSessionId).toBe("claude-abc");
      expect(pending.workerId).toBe("worker-123");
    });

    it("cleans up pending interview on completion event", () => {
      const socket = createMockSocket();

      registry.register(
        {
          workerId: "worker-123",
          apiToken: "test-token",
          projects: [],
        },
        socket as any,
      );

      router.assignSession("feedback-session-1");

      const onEvent = vi.fn();
      proxy.sendPrFeedback(
        "worker-123",
        {
          sessionId: "feedback-session-1",
          prUrl: "https://github.com/owner/repo/pull/42",
          prNumber: 42,
          repo: "owner/repo",
          claudeSessionId: "claude-abc",
          feedbackType: "changes_requested",
          feedback: [],
        },
        onEvent,
      );

      // Simulate completion
      proxy.handleWorkerEvent({
        sessionId: "feedback-session-1",
        type: "complete",
        payload: { type: "complete" },
        timestamp: new Date().toISOString(),
      });

      expect((proxy as any).pendingInterviews.has("feedback-session-1")).toBe(false);
    });
  });
});
