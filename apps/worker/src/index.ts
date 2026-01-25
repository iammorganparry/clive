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

// Load env from monorepo root
const __dirname = fileURLToPath(new URL(".", import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../../../.env") });

import { loadConfig } from "./config.js";
import { WorkerClient } from "./worker-client.js";

async function main(): Promise<void> {
  console.log("Clive Worker starting...");
  console.log("");

  // Load configuration
  const configResult = loadConfig();
  if (configResult._tag === "Left") {
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

  // Create worker client
  const worker = new WorkerClient(config);

  // Set up event handlers
  worker.on("connected", () => {
    console.log("Connected to central service");
  });

  worker.on("disconnected", (reason) => {
    console.log(`Disconnected: ${reason}`);
  });

  worker.on("registered", (workerId) => {
    console.log(`Registered as worker: ${workerId}`);
  });

  worker.on("error", (error) => {
    console.error("Worker error:", error.message);
  });

  worker.on("configUpdate", (config) => {
    console.log("Received config update:", config);
  });

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log("\nShutting down...");
    await worker.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Connect to central service
  try {
    await worker.connect();
    console.log("");
    console.log(`Worker ${worker.getWorkerId()} is ready`);
    console.log("Waiting for interview requests...");
    console.log("");
  } catch (error) {
    console.error("Failed to connect:", error);
    process.exit(1);
  }
}

// Run the worker
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
