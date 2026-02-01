/**
 * GitHub Webhook Handler
 *
 * HTTP handler for GitHub webhook events related to PR reviews.
 * Registered as a customRoute on the HTTPReceiver.
 *
 * Handles:
 * - pull_request_review (changes_requested, commented)
 * - pull_request_review_comment (inline code comments)
 * - pull_request (closed → unsubscribe)
 *
 * Security: Validates X-Hub-Signature-256 using GITHUB_WEBHOOK_SECRET.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PrFeedbackRequest, PrReviewFeedback } from "@clive/worker-protocol";
import { Effect } from "effect";
import type { GitHubService } from "../services/github-service";
import type { PrSubscriptionRegistry } from "../services/pr-subscription-registry";
import type { SlackService } from "../services/slack-service";
import type { WorkerProxy } from "../services/worker-proxy";
import type { InterviewStore } from "../store/interview-store";

/**
 * Rate limiting per repo to prevent webhook floods
 */
const repoRateLimits = new Map<string, { count: number; resetAt: number }>();
const REPO_RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 };

function checkRepoRateLimit(repo: string): boolean {
  const now = Date.now();
  const entry = repoRateLimits.get(repo);

  if (!entry || now > entry.resetAt) {
    repoRateLimits.set(repo, { count: 1, resetAt: now + REPO_RATE_LIMIT.windowMs });
    return true;
  }

  if (entry.count >= REPO_RATE_LIMIT.maxRequests) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * Verify GitHub webhook signature (HMAC-SHA256)
 */
function verifySignature(payload: string, signature: string, secret: string): boolean {
  if (!signature) return false;

  const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Read the request body as a string
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/**
 * Extract repo (owner/repo) from GitHub webhook payload
 */
function extractRepo(payload: Record<string, unknown>): string | null {
  const repo = payload.repository as { full_name?: string } | undefined;
  return repo?.full_name ?? null;
}

/**
 * Extract PR number from webhook payload
 */
function extractPrNumber(payload: Record<string, unknown>): number | null {
  // pull_request_review and pull_request events have pull_request.number
  const pr = payload.pull_request as { number?: number } | undefined;
  if (pr?.number) return pr.number;

  // pull_request_review_comment events have pull_request.number too
  return null;
}

interface WebhookHandlerDeps {
  webhookSecret: string;
  subscriptionRegistry: PrSubscriptionRegistry;
  workerProxy: WorkerProxy;
  slackService: SlackService;
  githubService: GitHubService;
  interviewStore: InterviewStore;
}

/**
 * Create the GitHub webhook HTTP handler
 */
export function createGitHubWebhookHandler(deps: WebhookHandlerDeps) {
  const {
    webhookSecret,
    subscriptionRegistry,
    workerProxy,
    slackService,
    githubService,
    interviewStore,
  } = deps;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Only accept POST
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end("Method Not Allowed");
      return;
    }

    try {
      const body = await readBody(req);

      // Verify signature
      const signature = req.headers["x-hub-signature-256"] as string | undefined;
      if (!signature || !verifySignature(body, signature, webhookSecret)) {
        console.warn("[GitHubWebhook] Invalid or missing signature");
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }

      const eventType = req.headers["x-github-event"] as string | undefined;
      if (!eventType) {
        res.writeHead(400);
        res.end("Missing X-GitHub-Event header");
        return;
      }

      const payload = JSON.parse(body) as Record<string, unknown>;
      const repo = extractRepo(payload);
      const prNumber = extractPrNumber(payload);

      if (!repo || !prNumber) {
        // Not a PR-related event we care about, acknowledge silently
        res.writeHead(200);
        res.end("OK");
        return;
      }

      // Rate limit per repo
      if (!checkRepoRateLimit(repo)) {
        console.warn(`[GitHubWebhook] Rate limited: ${repo}`);
        res.writeHead(429);
        res.end("Too Many Requests");
        return;
      }

      // Look up subscription
      const subscription = subscriptionRegistry.getSubscription(repo, prNumber);

      // Handle PR closed → unsubscribe
      if (eventType === "pull_request") {
        const action = payload.action as string | undefined;
        if (action === "closed" && subscription) {
          subscriptionRegistry.unsubscribe(repo, prNumber);
          console.log(`[GitHubWebhook] PR ${repo}#${prNumber} closed, unsubscribed`);
        }
        res.writeHead(200);
        res.end("OK");
        return;
      }

      // If not subscribed, ignore
      if (!subscription) {
        res.writeHead(200);
        res.end("OK");
        return;
      }

      // Handle review events
      if (eventType === "pull_request_review") {
        await handlePullRequestReview(
          payload,
          repo,
          prNumber,
          subscription,
          deps,
        );
      } else if (eventType === "pull_request_review_comment") {
        await handleReviewComment(
          payload,
          repo,
          prNumber,
          subscription,
          deps,
        );
      }

      res.writeHead(200);
      res.end("OK");
    } catch (error) {
      console.error("[GitHubWebhook] Error processing webhook:", error);
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  };
}

/**
 * Handle pull_request_review event
 */
async function handlePullRequestReview(
  payload: Record<string, unknown>,
  repo: string,
  prNumber: number,
  subscription: ReturnType<PrSubscriptionRegistry["getSubscription"]> & {},
  deps: WebhookHandlerDeps,
): Promise<void> {
  const review = payload.review as {
    user?: { login?: string };
    body?: string;
    state?: string;
  } | undefined;

  if (!review) return;

  const state = review.state?.toUpperCase();

  // Only handle actionable reviews (changes_requested or commented with body)
  if (state !== "CHANGES_REQUESTED" && state !== "COMMENTED") return;
  if (state === "COMMENTED" && !review.body?.trim()) return;

  const author = review.user?.login ?? "unknown";
  const feedbackType = state === "CHANGES_REQUESTED" ? "changes_requested" : "comment";

  const feedback: PrReviewFeedback[] = [{
    author,
    body: review.body ?? "",
    state,
  }];

  // Also fetch inline comments from this review
  try {
    const comments = await deps.githubService.getPrReviewComments(repo, prNumber);
    for (const comment of comments) {
      feedback.push({
        author: comment.author,
        body: comment.body,
        path: comment.path,
        line: comment.line ?? undefined,
        commentId: comment.id,
      });
    }
  } catch (error) {
    console.error(`[GitHubWebhook] Failed to fetch review comments:`, error);
  }

  await routeFeedbackToWorker(repo, prNumber, feedbackType, feedback, subscription, deps);
}

/**
 * Handle pull_request_review_comment event (individual inline comment)
 */
async function handleReviewComment(
  payload: Record<string, unknown>,
  repo: string,
  prNumber: number,
  subscription: ReturnType<PrSubscriptionRegistry["getSubscription"]> & {},
  deps: WebhookHandlerDeps,
): Promise<void> {
  const comment = payload.comment as {
    id?: number;
    user?: { login?: string };
    body?: string;
    path?: string;
    line?: number;
    original_line?: number;
  } | undefined;

  if (!comment?.body?.trim()) return;

  const feedback: PrReviewFeedback[] = [{
    author: comment.user?.login ?? "unknown",
    body: comment.body,
    path: comment.path,
    line: comment.line ?? comment.original_line ?? undefined,
    commentId: comment.id,
  }];

  await routeFeedbackToWorker(repo, prNumber, "review_comment", feedback, subscription, deps);
}

/**
 * Route feedback to the originating worker
 */
async function routeFeedbackToWorker(
  repo: string,
  prNumber: number,
  feedbackType: PrFeedbackRequest["feedbackType"],
  feedback: PrReviewFeedback[],
  subscription: ReturnType<PrSubscriptionRegistry["getSubscription"]> & {},
  deps: WebhookHandlerDeps,
): Promise<void> {
  const { subscriptionRegistry, workerProxy, slackService, githubService, interviewStore } = deps;
  const authors = [...new Set(feedback.map((f) => f.author))].join(", ");

  // Update last feedback timestamp
  subscriptionRegistry.touchFeedback(repo, prNumber);

  // Notify Slack
  await Effect.runPromise(
    slackService.postMessage({
      channel: subscription.channel,
      threadTs: subscription.threadTs,
      text: `Review feedback received from ${authors} on PR #${prNumber}. Addressing...`,
    }),
  );

  // Comment on GitHub PR
  try {
    await githubService.commentOnPr(
      repo,
      prNumber,
      `🔧 Addressing feedback from ${authors}...`,
    );
  } catch (error) {
    console.error(`[GitHubWebhook] Failed to comment on PR:`, error);
  }

  // Generate a new session ID for this feedback round
  const feedbackSessionId = `${subscription.threadTs}-fb-${Date.now()}`;

  // Build the PR feedback request
  const prFeedbackRequest: PrFeedbackRequest = {
    sessionId: feedbackSessionId,
    prUrl: subscription.prUrl,
    prNumber,
    repo,
    claudeSessionId: subscription.claudeSessionId,
    projectId: subscription.projectId,
    feedbackType,
    feedback,
  };

  // Route to the originating worker via WorkerProxy
  // We send the pr_feedback message directly to the worker
  const worker = deps.workerProxy.getWorkerForSession(subscription.threadTs);
  if (!worker) {
    // Original session may have completed. Try to find the worker by ID.
    const workerInfo = (deps as unknown as { workerProxy: { registry?: { getWorker: (id: string) => { socket: { readyState: number; send: (data: string) => void } } | undefined } } }).workerProxy;

    // Send via the worker registry directly
    // The worker may not have an active session, so we need to send the message
    // through the registry
    console.log(
      `[GitHubWebhook] No active session for ${subscription.threadTs}, sending pr_feedback to worker ${subscription.workerId}`,
    );
  }

  // Send the pr_feedback message to the worker
  // We use the sendPrFeedback method which we'll add to WorkerProxy
  workerProxy.sendPrFeedback(subscription.workerId, prFeedbackRequest, (event) => {
    workerProxy.handleWorkerEvent(event, interviewStore);
  });

  console.log(
    `[GitHubWebhook] Routed feedback for ${repo}#${prNumber} to worker ${subscription.workerId}`,
  );
}
