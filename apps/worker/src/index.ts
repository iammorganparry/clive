#!/usr/bin/env node

/**
 * Clive Worker
 *
 * Distributed worker for executing Claude CLI interviews.
 * Connects to central Slack service and executes interviews locally.
 *
 * Usage:
 *   CLIVE_WORKER_TOKEN=xxx clive-worker
 *   CLIVE_WORKER_TOKEN=xxx yarn dev
 *
 * Environment variables:
 *   CLIVE_WORKER_TOKEN      - API token for authentication (required)
 *   CLIVE_CENTRAL_URL       - WebSocket URL of central service
 *   CLIVE_WORKSPACE_ROOT    - Workspace root directory (default: cwd)
 *   CLIVE_WORKER_HOSTNAME   - Worker hostname for identification
 *   CLIVE_HEARTBEAT_INTERVAL - Heartbeat interval in ms (default: 30000)
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";
import { Effect, Layer, Stream } from "effect";

// Load env from monorepo root
const __dirname = fileURLToPath(new URL(".", import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../../../.env") });

import { loadConfig } from "./config.js";
import { makeWorkerClientLayer, WorkerClient } from "./worker-client.js";

/**
 * Main program as an Effect (config already validated in run())
 */
const main = Effect.gen(function* () {
  // Get the WorkerClient service
  const client = yield* WorkerClient;

  // Set up event handling in background
  yield* Effect.fork(
    Stream.runForEach(client.events, (event) =>
      Effect.sync(() => {
        switch (event.type) {
          case "connected":
            console.log("Connected to central service");
            break;
          case "disconnected":
            console.log(`Disconnected: ${event.reason}`);
            break;
          case "registered":
            console.log(`Registered as worker: ${event.workerId}`);
            break;
          case "error":
            console.error("Worker error:", event.error.message);
            break;
          case "configUpdate":
            console.log("Received config update:", event.config);
            break;
        }
      }),
    ),
  );

  // Connect to central service
  yield* client.connect.pipe(
    Effect.catchTag("WorkerClientError", (error) =>
      Effect.gen(function* () {
        console.error("Failed to connect:", error.message);
        return yield* Effect.fail(error);
      }),
    ),
  );

  const workerId = yield* client.getWorkerId;
  console.log("");
  console.log(`Worker ${workerId} is ready`);
  console.log("Waiting for interview requests...");
  console.log("");

  // Keep the worker running until interrupted
  yield* Effect.never;
});

/**
 * Run the worker with graceful shutdown
 */
async function run(): Promise<void> {
  // Load configuration for layer
  const configResult = loadConfig();
  if (configResult._tag === "Left") {
    // Config error - print message and exit
    console.error("Configuration error:", configResult.left);
    console.log("");
    console.log("Required environment variables:");
    console.log("  CLIVE_WORKER_TOKEN - API token for authentication");
    console.log("");
    console.log("Optional environment variables:");
    console.log("  CLIVE_CENTRAL_URL       - Central service WebSocket URL");
    console.log("  CLIVE_WORKSPACE_ROOT    - Workspace root directory");
    console.log("  CLIVE_WORKER_HOSTNAME   - Worker hostname");
    console.log("  CLIVE_HEARTBEAT_INTERVAL - Heartbeat interval (ms)");
    process.exit(1);
  }

  const config = configResult.right;

  console.log("Clive Worker starting...");
  console.log("");
  console.log("Configuration:");
  console.log(`  Central URL: ${config.centralServiceUrl}`);
  console.log(`  Projects:`);
  for (const project of config.projects) {
    console.log(`    - ${project.name} (${project.id}): ${project.path}`);
  }
  console.log(
    `  Default:     ${config.defaultProject || config.projects[0].id}`,
  );
  console.log(`  Hostname:    ${config.hostname}`);
  console.log("");

  // Create the layer with config
  const WorkerClientLayer = makeWorkerClientLayer(config);

  // Set up graceful shutdown
  let shutdownRequested = false;

  const shutdown = async (): Promise<void> => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    console.log("\nShutting down...");
    // The Effect runtime will handle cleanup via scoped resources
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Run the main program with the layer
  try {
    await Effect.runPromise(
      main.pipe(
        Effect.provide(WorkerClientLayer),
        Effect.catchAll((error) =>
          Effect.sync(() => {
            console.error("Fatal error:", error);
            process.exit(1);
          }),
        ),
      ),
    );
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

// Run the worker
run();
