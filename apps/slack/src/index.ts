/**
 * Clive Slack Integration
 *
 * Enables planning interviews via @mention in Slack channels.
 *
 * Supports two operation modes:
 * - Local: Single-user deployment with local Claude CLI and ngrok tunnel
 * - Distributed: Central service with worker swarm for multi-user support
 */

import type { Server, IncomingMessage, ServerResponse } from "node:http";
import { LogLevel, App as SlackApp } from "@slack/bolt";
import HTTPReceiverModule from "@slack/bolt/dist/receivers/HTTPReceiver.js";
import { Effect, pipe } from "effect";
import { loadConfig, type SlackConfig } from "./config";

// ============================================================
// Rate Limiting (Security: prevent API abuse)
// ============================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const RATE_LIMIT_CONFIG = {
  maxRequests: 100,     // Max requests per window
  windowMs: 60_000,     // 1 minute window
  cleanupIntervalMs: 60_000, // Cleanup old entries every minute
};

const rateLimitStore = new Map<string, RateLimitEntry>();

// Periodically clean up expired entries to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(ip);
    }
  }
}, RATE_LIMIT_CONFIG.cleanupIntervalMs);

/**
 * Get client IP from request (handles proxies)
 */
function getClientIp(req: IncomingMessage): string {
  // Check X-Forwarded-For header (common for proxies/load balancers)
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor.split(",")[0];
    return ips?.trim() || "unknown";
  }
  // Fallback to socket address
  return req.socket?.remoteAddress || "unknown";
}

/**
 * Check if request should be rate limited
 * Returns true if request is allowed, false if rate limited
 */
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now > entry.resetAt) {
    // New window or expired entry
    rateLimitStore.set(ip, {
      count: 1,
      resetAt: now + RATE_LIMIT_CONFIG.windowMs,
    });
    return true;
  }

  if (entry.count >= RATE_LIMIT_CONFIG.maxRequests) {
    // Rate limit exceeded
    return false;
  }

  // Increment counter
  entry.count++;
  return true;
}

/**
 * Send rate limit exceeded response
 */
function sendRateLimitResponse(res: ServerResponse): void {
  res.writeHead(429, {
    "Content-Type": "application/json",
    "Retry-After": String(Math.ceil(RATE_LIMIT_CONFIG.windowMs / 1000)),
  });
  res.end(JSON.stringify({
    error: "Too Many Requests",
    message: "Rate limit exceeded. Please try again later.",
    retryAfter: Math.ceil(RATE_LIMIT_CONFIG.windowMs / 1000),
  }));
}

// Handle CommonJS default export in ESM
const HTTPReceiver =
  (HTTPReceiverModule as unknown as { default: typeof HTTPReceiverModule })
    .default ?? HTTPReceiverModule;

import {
  registerActionHandler,
  registerActionHandlerDistributed,
} from "./handlers/action-handler";
import {
  registerAssistantHandler,
  registerAssistantHandlerDistributed,
} from "./handlers/assistant-handler";
import {
  registerMentionHandler,
  registerMentionHandlerDistributed,
} from "./handlers/mention-handler";
import {
  registerMessageHandler,
  registerMessageHandlerDistributed,
} from "./handlers/message-handler";
import { GitHubAppAuth } from "@clive/github-app";
import { createGitHubWebhookHandler } from "./handlers/github-webhook-handler";
import { ClaudeManager } from "./services/claude-manager";
import { GitHubService } from "./services/github-service";
import { PrSubscriptionRegistry } from "./services/pr-subscription-registry";
import { SessionRouter } from "./services/session-router";
import { SlackService } from "./services/slack-service";
import { TunnelService } from "./services/tunnel-service";
import { WorkerProxy } from "./services/worker-proxy";
import { WorkerRegistry } from "./services/worker-registry";
import { InterviewStore } from "./store/interview-store";
import { EventServer } from "./websocket/event-server";

/**
 * Start local mode (single-user with ngrok tunnel)
 */
