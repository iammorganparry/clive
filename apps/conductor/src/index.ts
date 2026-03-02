/**
 * Conductor Entry Point
 *
 * HTTP server exposing:
 * - POST /request -- Submit a new orchestration request
 * - GET /status/:id -- Get task status
 * - GET /tasks -- List all tasks
 * - GET /health -- Health check
 * - POST /cancel/:id -- Cancel a task
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { AcpxClient } from "./acpx-client.js";
import { AgentManager } from "./agent-manager.js";
import { CiMonitor } from "./ci-monitor.js";
import { Conductor } from "./conductor.js";
import { loadConfig } from "./config.js";
import { MonitorLoop } from "./monitor-loop.js";
import { PrMonitor } from "./pr-monitor.js";
import { ResourceGovernor } from "./resource-governor.js";
import { SlackReporter } from "./slack-reporter.js";
import { TaskRegistry } from "./task-registry.js";
import type { ConductorRequest } from "./types.js";

const config = loadConfig();

// Initialize components
const registry = new TaskRegistry(config.registryPath, config.workspace);
const acpx = new AcpxClient(config.openclawGatewayUrl);
const governor = new ResourceGovernor(config.maxAgents);
const agentManager = new AgentManager(acpx, registry, governor, config);
const ciMonitor = new CiMonitor(config.workspace);
const prMonitor = new PrMonitor(config.workspace);
const slackReporter = new SlackReporter(config);
const monitorLoop = new MonitorLoop(
  registry,
  agentManager,
  ciMonitor,
  prMonitor,
  slackReporter,
  config,
);

const conductor = new Conductor(
  config,
  registry,
  agentManager,
  monitorLoop,
  slackReporter,
  prMonitor,
  acpx,
);

// HTTP request handler
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url || "/", `http://localhost:${config.port}`);
  const method = req.method || "GET";

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // POST /request
    if (method === "POST" && url.pathname === "/request") {
      const body = await readBody(req);
      const request: ConductorRequest = JSON.parse(body);
      const task = await conductor.handleRequest(request);
      json(res, 201, task);
      return;
    }

    // GET /status/:id
    if (method === "GET" && url.pathname.startsWith("/status/")) {
      const id = url.pathname.split("/")[2];
      const task = conductor.getStatus(id);
      if (!task) {
        json(res, 404, { error: "Task not found" });
        return;
      }
      json(res, 200, task);
      return;
    }

    // GET /tasks
    if (method === "GET" && url.pathname === "/tasks") {
      json(res, 200, conductor.getAllTasks());
      return;
    }

    // POST /cancel/:id
    if (method === "POST" && url.pathname.startsWith("/cancel/")) {
      const id = url.pathname.split("/")[2];
      const task = conductor.getStatus(id);
      if (!task) {
        json(res, 404, { error: "Task not found" });
        return;
      }
      registry.transitionState(id, "failed");
      json(res, 200, { message: "Task cancelled", id });
      return;
    }

    // GET /health
    if (method === "GET" && url.pathname === "/health") {
      json(res, 200, {
        status: "ok",
        activeTasks: registry.active().length,
        governor: governor.stats(),
      });
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (error) {
    console.error("[HTTP] Request error:", error);
    json(res, 500, {
      error: error instanceof Error ? error.message : "Internal error",
    });
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

// Start server
const server = createServer(handleRequest);

conductor.start().then(() => {
  server.listen(config.port, () => {
    console.log(`[Conductor] HTTP server listening on port ${config.port}`);
    console.log(`[Conductor] Workspace: ${config.workspace}`);
    console.log(`[Conductor] Gateway: ${config.openclawGatewayUrl}`);
    console.log(`[Conductor] Max agents: ${config.maxAgents}`);
  });
});

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    console.log(`[Conductor] Received ${signal}, shutting down...`);
    await conductor.stop();
    server.close(() => process.exit(0));
  });
}
