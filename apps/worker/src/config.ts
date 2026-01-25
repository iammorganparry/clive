/**
 * Worker Configuration
 *
 * Loads configuration from environment variables.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { WorkerProject } from "@clive/worker-protocol";
import { Either } from "effect";

/**
 * Project configuration from config file or env var
 */
export interface ProjectConfig {
  id: string;
  name: string;
  path: string;
  aliases?: string[];
  description?: string;
}

export interface WorkerConfig {
  /** API token for authentication with central service */
  apiToken: string;
  /** Central service base URL */
  centralServiceUrl: string;
  /** Projects this worker has access to */
  projects: WorkerProject[];
  /** Default project ID if none specified in request */
  defaultProject?: string;
  /** Worker hostname (for identification) */
  hostname: string;
  /** Heartbeat interval in milliseconds */
  heartbeatInterval: number;
  /** Reconnect delay in milliseconds */
  reconnectDelay: number;
  /** Max reconnect attempts */
  maxReconnectAttempts: number;
}

/**
 * Parse projects from environment variable or config file
 *
 * Supports multiple formats:
 * 1. Single path: CLIVE_WORKSPACE_ROOT=/path/to/project
 * 2. JSON array: CLIVE_PROJECTS='[{"id":"app","name":"My App","path":"/path"}]'
 * 3. Config file: CLIVE_PROJECTS_FILE=./projects.json
 * 4. Comma-separated paths: CLIVE_WORKSPACE_ROOTS=/path/one,/path/two
 */
function parseProjects(): WorkerProject[] {
  // Method 1: JSON array in CLIVE_PROJECTS env var
  const projectsJson = process.env.CLIVE_PROJECTS;
  if (projectsJson) {
    try {
      const parsed = JSON.parse(projectsJson) as ProjectConfig[];
      return parsed.map((p) => ({
        id: p.id,
        name: p.name,
        path: path.resolve(p.path),
        aliases: p.aliases,
        description: p.description,
      }));
    } catch (error) {
      console.error("[Config] Failed to parse CLIVE_PROJECTS:", error);
    }
  }

  // Method 2: Config file
  const configFile = process.env.CLIVE_PROJECTS_FILE;
  if (configFile && fs.existsSync(configFile)) {
    try {
      const content = fs.readFileSync(configFile, "utf-8");
      const parsed = JSON.parse(content) as ProjectConfig[];
      return parsed.map((p) => ({
        id: p.id,
        name: p.name,
        path: path.resolve(p.path),
        aliases: p.aliases,
        description: p.description,
      }));
    } catch (error) {
      console.error(
        `[Config] Failed to read projects file ${configFile}:`,
        error,
      );
    }
  }

  // Method 3: Comma-separated paths
  const workspaceRoots = process.env.CLIVE_WORKSPACE_ROOTS;
  if (workspaceRoots) {
    return workspaceRoots.split(",").map((p, _i) => {
      const resolvedPath = path.resolve(p.trim());
      const name = path.basename(resolvedPath);
      return {
        id: name,
        name,
        path: resolvedPath,
      };
    });
  }

  // Method 4: Single workspace root (backwards compatible)
  const workspaceRoot = process.env.CLIVE_WORKSPACE_ROOT || process.cwd();
  const resolvedPath = path.resolve(workspaceRoot);
  const name = path.basename(resolvedPath);
  return [
    {
      id: name,
      name,
      path: resolvedPath,
    },
  ];
}

/**
 * Load worker configuration from environment
 */
export function loadConfig(): Either.Either<WorkerConfig, string> {
  const apiToken = process.env.CLIVE_WORKER_TOKEN;
  if (!apiToken) {
    return Either.left("CLIVE_WORKER_TOKEN environment variable is required");
  }

  const centralServiceUrl =
    process.env.CLIVE_CENTRAL_URL || "wss://clive-central.example.com";

  const projects = parseProjects();
  if (projects.length === 0) {
    return Either.left("At least one project must be configured");
  }

  const defaultProject = process.env.CLIVE_DEFAULT_PROJECT || projects[0].id;

  const hostname = process.env.CLIVE_WORKER_HOSTNAME || os.hostname();

  const heartbeatInterval = Number.parseInt(
    process.env.CLIVE_HEARTBEAT_INTERVAL || "30000",
    10,
  );

  const reconnectDelay = Number.parseInt(
    process.env.CLIVE_RECONNECT_DELAY || "5000",
    10,
  );

  const maxReconnectAttempts = Number.parseInt(
    process.env.CLIVE_MAX_RECONNECT_ATTEMPTS || "10",
    10,
  );

  return Either.right({
    apiToken,
    centralServiceUrl,
    projects,
    defaultProject,
    hostname,
    heartbeatInterval,
    reconnectDelay,
    maxReconnectAttempts,
  });
}
