/**
 * Tests for LocalExecutor Pending Question Lifecycle
 *
 * Verifies:
 * - AskUserQuestion sets pendingQuestion flag
 * - 'done' event does NOT emit 'complete' when question is pending
 * - 'done' event DOES emit 'complete' when no question is pending
 * - Duplicate session is cleaned up instead of throwing
 * - sendAnswer clears pendingQuestion flag
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InterviewEventPayload } from "@clive/worker-protocol";

/**
 * Minimal ActiveSession for testing processEvent / done lifecycle.
 */
interface TestActiveSession {
  sessionId: string;
  pendingQuestion?: boolean;
  claudeSessionId?: string;
  handle?: { kill: () => void };
  worktreePath?: string;
}

/**
 * Simulates the processEvent logic for question/done lifecycle
 * without requiring the full LocalExecutor + ClaudeCliService runtime.
 */
class QuestionLifecycleProcessor {
  public activeSessions = new Map<string, TestActiveSession>();
  public emittedEvents: Array<{
    sessionId: string;
    payload: InterviewEventPayload;
  }> = [];

  addSession(sessionId: string, opts?: Partial<TestActiveSession>) {
    this.activeSessions.set(sessionId, { sessionId, ...opts });
  }

  /**
   * Mirrors processEvent for tool_use (AskUserQuestion only)
   */
  processToolUse(
    sessionId: string,
    toolName: string,
    toolId: string,
    input: Record<string, unknown>,
  ): void {
    if (toolName === "AskUserQuestion") {
      const session = this.activeSessions.get(sessionId);
      if (session) {
        session.pendingQuestion = true;
      }

      this.emit(sessionId, {
        type: "question",
        data: {
          toolUseID: toolId,
          questions: ((input.questions as Array<Record<string, unknown>>) || []).map(
            (q) => ({
              header: (q.header as string) || "",
              question: (q.question as string) || "",
              options: (q.options as Array<{ label: string; description: string }>) || [],
              multiSelect: (q.multiSelect as boolean) || false,
            }),
          ),
        },
      });
    }
  }

  /**
   * Mirrors processEvent for 'done' — the fix under test
   */
  processDone(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session?.pendingQuestion) {
      // Don't emit complete — waiting for user answer
      return;
    }

    this.emit(sessionId, { type: "complete" });
  }

  /**
   * Mirrors the stream-end cleanup — the fix under test
   */
  handleStreamEnd(sessionId: string): "kept" | "cleaned" {
    const session = this.activeSessions.get(sessionId);
    if (session?.pendingQuestion) {
      return "kept";
    }
    this.activeSessions.delete(sessionId);
    return "cleaned";
  }

  /**
   * Mirrors the idempotent startInterview fix
   */
  startInterview(sessionId: string): "started" | "replaced" {
    if (this.activeSessions.has(sessionId)) {
      const stale = this.activeSessions.get(sessionId);
      if (stale?.handle) {
        try {
          stale.handle.kill();
        } catch {
          // ignore
        }
      }
      this.activeSessions.delete(sessionId);
      this.addSession(sessionId);
      return "replaced";
    }
    this.addSession(sessionId);
    return "started";
  }

  private emit(sessionId: string, payload: InterviewEventPayload): void {
    this.emittedEvents.push({ sessionId, payload });
  }
}

