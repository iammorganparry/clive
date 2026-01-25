/**
 * Clive Slack Integration
 *
 * Enables planning interviews via @mention in Slack channels.
 *
 * Supports two operation modes:
 * - Local: Single-user deployment with local Claude CLI and ngrok tunnel
 * - Distributed: Central service with worker swarm for multi-user support
 */

import { createServer, type Server } from "http";
import { Effect, Console, pipe } from "effect";
import { App as SlackApp, LogLevel } from "@slack/bolt";
import HTTPReceiverModule from "@slack/bolt/dist/receivers/HTTPReceiver.js";
import { loadConfig, type SlackConfig } from "./config";

// Handle CommonJS default export in ESM
const HTTPReceiver =
  (HTTPReceiverModule as unknown as { default: typeof HTTPReceiverModule })
    .default ?? HTTPReceiverModule;
import { TunnelService, TunnelServiceError } from "./services/tunnel-service";
import { SlackService, SlackServiceError } from "./services/slack-service";
import { InterviewStore } from "./store/interview-store";
import { ClaudeManager } from "./services/claude-manager";
import { WorkerRegistry } from "./services/worker-registry";
import { SessionRouter } from "./services/session-router";
import { WorkerProxy } from "./services/worker-proxy";
import { EventServer } from "./websocket/event-server";
import {
  registerMentionHandler,
  registerMentionHandlerDistributed,
} from "./handlers/mention-handler";
import {
  registerMessageHandler,
  registerMessageHandlerDistributed,
} from "./handlers/message-handler";
import {
  registerActionHandler,
  registerActionHandlerDistributed,
} from "./handlers/action-handler";

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

  // Create HTTP receiver with custom routes for health checks and worker token
  const receiver = new HTTPReceiver({
    signingSecret: config.slackSigningSecret,
    port: config.port,
    customRoutes: [
      {
        path: "/health",
        method: "GET",
        handler: (_req, res) => {
          res.writeHead(200);
          res.end("OK");
        },
      },
      {
        path: "/api/worker-token",
        method: "GET",
        handler: (_req, res) => {
          // Return the worker token for seamless TUI setup
          // This allows workers to auto-configure without manual token entry
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ token: config.workerApiToken }));
        },
      },
    ],
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

  // Register handlers (distributed mode)
  registerMentionHandlerDistributed(
    slackApp,
    interviewStore,
    workerProxy,
    slackService,
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
  sessionRouter.on("sessionUnassigned", async (sessionId, workerId, reason) => {
    const session = interviewStore.get(sessionId);
    if (session && session.phase !== "completed" && session.phase !== "error") {
      await Effect.runPromise(
        slackService.postMessage({
          channel: session.channel,
          text: `Interview interrupted: Worker disconnected (${reason}). Please @mention Clive again to restart.`,
          threadTs: session.threadTs,
        }),
      );
      interviewStore.setError(sessionId, `Worker disconnected: ${reason}`);
    }
  });

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
  );

  console.log(`\nWaiting for workers to connect...`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");

    // Close WebSocket connections
    eventServer.close();

    // Close all interview sessions
    interviewStore.closeAll();
    workerProxy.closeAll();
    workerRegistry.closeAll();
    sessionRouter.clearAll();

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
