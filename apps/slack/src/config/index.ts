/**
 * Configuration module for Clive Slack integration
 *
 * Loads configuration from environment variables with optional .env fallback.
 */

import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from monorepo root only
const __dirname = fileURLToPath(new URL(".", import.meta.url));
loadDotenv({ path: resolve(__dirname, "../../../../.env") });

/**
 * Operation mode
 */
export type OperationMode = "local" | "distributed";

/**
 * Configuration for the Slack integration
 */
export interface SlackConfig {
  /** Slack Bot OAuth Token (starts with xoxb-) */
  slackBotToken: string;
  /** Slack Signing Secret for verifying requests */
  slackSigningSecret: string;
  /** ngrok auth token for tunnel (required for local mode) */
  ngrokAuthToken?: string;
  /** Port to run the server on */
  port: number;
  /** Workspace root directory for Claude CLI (local mode only) */
  workspaceRoot: string;
  /** Session timeout in milliseconds (default 30 minutes) */
  sessionTimeoutMs: number;
  /** Operation mode: 'local' (single user) or 'distributed' (worker swarm) */
  mode: OperationMode;
  /** API token for worker authentication (distributed mode) */
  workerApiToken?: string;
  /** WebSocket path for worker connections (distributed mode) */
  wsPath: string;
}

/**
 * Either type for configuration result
 */
export type Either<L, R> =
  | { _tag: "Left"; left: L }
  | { _tag: "Right"; right: R };

const left = <L>(value: L): Either<L, never> => ({ _tag: "Left", left: value });
const right = <R>(value: R): Either<never, R> => ({
  _tag: "Right",
  right: value,
});

/**
 * Configuration validation errors
 */
export interface ConfigError {
  message: string;
  missingVariables: string[];
}

/**
 * Load and validate configuration from environment
 */
export function loadConfig(): Either<ConfigError, SlackConfig> {
  const missingVariables: string[] = [];

  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  if (!slackBotToken) {
    missingVariables.push("SLACK_BOT_TOKEN");
  }

  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
  if (!slackSigningSecret) {
    missingVariables.push("SLACK_SIGNING_SECRET");
  }

  // Determine operation mode (distributed is default)
  const mode = (process.env.CLIVE_MODE || "distributed") as OperationMode;

  // Mode-specific validation
  const ngrokAuthToken = process.env.NGROK_AUTH_TOKEN;
  if (mode === "local" && !ngrokAuthToken) {
    missingVariables.push("NGROK_AUTH_TOKEN");
  }

  const workerApiToken = process.env.CLIVE_WORKER_API_TOKEN;
  if (mode === "distributed" && !workerApiToken) {
    missingVariables.push("CLIVE_WORKER_API_TOKEN");
  }

  if (missingVariables.length > 0) {
    return left({
      message: `Missing required environment variables: ${missingVariables.join(", ")}`,
      missingVariables,
    });
  }

  const port = parseInt(process.env.SLACK_PORT || "3000", 10);
  const workspaceRoot = process.env.CLIVE_WORKSPACE || process.cwd();
  const sessionTimeoutMs = parseInt(
    process.env.SESSION_TIMEOUT_MS || String(30 * 60 * 1000),
    10
  );
  const wsPath = process.env.CLIVE_WS_PATH || "/ws";

  return right({
    slackBotToken: slackBotToken!,
    slackSigningSecret: slackSigningSecret!,
    ngrokAuthToken,
    port,
    workspaceRoot,
    sessionTimeoutMs,
    mode,
    workerApiToken,
    wsPath,
  });
}

/**
 * Get configuration value with type safety
 */
export function getConfigValue<K extends keyof SlackConfig>(
  config: SlackConfig,
  key: K
): SlackConfig[K] {
  return config[key];
}