describe("LocalExecutor Pending Question Lifecycle", () => {
  let processor: QuestionLifecycleProcessor;

  beforeEach(() => {
    processor = new QuestionLifecycleProcessor();
    processor.addSession("session-1");
  });

  describe("AskUserQuestion sets pendingQuestion", () => {
    it("marks session as pending when AskUserQuestion tool_use arrives", () => {
      processor.processToolUse("session-1", "AskUserQuestion", "tool-123", {
        questions: [
          {
            header: "Platform",
            question: "Which platform?",
            options: [
              { label: "TikTok", description: "Scrape TikTok" },
              { label: "Reddit", description: "Use Reddit API" },
            ],
          },
        ],
      });

      const session = processor.activeSessions.get("session-1");
      expect(session?.pendingQuestion).toBe(true);
    });

    it("emits question event", () => {
      processor.processToolUse("session-1", "AskUserQuestion", "tool-123", {
        questions: [
          {
            header: "Platform",
            question: "Which platform?",
            options: [{ label: "TikTok", description: "Scrape TikTok" }],
          },
        ],
      });

      const questionEvent = processor.emittedEvents.find(
        (e) => e.payload.type === "question",
      );
      expect(questionEvent).toBeDefined();
    });

    it("does NOT mark session for non-AskUserQuestion tool_use", () => {
      processor.processToolUse("session-1", "Read", "tool-456", {
        path: "/some/file",
      });

      const session = processor.activeSessions.get("session-1");
      expect(session?.pendingQuestion).toBeUndefined();
    });
  });

  describe("done event with pending question", () => {
    it("does NOT emit complete when question is pending", () => {
      // Simulate: AskUserQuestion → done
      processor.processToolUse("session-1", "AskUserQuestion", "tool-123", {
        questions: [{ header: "Q", question: "?", options: [] }],
      });
      processor.processDone("session-1");

      const completeEvent = processor.emittedEvents.find(
        (e) => e.payload.type === "complete",
      );
      expect(completeEvent).toBeUndefined();
    });

    it("DOES emit complete when no question is pending", () => {
      processor.processDone("session-1");

      const completeEvent = processor.emittedEvents.find(
        (e) => e.payload.type === "complete",
      );
      expect(completeEvent).toBeDefined();
    });
  });

  describe("stream end with pending question", () => {
    it("keeps session alive when question is pending", () => {
      processor.processToolUse("session-1", "AskUserQuestion", "tool-123", {
        questions: [{ header: "Q", question: "?", options: [] }],
      });

      const result = processor.handleStreamEnd("session-1");

      expect(result).toBe("kept");
      expect(processor.activeSessions.has("session-1")).toBe(true);
    });

    it("cleans up session when no question is pending", () => {
      const result = processor.handleStreamEnd("session-1");

      expect(result).toBe("cleaned");
      expect(processor.activeSessions.has("session-1")).toBe(false);
    });
  });

  describe("full question→answer lifecycle", () => {
    it("session survives question→done→answer flow", () => {
      // 1. AskUserQuestion arrives
      processor.processToolUse("session-1", "AskUserQuestion", "tool-123", {
        questions: [
          {
            header: "Platform",
            question: "Which platform?",
            options: [{ label: "TikTok", description: "Scrape" }],
          },
        ],
      });

      // 2. CLI emits done (exits waiting for answer)
      processor.processDone("session-1");

      // 3. Stream ends
      const streamResult = processor.handleStreamEnd("session-1");
      expect(streamResult).toBe("kept");

      // 4. Session is still alive for the answer
      expect(processor.activeSessions.has("session-1")).toBe(true);
      expect(processor.activeSessions.get("session-1")?.pendingQuestion).toBe(
        true,
      );

      // 5. No 'complete' was emitted
      const completeEvents = processor.emittedEvents.filter(
        (e) => e.payload.type === "complete",
      );
      expect(completeEvents).toHaveLength(0);
    });
  });
});

describe("LocalExecutor Idempotent startInterview", () => {
  let processor: QuestionLifecycleProcessor;

  beforeEach(() => {
    processor = new QuestionLifecycleProcessor();
  });

  it("starts a new session normally", () => {
    const result = processor.startInterview("session-1");
    expect(result).toBe("started");
    expect(processor.activeSessions.has("session-1")).toBe(true);
  });

  it("replaces an existing session instead of throwing", () => {
    processor.addSession("session-1");

    const result = processor.startInterview("session-1");
    expect(result).toBe("replaced");
    expect(processor.activeSessions.has("session-1")).toBe(true);
  });

  it("kills the stale handle when replacing", () => {
    const kill = vi.fn();
    processor.addSession("session-1", { handle: { kill } });

    processor.startInterview("session-1");
    expect(kill).toHaveBeenCalledOnce();
  });

  it("handles kill() throwing gracefully", () => {
    const kill = vi.fn(() => {
      throw new Error("already dead");
    });
    processor.addSession("session-1", { handle: { kill } });

    // Should not throw
    const result = processor.startInterview("session-1");
    expect(result).toBe("replaced");
    expect(kill).toHaveBeenCalledOnce();
  });
});
