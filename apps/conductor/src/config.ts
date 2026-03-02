/**
 * Conductor Configuration
 *
 * Loads configuration from environment variables with sensible defaults.
 */

import "dotenv/config";

export interface ConductorConfig {
  /** HTTP server port */
  port: number;
  /** Maximum concurrent agents */
  maxAgents: number;
  /** Monitor loop interval in ms */
  monitorInterval: number;
  /** Path to the main workspace/repo */
  workspace: string;
  /** Base directory for worktrees */
  worktreeDir: string;
  /** Path to the task registry JSON file */
  registryPath: string;
  /** OpenClaw gateway URL */
  openclawGatewayUrl: string;
  /** Slack bot token for reporting */
  slackBotToken?: string;
  /** Max retries before failing a task */
  maxRetries: number;
  /** Minutes of inactivity before an agent is considered stuck */
  stuckThresholdMinutes: number;
}

export function loadConfig(): ConductorConfig {
  return {
    port: parseInt(process.env.CONDUCTOR_PORT || "3847", 10),
    maxAgents: parseInt(process.env.CONDUCTOR_MAX_AGENTS || "3", 10),
    monitorInterval: parseInt(process.env.CONDUCTOR_MONITOR_INTERVAL || "30000", 10),
    workspace: process.env.CONDUCTOR_WORKSPACE || process.cwd(),
    worktreeDir: process.env.CONDUCTOR_WORKTREE_DIR || `${process.env.HOME}/.clive/worktrees`,
    registryPath: process.env.CONDUCTOR_REGISTRY_PATH || ".conductor/active-tasks.json",
    openclawGatewayUrl: process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:18789",
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    maxRetries: parseInt(process.env.CONDUCTOR_MAX_RETRIES || "3", 10),
    stuckThresholdMinutes: parseInt(process.env.CONDUCTOR_STUCK_THRESHOLD || "10", 10),
  };
}
