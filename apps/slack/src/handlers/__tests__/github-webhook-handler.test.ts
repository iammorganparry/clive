/**
 * Tests for GitHub Webhook Handler
 *
 * Verifies HMAC signature validation, event routing, rate limiting,
 * and proper handling of various GitHub webhook event types.
 */

import { createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGitHubWebhookHandler } from "../github-webhook-handler";
import { PrSubscriptionRegistry } from "../../services/pr-subscription-registry";

// Mock SlackService
const mockPostMessage = vi.fn().mockReturnValue({
  pipe: vi.fn().mockReturnThis(),
  [Symbol.for("effect/Effect")]: true,
});

// Create a mock that Effect.runPromise can handle
vi.mock("effect", async () => {
  const actual = await vi.importActual("effect");
  return {
    ...actual,
    Effect: {
      ...(actual as any).Effect,
      runPromise: vi.fn().mockResolvedValue(undefined),
    },
  };
});

const mockSlackService = {
  postMessage: mockPostMessage,
} as any;

// Mock GitHubService
const mockCommentOnPr = vi.fn().mockResolvedValue(undefined);
const mockGetPrReviewComments = vi.fn().mockResolvedValue([]);
const mockGitHubService = {
  commentOnPr: mockCommentOnPr,
  getPrReviewComments: mockGetPrReviewComments,
} as any;

// Mock WorkerProxy
const mockSendPrFeedback = vi.fn().mockReturnValue(true);
const mockGetWorkerForSession = vi.fn().mockReturnValue(undefined);
const mockHandleWorkerEvent = vi.fn();
const mockWorkerProxy = {
  sendPrFeedback: mockSendPrFeedback,
  getWorkerForSession: mockGetWorkerForSession,
  handleWorkerEvent: mockHandleWorkerEvent,
} as any;

// Mock InterviewStore
const mockInterviewStore = {} as any;

const WEBHOOK_SECRET = "test-secret-123";

/**
 * Create a valid HMAC-SHA256 signature for a payload
 */
function sign(payload: string): string {
  return `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")}`;
}

/**
 * Create a mock HTTP request
 */
function createMockRequest(options: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  (req as any).method = options.method ?? "POST";
  (req as any).headers = options.headers ?? {};
  (req as any).socket = { remoteAddress: "127.0.0.1" };

  // Simulate body streaming
  if (options.body !== undefined) {
    process.nextTick(() => {
      req.emit("data", Buffer.from(options.body!));
      req.emit("end");
    });
  }

  return req;
}

/**
 * Create a mock HTTP response with captured output
 */
function createMockResponse(): ServerResponse & { _statusCode: number; _body: string } {
  const res = {
    _statusCode: 200,
    _body: "",
    writeHead: vi.fn(function (this: any, code: number) {
      this._statusCode = code;
    }),
    end: vi.fn(function (this: any, body?: string) {
      this._body = body ?? "";
    }),
  } as any;
  return res;
}

