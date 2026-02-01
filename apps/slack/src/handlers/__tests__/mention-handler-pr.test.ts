/**
 * Tests for PR-related changes in the mention handler
 *
 * Verifies:
 * - parsePrUrl helper function
 * - pr_created auto-subscribe flow
 * - pr_feedback_addressed event handling
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InterviewEvent } from "@clive/worker-protocol";
import { Effect } from "effect";
import { InterviewStore } from "../../store/interview-store";
import { PrSubscriptionRegistry } from "../../services/pr-subscription-registry";
import { handleWorkerInterviewEvent, type PrServices } from "../mention-handler";

// Mock SlackService - needs to return Effects
const mockPostMessage = vi.fn().mockReturnValue(Effect.succeed(undefined));
const mockSlackService = {
  postMessage: mockPostMessage,
} as any;

// Mock GitHubService
const mockCommentOnPr = vi.fn().mockResolvedValue(undefined);
const mockReplyToReviewComment = vi.fn().mockResolvedValue(undefined);
const mockGitHubService = {
  commentOnPr: mockCommentOnPr,
  replyToReviewComment: mockReplyToReviewComment,
} as any;

describe("Mention Handler - PR Features", () => {
  let store: InterviewStore;
  let registry: PrSubscriptionRegistry;
  let prServices: PrServices;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    store = new InterviewStore();
    registry = new PrSubscriptionRegistry();
    prServices = {
      subscriptionRegistry: registry,
      githubService: mockGitHubService,
    };
  });

  afterEach(() => {
    store.closeAll();
    registry.closeAll();
    vi.useRealTimers();
  });

  describe("parsePrUrl (tested via pr_created handler)", () => {
    it("auto-subscribes on pr_created with valid GitHub URL", async () => {
      // Create a session with worker and Claude session context
      store.create("thread-123", "C123", "U123");
      store.setWorkerId("thread-123", "worker-abc");
      store.setClaudeSessionId("thread-123", "claude-session-1");

      const event: InterviewEvent = {
        sessionId: "thread-123",
        type: "pr_created",
        payload: {
          type: "pr_created",
          url: "https://github.com/myorg/myrepo/pull/55",
        },
        timestamp: new Date().toISOString(),
      };

      await handleWorkerInterviewEvent(event, "thread-123", "C123", store, mockSlackService, prServices);

      // Should have created a subscription
      const sub = registry.getSubscription("myorg/myrepo", 55);
      expect(sub).toBeDefined();
      expect(sub!.prNumber).toBe(55);
      expect(sub!.repo).toBe("myorg/myrepo");
      expect(sub!.workerId).toBe("worker-abc");
      expect(sub!.claudeSessionId).toBe("claude-session-1");
      expect(sub!.channel).toBe("C123");
      expect(sub!.threadTs).toBe("thread-123");
      expect(sub!.initiatorId).toBe("U123");
    });

    it("posts PR created message to Slack", async () => {
      store.create("thread-123", "C123", "U123");
      store.setWorkerId("thread-123", "worker-abc");
      store.setClaudeSessionId("thread-123", "claude-session-1");

      const event: InterviewEvent = {
        sessionId: "thread-123",
        type: "pr_created",
        payload: {
          type: "pr_created",
          url: "https://github.com/owner/repo/pull/10",
        },
        timestamp: new Date().toISOString(),
      };

      await handleWorkerInterviewEvent(event, "thread-123", "C123", store, mockSlackService, prServices);

      // First call: PR created notification
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C123",
          threadTs: "thread-123",
          text: expect.stringContaining("PR created"),
        }),
      );

      // Second call: subscription confirmation
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Subscribed to PR updates"),
        }),
      );
    });

    it("stores PR URL in interview store", async () => {
      store.create("thread-123", "C123", "U123");
      store.setWorkerId("thread-123", "worker-abc");
      store.setClaudeSessionId("thread-123", "claude-session-1");

      const event: InterviewEvent = {
        sessionId: "thread-123",
        type: "pr_created",
        payload: {
          type: "pr_created",
          url: "https://github.com/owner/repo/pull/10",
        },
        timestamp: new Date().toISOString(),
      };

      await handleWorkerInterviewEvent(event, "thread-123", "C123", store, mockSlackService, prServices);

      expect(store.get("thread-123")!.prUrl).toBe("https://github.com/owner/repo/pull/10");
    });

    it("does not subscribe without Claude session ID", async () => {
      store.create("thread-123", "C123", "U123");
      store.setWorkerId("thread-123", "worker-abc");
      // No claudeSessionId set

      const event: InterviewEvent = {
        sessionId: "thread-123",
        type: "pr_created",
        payload: {
          type: "pr_created",
          url: "https://github.com/owner/repo/pull/10",
        },
        timestamp: new Date().toISOString(),
      };

      await handleWorkerInterviewEvent(event, "thread-123", "C123", store, mockSlackService, prServices);

      expect(registry.count).toBe(0);
    });

    it("does not subscribe without worker ID", async () => {
      store.create("thread-123", "C123", "U123");
      store.setClaudeSessionId("thread-123", "claude-session-1");
      // No workerId set

      const event: InterviewEvent = {
        sessionId: "thread-123",
        type: "pr_created",
        payload: {
          type: "pr_created",
          url: "https://github.com/owner/repo/pull/10",
        },
        timestamp: new Date().toISOString(),
      };

      await handleWorkerInterviewEvent(event, "thread-123", "C123", store, mockSlackService, prServices);

      expect(registry.count).toBe(0);
    });

    it("does not subscribe with invalid PR URL", async () => {
      store.create("thread-123", "C123", "U123");
      store.setWorkerId("thread-123", "worker-abc");
      store.setClaudeSessionId("thread-123", "claude-session-1");

      const event: InterviewEvent = {
        sessionId: "thread-123",
        type: "pr_created",
        payload: {
          type: "pr_created",
          url: "https://not-github.com/something/else",
        },
        timestamp: new Date().toISOString(),
      };

      await handleWorkerInterviewEvent(event, "thread-123", "C123", store, mockSlackService, prServices);

      expect(registry.count).toBe(0);
    });

    it("does not subscribe when prServices is not provided", async () => {
      store.create("thread-123", "C123", "U123");
      store.setWorkerId("thread-123", "worker-abc");
      store.setClaudeSessionId("thread-123", "claude-session-1");

      const event: InterviewEvent = {
        sessionId: "thread-123",
        type: "pr_created",
        payload: {
          type: "pr_created",
          url: "https://github.com/owner/repo/pull/10",
        },
        timestamp: new Date().toISOString(),
      };

      await handleWorkerInterviewEvent(event, "thread-123", "C123", store, mockSlackService, undefined);

      // No prServices → no subscription
      expect(registry.count).toBe(0);
    });
  });

  describe("pr_feedback_addressed", () => {
    it("posts summary to Slack with commit sha", async () => {
      store.create("thread-123", "C123", "U123");

      const event: InterviewEvent = {
        sessionId: "thread-123",
        type: "pr_feedback_addressed",
        payload: {
          type: "pr_feedback_addressed",
          prUrl: "https://github.com/owner/repo/pull/42",
          commitSha: "abc1234def5678",
          summary: "Fixed the null check and added error handling",
        },
        timestamp: new Date().toISOString(),
      };

      await handleWorkerInterviewEvent(event, "thread-123", "C123", store, mockSlackService, prServices);

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C123",
          threadTs: "thread-123",
          text: expect.stringContaining("Feedback addressed"),
        }),
      );
    });

    it("comments on GitHub PR with summary", async () => {
      store.create("thread-123", "C123", "U123");

      const event: InterviewEvent = {
        sessionId: "thread-123",
        type: "pr_feedback_addressed",
        payload: {
          type: "pr_feedback_addressed",
          prUrl: "https://github.com/owner/repo/pull/42",
          commitSha: "abc1234",
          summary: "Fixed the null check",
        },
        timestamp: new Date().toISOString(),
      };

      await handleWorkerInterviewEvent(event, "thread-123", "C123", store, mockSlackService, prServices);

      expect(mockCommentOnPr).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.stringContaining("Fixed the null check"),
      );
    });

    it("replies to individual review comments", async () => {
      store.create("thread-123", "C123", "U123");

      const event: InterviewEvent = {
        sessionId: "thread-123",
        type: "pr_feedback_addressed",
        payload: {
          type: "pr_feedback_addressed",
          prUrl: "https://github.com/owner/repo/pull/42",
          summary: "Fixed issues",
          commentReplies: [
            { commentId: 100, reply: "Changed to const as suggested" },
            { commentId: 101, reply: "Added error handling" },
          ],
        },
        timestamp: new Date().toISOString(),
      };

      await handleWorkerInterviewEvent(event, "thread-123", "C123", store, mockSlackService, prServices);

      expect(mockReplyToReviewComment).toHaveBeenCalledTimes(2);
      expect(mockReplyToReviewComment).toHaveBeenCalledWith(
        "owner/repo",
        42,
        100,
        "Changed to const as suggested",
      );
      expect(mockReplyToReviewComment).toHaveBeenCalledWith(
        "owner/repo",
        42,
        101,
        "Added error handling",
      );
    });

    it("handles missing commitSha gracefully", async () => {
      store.create("thread-123", "C123", "U123");

      const event: InterviewEvent = {
        sessionId: "thread-123",
        type: "pr_feedback_addressed",
        payload: {
          type: "pr_feedback_addressed",
          prUrl: "https://github.com/owner/repo/pull/42",
          summary: "Fixed it",
        },
        timestamp: new Date().toISOString(),
      };

      await handleWorkerInterviewEvent(event, "thread-123", "C123", store, mockSlackService, prServices);

      // Should not throw, should still post
      expect(mockPostMessage).toHaveBeenCalled();
      expect(mockCommentOnPr).toHaveBeenCalled();
    });

    it("handles missing summary gracefully", async () => {
      store.create("thread-123", "C123", "U123");

      const event: InterviewEvent = {
        sessionId: "thread-123",
        type: "pr_feedback_addressed",
        payload: {
          type: "pr_feedback_addressed",
          prUrl: "https://github.com/owner/repo/pull/42",
          commitSha: "abc1234",
        },
        timestamp: new Date().toISOString(),
      };

      await handleWorkerInterviewEvent(event, "thread-123", "C123", store, mockSlackService, prServices);

      expect(mockPostMessage).toHaveBeenCalled();
    });

    it("does not comment on GitHub without prServices", async () => {
      store.create("thread-123", "C123", "U123");

      const event: InterviewEvent = {
        sessionId: "thread-123",
        type: "pr_feedback_addressed",
        payload: {
          type: "pr_feedback_addressed",
          prUrl: "https://github.com/owner/repo/pull/42",
          summary: "Fixed it",
        },
        timestamp: new Date().toISOString(),
      };

      await handleWorkerInterviewEvent(event, "thread-123", "C123", store, mockSlackService, undefined);

      // Should still post to Slack
      expect(mockPostMessage).toHaveBeenCalled();
      // But should not try to comment on GitHub
      expect(mockCommentOnPr).not.toHaveBeenCalled();
    });

    it("does not crash with invalid PR URL in pr_feedback_addressed", async () => {
      store.create("thread-123", "C123", "U123");

      const event: InterviewEvent = {
        sessionId: "thread-123",
        type: "pr_feedback_addressed",
        payload: {
          type: "pr_feedback_addressed",
          prUrl: "not-a-valid-url",
          summary: "Fixed it",
        },
        timestamp: new Date().toISOString(),
      };

      // Should not throw
      await handleWorkerInterviewEvent(event, "thread-123", "C123", store, mockSlackService, prServices);

      expect(mockPostMessage).toHaveBeenCalled();
      expect(mockCommentOnPr).not.toHaveBeenCalled();
    });

    it("continues replying to other comments if one reply fails", async () => {
      store.create("thread-123", "C123", "U123");

      mockReplyToReviewComment
        .mockRejectedValueOnce(new Error("Comment deleted"))
        .mockResolvedValueOnce(undefined);

      const event: InterviewEvent = {
        sessionId: "thread-123",
        type: "pr_feedback_addressed",
        payload: {
          type: "pr_feedback_addressed",
          prUrl: "https://github.com/owner/repo/pull/42",
          summary: "Fixed",
          commentReplies: [
            { commentId: 100, reply: "Will fail" },
            { commentId: 101, reply: "Will succeed" },
          ],
        },
        timestamp: new Date().toISOString(),
      };

      await handleWorkerInterviewEvent(event, "thread-123", "C123", store, mockSlackService, prServices);

      // Both should have been attempted
      expect(mockReplyToReviewComment).toHaveBeenCalledTimes(2);
    });
  });
});