async function startLocalMode(config: SlackConfig): Promise<void> {
  console.log("Starting in LOCAL mode...\n");

  // Start ngrok tunnel
  const tunnelResult = await Effect.runPromise(
    pipe(
      TunnelService.connect(config.port),
      Effect.map((url) => ({ success: true as const, url })),
      Effect.catchAll((error) =>
        Effect.succeed({ success: false as const, error: String(error) }),
      ),
    ),
  );

  if (!tunnelResult.success) {
    console.error("Failed to start ngrok tunnel:", tunnelResult.error);
    console.log("\nTo fix this:");
    console.log("1. Sign up at https://ngrok.com");
    console.log(
      "2. Get your auth token from https://dashboard.ngrok.com/get-started/your-authtoken",
    );
    console.log("3. Set NGROK_AUTH_TOKEN environment variable");
    process.exit(1);
  }

  const tunnelUrl = tunnelResult.url;
  console.log(`ngrok tunnel established: ${tunnelUrl}`);
  console.log(`\nSlack webhook URL: ${tunnelUrl}/slack/events`);
  console.log("\nConfigure this URL in your Slack app's Event Subscriptions.");

  // Initialize Slack app with Bolt.js
  const slackApp = new SlackApp({
    token: config.slackBotToken,
    signingSecret: config.slackSigningSecret,
    logLevel: LogLevel.INFO,
  });

  // Initialize services
  const interviewStore = new InterviewStore();
  const claudeManager = new ClaudeManager(config.workspaceRoot);
  const slackService = new SlackService(slackApp.client);

  // Register handlers (local mode)
  registerAssistantHandler(slackApp, interviewStore, claudeManager, slackService);
  registerMentionHandler(slackApp, interviewStore, claudeManager, slackService);
  registerMessageHandler(slackApp, interviewStore, claudeManager, slackService);
  registerActionHandler(slackApp, interviewStore, claudeManager, slackService);

  // Start the app
  await slackApp.start(config.port);

  console.log(`\nClive Slack app is running on port ${config.port}`);
  console.log("Ready to receive @clive mentions!");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");

    // Disconnect tunnel
    await Effect.runPromise(
      pipe(
        TunnelService.disconnect(),
        Effect.catchAll(() => Effect.succeed(undefined)),
      ),
    );

    // Close all interview sessions
    interviewStore.closeAll();

    // Stop Slack app
    await slackApp.stop();

    console.log("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Start distributed mode (central service with worker swarm)
 */
async function startDistributedMode(config: SlackConfig): Promise<void> {
  console.log("Starting in DISTRIBUTED mode...\n");

  if (!config.workerApiToken) {
    console.error("CLIVE_WORKER_API_TOKEN is required for distributed mode");
    process.exit(1);
  }

  // Initialize PR feedback services (optional)
  // Token priority: GITHUB_TOKEN env var > GitHub App installation token
  const prSubscriptionRegistry = new PrSubscriptionRegistry();
  let githubService: GitHubService | undefined;
  let prServices: import("./handlers/mention-handler").PrServices | undefined;
  let githubAppAuth: GitHubAppAuth | undefined;

  let githubToken = config.githubToken;

  // Generate installation token from GitHub App if credentials are available
  if (config.githubAppId && config.githubAppPrivateKey && config.githubAppInstallationId) {
    githubAppAuth = new GitHubAppAuth({
      appId: config.githubAppId,
      privateKey: config.githubAppPrivateKey,
      installationId: config.githubAppInstallationId,
    });

    if (!githubToken) {
      try {
        githubToken = await githubAppAuth.getToken();
        console.log("GitHub App installation token generated");
      } catch (error) {
        console.error("Failed to generate GitHub App token:", error);
      }
    }
  }

  if (config.githubWebhookSecret && githubToken) {
    githubService = new GitHubService(githubToken);
    prServices = { subscriptionRegistry: prSubscriptionRegistry, githubService };
    console.log("GitHub PR feedback support enabled");

    // Refresh GitHub App token every 50 min (tokens expire after 1h)
    if (githubAppAuth && githubService) {
      const svc = githubService;
      const auth = githubAppAuth;
      setInterval(async () => {
        try {
          const newToken = await auth.getToken();
          svc.updateToken(newToken);
          console.log("[GitHub] App installation token refreshed");
        } catch (error) {
          console.error("[GitHub] Token refresh failed:", error);
        }
      }, 50 * 60 * 1000);
    }
  } else {
    console.log(
      "GitHub PR feedback support disabled (need GITHUB_WEBHOOK_SECRET + either GITHUB_TOKEN or GitHub App credentials)",
    );
  }

  // Build custom routes — the GitHub webhook route handler is a closure
  // that captures services initialized below, so we use a late-binding wrapper.
  let githubWebhookHandler: ((req: IncomingMessage, res: ServerResponse) => void) | undefined;

  const customRoutes: Array<{ path: string; method: string; handler: (req: IncomingMessage, res: ServerResponse) => void }> = [
    {
      path: "/health",
      method: "GET",
      handler: (req, res) => {
        const clientIp = getClientIp(req);
        if (!checkRateLimit(clientIp)) {
          sendRateLimitResponse(res);
          return;
        }
        res.writeHead(200);
        res.end("OK");
      },
    },
  ];

  // Add GitHub webhook route if configured
  if (config.githubWebhookSecret && githubService) {
    customRoutes.push({
      path: "/github/webhook",
      method: "POST",
      handler: (req, res) => {
        if (githubWebhookHandler) {
          githubWebhookHandler(req, res);
        } else {
          res.writeHead(503);
          res.end("Service not ready");
        }
      },
    });
    console.log("GitHub webhook endpoint registered at /github/webhook");
  }

  // Create HTTP receiver with custom routes
  // SECURITY: Worker token endpoint removed - tokens must be configured via environment variable
  // See: https://github.com/clawdbot/clawdbot/issues/1796 (similar vulnerability)
  const receiver = new HTTPReceiver({
    signingSecret: config.slackSigningSecret,
    port: config.port,
    customRoutes,
  });

  // Initialize Slack app with Bolt.js using custom receiver
  const slackApp = new SlackApp({
    token: config.slackBotToken,
    receiver,
    logLevel: LogLevel.INFO,
  });

  // Initialize services
  const interviewStore = new InterviewStore();
  const slackService = new SlackService(slackApp.client);

  // Initialize worker management
  const workerRegistry = new WorkerRegistry();
  const sessionRouter = new SessionRouter(workerRegistry);
  const workerProxy = new WorkerProxy(workerRegistry, sessionRouter);

  // Now that all services are initialized, create the actual webhook handler
  if (config.githubWebhookSecret && githubService) {
    githubWebhookHandler = createGitHubWebhookHandler({
      webhookSecret: config.githubWebhookSecret,
      subscriptionRegistry: prSubscriptionRegistry,
      workerProxy,
      slackService,
      githubService,
      interviewStore,
    });
  }

  // Register handlers (distributed mode)
  registerAssistantHandlerDistributed(
    slackApp,
    interviewStore,
    workerProxy,
    slackService,
  );
  registerMentionHandlerDistributed(
    slackApp,
    interviewStore,
    workerProxy,
    slackService,
    prServices,
  );
  registerMessageHandlerDistributed(
    slackApp,
    interviewStore,
    workerProxy,
    slackService,
  );
  registerActionHandlerDistributed(
    slackApp,
    interviewStore,
    workerProxy,
    slackService,
  );

  // Handle worker disconnection - notify users
  sessionRouter.on(
    "sessionUnassigned",
    async (sessionId, _workerId, reason) => {
      const session = interviewStore.get(sessionId);
      if (
        session &&
        session.phase !== "completed" &&
        session.phase !== "error"
      ) {
        await Effect.runPromise(
          slackService.postMessage({
            channel: session.channel,
            text: `Interview interrupted: Worker disconnected (${reason}). Please @mention Clive again to restart.`,
            threadTs: session.threadTs,
          }),
        );
        interviewStore.setError(sessionId, `Worker disconnected: ${reason}`);
      }
    },
  );

  // Start the Slack app and get the HTTP server
  const httpServer = (await slackApp.start()) as Server;

  console.log(`HTTP server listening on port ${config.port}`);
  console.log(
    `WebSocket endpoint: ws://localhost:${config.port}${config.wsPath}`,
  );

  // Initialize WebSocket server after HTTP server is running
  const eventServer = new EventServer(
    {
      server: httpServer,
      path: config.wsPath,
      apiToken: config.workerApiToken,
    },
    workerRegistry,
    workerProxy,
    interviewStore, // Pass store for session resume tracking
  );

  console.log(`\nWaiting for workers to connect...`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");

    // Close WebSocket connections
    eventServer.close();

    // Close all interview sessions and subscriptions
    interviewStore.closeAll();
    workerProxy.closeAll();
    workerRegistry.closeAll();
    sessionRouter.clearAll();
    prSubscriptionRegistry.closeAll();

    // Stop Slack app
    await slackApp.stop();

    console.log("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Main application entry point
 */
async function main() {
  console.log("Clive Slack app starting...\n");

  // Load configuration
  const configResult = loadConfig();
  if (configResult._tag === "Left") {
    console.error("Configuration error:", configResult.left);
    process.exit(1);
  }
  const config = configResult.right;

  console.log("Configuration loaded successfully");
  console.log(`Mode: ${config.mode.toUpperCase()}`);
  console.log(`Port: ${config.port}\n`);

  if (config.mode === "distributed") {
    await startDistributedMode(config);
  } else {
    await startLocalMode(config);
  }
}

// Run the application
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