describe("GitHub Webhook Handler", () => {
  let registry: PrSubscriptionRegistry;
  let handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;

  const baseSub = {
    prUrl: "https://github.com/owner/repo/pull/42",
    prNumber: 42,
    repo: "owner/repo",
    workerId: "worker-123",
    claudeSessionId: "claude-abc",
    projectId: "proj-1",
    channel: "C123",
    threadTs: "1234567890.123456",
    initiatorId: "U123",
  };

  // Monotonically increasing base time ensures rate limit windows from previous
  // tests always expire. The module-level repoRateLimits Map persists across tests
  // and uses Date.now(), so each test must run at a time > (previous test time + 60s).
  let timeBase = Date.now();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    timeBase += 120_000; // Always advance beyond any rate limit window
    vi.setSystemTime(timeBase);
    registry = new PrSubscriptionRegistry();

    handler = createGitHubWebhookHandler({
      webhookSecret: WEBHOOK_SECRET,
      subscriptionRegistry: registry,
      workerProxy: mockWorkerProxy,
      slackService: mockSlackService,
      githubService: mockGitHubService,
      interviewStore: mockInterviewStore,
    });
  });

  afterEach(() => {
    registry.closeAll();
    vi.useRealTimers();
  });

  describe("HTTP Method Validation", () => {
    it("rejects non-POST requests", async () => {
      const req = createMockRequest({ method: "GET", body: "" });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(405);
      expect(res.end).toHaveBeenCalledWith("Method Not Allowed");
    });
  });

  describe("Signature Validation", () => {
    it("rejects requests with missing signature", async () => {
      const body = JSON.stringify({ action: "submitted" });
      const req = createMockRequest({
        headers: { "x-github-event": "pull_request_review" },
        body,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(401);
      expect(res.end).toHaveBeenCalledWith("Unauthorized");
    });

    it("rejects requests with invalid signature", async () => {
      const body = JSON.stringify({ action: "submitted" });
      const req = createMockRequest({
        headers: {
          "x-github-event": "pull_request_review",
          "x-hub-signature-256": "sha256=invalid",
        },
        body,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(401);
      expect(res.end).toHaveBeenCalledWith("Unauthorized");
    });

    it("accepts requests with valid signature", async () => {
      const body = JSON.stringify({
        action: "submitted",
        repository: { full_name: "owner/repo" },
        pull_request: { number: 42 },
        review: { user: { login: "dev" }, body: "Fix this", state: "commented" },
      });
      const req = createMockRequest({
        headers: {
          "x-github-event": "pull_request_review",
          "x-hub-signature-256": sign(body),
        },
        body,
      });
      const res = createMockResponse();

      // No subscription, so it should just return 200
      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200);
    });
  });

  describe("Missing Event Header", () => {
    it("rejects requests without X-GitHub-Event header", async () => {
      const body = JSON.stringify({ action: "submitted" });
      const req = createMockRequest({
        headers: {
          "x-hub-signature-256": sign(body),
        },
        body,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400);
      expect(res.end).toHaveBeenCalledWith("Missing X-GitHub-Event header");
    });
  });

  describe("Non-PR Events", () => {
    it("returns 200 for events without repo or PR number", async () => {
      const body = JSON.stringify({ action: "opened" });
      const req = createMockRequest({
        headers: {
          "x-github-event": "issues",
          "x-hub-signature-256": sign(body),
        },
        body,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200);
      expect(res.end).toHaveBeenCalledWith("OK");
    });
  });

  describe("Unsubscribed PRs", () => {
    it("silently ignores events for PRs without subscriptions", async () => {
      const body = JSON.stringify({
        action: "submitted",
        repository: { full_name: "owner/repo" },
        pull_request: { number: 99 },
        review: { user: { login: "dev" }, body: "Fix it", state: "commented" },
      });
      const req = createMockRequest({
        headers: {
          "x-github-event": "pull_request_review",
          "x-hub-signature-256": sign(body),
        },
        body,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200);
      expect(mockSendPrFeedback).not.toHaveBeenCalled();
    });
  });

  describe("pull_request (closed)", () => {
    it("unsubscribes when a subscribed PR is closed", async () => {
      registry.subscribe(baseSub);
      expect(registry.getSubscription("owner/repo", 42)).toBeDefined();

      const body = JSON.stringify({
        action: "closed",
        repository: { full_name: "owner/repo" },
        pull_request: { number: 42 },
      });
      const req = createMockRequest({
        headers: {
          "x-github-event": "pull_request",
          "x-hub-signature-256": sign(body),
        },
        body,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200);
      expect(registry.getSubscription("owner/repo", 42)).toBeUndefined();
    });

    it("ignores closed events for unsubscribed PRs", async () => {
      const body = JSON.stringify({
        action: "closed",
        repository: { full_name: "owner/repo" },
        pull_request: { number: 99 },
      });
      const req = createMockRequest({
        headers: {
          "x-github-event": "pull_request",
          "x-hub-signature-256": sign(body),
        },
        body,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200);
    });

    it("does not unsubscribe on non-closed pull_request actions", async () => {
      registry.subscribe(baseSub);

      const body = JSON.stringify({
        action: "opened",
        repository: { full_name: "owner/repo" },
        pull_request: { number: 42 },
      });
      const req = createMockRequest({
        headers: {
          "x-github-event": "pull_request",
          "x-hub-signature-256": sign(body),
        },
        body,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(registry.getSubscription("owner/repo", 42)).toBeDefined();
    });
  });

  describe("pull_request_review", () => {
    it("routes changes_requested reviews to the worker", async () => {
      registry.subscribe(baseSub);

      const body = JSON.stringify({
        action: "submitted",
        repository: { full_name: "owner/repo" },
        pull_request: { number: 42 },
        review: {
          user: { login: "reviewer" },
          body: "Please fix the null check",
          state: "changes_requested",
        },
      });
      const req = createMockRequest({
        headers: {
          "x-github-event": "pull_request_review",
          "x-hub-signature-256": sign(body),
        },
        body,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200);
      expect(mockSendPrFeedback).toHaveBeenCalledTimes(1);

      const [workerId, feedbackReq] = mockSendPrFeedback.mock.calls[0];
      expect(workerId).toBe("worker-123");
      expect(feedbackReq.prNumber).toBe(42);
      expect(feedbackReq.repo).toBe("owner/repo");
      expect(feedbackReq.claudeSessionId).toBe("claude-abc");
      expect(feedbackReq.feedbackType).toBe("changes_requested");
      expect(feedbackReq.feedback[0].author).toBe("reviewer");
      expect(feedbackReq.feedback[0].body).toBe("Please fix the null check");
    });

    it("routes commented reviews with body to the worker", async () => {
      registry.subscribe(baseSub);

      const body = JSON.stringify({
        action: "submitted",
        repository: { full_name: "owner/repo" },
        pull_request: { number: 42 },
        review: {
          user: { login: "peer" },
          body: "Have you considered using optional chaining?",
          state: "commented",
        },
      });
      const req = createMockRequest({
        headers: {
          "x-github-event": "pull_request_review",
          "x-hub-signature-256": sign(body),
        },
        body,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(mockSendPrFeedback).toHaveBeenCalledTimes(1);
      const feedbackReq = mockSendPrFeedback.mock.calls[0][1];
      expect(feedbackReq.feedbackType).toBe("comment");
    });

    it("ignores commented reviews with empty body", async () => {
      registry.subscribe(baseSub);

      const body = JSON.stringify({
        action: "submitted",
        repository: { full_name: "owner/repo" },
        pull_request: { number: 42 },
        review: {
          user: { login: "peer" },
          body: "",
          state: "commented",
        },
      });
      const req = createMockRequest({
        headers: {
          "x-github-event": "pull_request_review",
          "x-hub-signature-256": sign(body),
        },
        body,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(mockSendPrFeedback).not.toHaveBeenCalled();
    });

    it("ignores APPROVED reviews", async () => {
      registry.subscribe(baseSub);

      const body = JSON.stringify({
        action: "submitted",
        repository: { full_name: "owner/repo" },
        pull_request: { number: 42 },
        review: {
          user: { login: "lead" },
          body: "LGTM",
          state: "approved",
        },
      });
      const req = createMockRequest({
        headers: {
          "x-github-event": "pull_request_review",
          "x-hub-signature-256": sign(body),
        },
        body,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(mockSendPrFeedback).not.toHaveBeenCalled();
    });

    it("comments on GitHub PR when routing feedback", async () => {
      registry.subscribe(baseSub);

      const body = JSON.stringify({
        action: "submitted",
        repository: { full_name: "owner/repo" },
        pull_request: { number: 42 },
        review: {
          user: { login: "reviewer" },
          body: "Fix this",
          state: "changes_requested",
        },
      });
      const req = createMockRequest({
        headers: {
          "x-github-event": "pull_request_review",
          "x-hub-signature-256": sign(body),
        },
        body,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(mockCommentOnPr).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.stringContaining("Addressing feedback from reviewer"),
      );
    });
  });

  describe("pull_request_review_comment", () => {
    it("routes inline comments to the worker", async () => {
      registry.subscribe(baseSub);

      const body = JSON.stringify({
        action: "created",
        repository: { full_name: "owner/repo" },
        pull_request: { number: 42 },
        comment: {
          id: 555,
          user: { login: "reviewer" },
          body: "This variable should be const",
          path: "src/index.ts",
          line: 15,
          original_line: null,
        },
      });
      const req = createMockRequest({
        headers: {
          "x-github-event": "pull_request_review_comment",
          "x-hub-signature-256": sign(body),
        },
        body,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(mockSendPrFeedback).toHaveBeenCalledTimes(1);
      const feedbackReq = mockSendPrFeedback.mock.calls[0][1];
      expect(feedbackReq.feedbackType).toBe("review_comment");
      expect(feedbackReq.feedback[0].path).toBe("src/index.ts");
      expect(feedbackReq.feedback[0].line).toBe(15);
      expect(feedbackReq.feedback[0].commentId).toBe(555);
    });

    it("ignores inline comments with empty body", async () => {
      registry.subscribe(baseSub);

      const body = JSON.stringify({
        action: "created",
        repository: { full_name: "owner/repo" },
        pull_request: { number: 42 },
        comment: {
          id: 555,
          user: { login: "reviewer" },
          body: "",
          path: "src/index.ts",
          line: 15,
        },
      });
      const req = createMockRequest({
        headers: {
          "x-github-event": "pull_request_review_comment",
          "x-hub-signature-256": sign(body),
        },
        body,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(mockSendPrFeedback).not.toHaveBeenCalled();
    });

    it("uses original_line when line is null", async () => {
      registry.subscribe(baseSub);

      const body = JSON.stringify({
        action: "created",
        repository: { full_name: "owner/repo" },
        pull_request: { number: 42 },
        comment: {
          id: 556,
          user: { login: "reviewer" },
          body: "Fix this",
          path: "src/file.ts",
          line: null,
          original_line: 20,
        },
      });
      const req = createMockRequest({
        headers: {
          "x-github-event": "pull_request_review_comment",
          "x-hub-signature-256": sign(body),
        },
        body,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(mockSendPrFeedback).toHaveBeenCalled();
      const feedbackReq = mockSendPrFeedback.mock.calls[0][1];
      expect(feedbackReq.feedback[0].line).toBe(20);
    });
  });

  describe("Rate Limiting", () => {
    it("allows requests within the rate limit", async () => {
      registry.subscribe(baseSub);

      for (let i = 0; i < 5; i++) {
        const body = JSON.stringify({
          action: "submitted",
          repository: { full_name: "owner/repo" },
          pull_request: { number: 42 },
          review: {
            user: { login: "dev" },
            body: `Comment ${i}`,
            state: "changes_requested",
          },
        });
        const req = createMockRequest({
          headers: {
            "x-github-event": "pull_request_review",
            "x-hub-signature-256": sign(body),
          },
          body,
        });
        const res = createMockResponse();
        await handler(req, res);
        expect(res._statusCode).toBe(200);
      }
    });
  });

  describe("Error Handling", () => {
    it("returns 500 on malformed JSON body", async () => {
      const body = "not json";
      const req = createMockRequest({
        headers: {
          "x-github-event": "pull_request_review",
          "x-hub-signature-256": sign(body),
        },
        body,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(500);
    });
  });

  describe("Feedback Session ID Generation", () => {
    it("generates unique session IDs for each feedback round", async () => {
      registry.subscribe(baseSub);

      const sessionIds: string[] = [];
      mockSendPrFeedback.mockImplementation((_wid: string, req: any) => {
        sessionIds.push(req.sessionId);
        return true;
      });

      for (let i = 0; i < 3; i++) {
        // Advance time to ensure unique Date.now() for session ID generation
        vi.advanceTimersByTime(100);

        const body = JSON.stringify({
          action: "submitted",
          repository: { full_name: "owner/repo" },
          pull_request: { number: 42 },
          review: {
            user: { login: "dev" },
            body: `Comment ${i}`,
            state: "changes_requested",
          },
        });
        const req = createMockRequest({
          headers: {
            "x-github-event": "pull_request_review",
            "x-hub-signature-256": sign(body),
          },
          body,
        });
        const res = createMockResponse();
        await handler(req, res);
      }

      // All session IDs should be unique
      const uniqueIds = new Set(sessionIds);
      expect(uniqueIds.size).toBe(3);

      // Each should contain the thread timestamp
      for (const id of sessionIds) {
        expect(id).toContain("1234567890.123456-fb-");
      }
    });
  });
});
