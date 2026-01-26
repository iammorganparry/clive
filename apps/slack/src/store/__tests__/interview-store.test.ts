/**
 * Tests for InterviewStore
 *
 * Verifies session management, phase tracking,
 * and session resume functionality.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InterviewStore } from "../interview-store";

describe("InterviewStore", () => {
  let store: InterviewStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new InterviewStore();
  });

  afterEach(() => {
    store.closeAll();
    vi.useRealTimers();
  });

  describe("Session Creation", () => {
    it("creates a new session", () => {
      const session = store.create(
        "thread-123",
        "channel-456",
        "user-789",
        "Build a feature",
      );

      expect(session.threadTs).toBe("thread-123");
      expect(session.channel).toBe("channel-456");
      expect(session.initiatorId).toBe("user-789");
      expect(session.initialDescription).toBe("Build a feature");
      expect(session.phase).toBe("greeting");
      expect(session.mode).toBe("greeting");
    });

    it("retrieves an existing session", () => {
      store.create("thread-123", "channel-456", "user-789");
      const session = store.get("thread-123");

      expect(session).toBeDefined();
      expect(session?.threadTs).toBe("thread-123");
    });

    it("returns undefined for non-existent session", () => {
      const session = store.get("non-existent");
      expect(session).toBeUndefined();
    });
  });

  describe("Session Resume Fields", () => {
    it("sets and gets Claude session ID", () => {
      store.create("thread-123", "channel-456", "user-789");

      store.setClaudeSessionId("thread-123", "claude-session-abc");

      expect(store.getClaudeSessionId("thread-123")).toBe("claude-session-abc");
    });

    it("sets and gets original worker ID", () => {
      store.create("thread-123", "channel-456", "user-789");

      store.setOriginalWorkerId("thread-123", "worker-xyz");

      expect(store.getOriginalWorkerId("thread-123")).toBe("worker-xyz");
    });

    it("returns undefined for Claude session ID on non-existent session", () => {
      expect(store.getClaudeSessionId("non-existent")).toBeUndefined();
    });

    it("returns undefined for original worker ID on non-existent session", () => {
      expect(store.getOriginalWorkerId("non-existent")).toBeUndefined();
    });

    it("preserves resume fields through session lifecycle", () => {
      store.create("thread-123", "channel-456", "user-789");
      store.setClaudeSessionId("thread-123", "claude-session-abc");
      store.setOriginalWorkerId("thread-123", "worker-xyz");

      // Update other fields
      store.setPhase("thread-123", "problem");
      store.setMode("thread-123", "plan");
      store.setWorkerId("thread-123", "worker-new");

      // Resume fields should be preserved
      expect(store.getClaudeSessionId("thread-123")).toBe("claude-session-abc");
      expect(store.getOriginalWorkerId("thread-123")).toBe("worker-xyz");
    });

    it("clears resume fields when session is closed", () => {
      store.create("thread-123", "channel-456", "user-789");
      store.setClaudeSessionId("thread-123", "claude-session-abc");
      store.setOriginalWorkerId("thread-123", "worker-xyz");

      store.close("thread-123");

      expect(store.getClaudeSessionId("thread-123")).toBeUndefined();
      expect(store.getOriginalWorkerId("thread-123")).toBeUndefined();
    });
  });

  describe("Worker ID Tracking", () => {
    it("sets and gets worker ID", () => {
      store.create("thread-123", "channel-456", "user-789");

      store.setWorkerId("thread-123", "worker-abc");

      expect(store.getWorkerId("thread-123")).toBe("worker-abc");
    });

    it("distinguishes between current worker and original worker", () => {
      store.create("thread-123", "channel-456", "user-789");

      // Original worker starts the session
      store.setWorkerId("thread-123", "worker-original");
      store.setOriginalWorkerId("thread-123", "worker-original");
      store.setClaudeSessionId("thread-123", "claude-session-123");

      // Simulate worker reconnection - new worker assigned
      store.setWorkerId("thread-123", "worker-new");

      // Current worker is new, but original is preserved
      expect(store.getWorkerId("thread-123")).toBe("worker-new");
      expect(store.getOriginalWorkerId("thread-123")).toBe("worker-original");
    });
  });

  describe("Phase and Mode Tracking", () => {
    it("updates session phase", () => {
      store.create("thread-123", "channel-456", "user-789");

      store.setPhase("thread-123", "problem");

      const session = store.get("thread-123");
      expect(session?.phase).toBe("problem");
    });

    it("updates session mode", () => {
      store.create("thread-123", "channel-456", "user-789");

      store.setMode("thread-123", "plan");

      expect(store.getMode("thread-123")).toBe("plan");
    });
  });

  describe("Initiator Verification", () => {
    it("correctly identifies the initiator", () => {
      store.create("thread-123", "channel-456", "user-789");

      expect(store.isInitiator("thread-123", "user-789")).toBe(true);
      expect(store.isInitiator("thread-123", "other-user")).toBe(false);
    });
  });
});
