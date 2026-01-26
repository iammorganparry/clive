/**
 * Unified config loading utility
 * Single source of truth for loading Linear/issue tracker configuration
 *
 * Priority:
 * 1. Workspace config (.clive/config.json in current workspace)
 * 2. Global config (~/.clive/config.json)
 *
 * API Key priority:
 * 1. LINEAR_API_KEY environment variable (already set)
 * 2. Workspace .clive/.env file
 * 3. Global ~/.clive/.env file
 * 4. Config file's apiKey field
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Config, LinearConfig, WorkerConfig } from "../types";

// Re-export types for convenience
export type { Config, LinearConfig, WorkerConfig } from "../types";

// Alias for backwards compatibility
export type IssueTrackerConfig = Config;

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), ".clive");
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, "config.json");
const GLOBAL_ENV_PATH = path.join(GLOBAL_CONFIG_DIR, ".env");

/**
 * Check if a value looks like a placeholder that shouldn't override real values
 * Detects common placeholder patterns used in example configs
 */
function isPlaceholderValue(value: string): boolean {
  const placeholderPatterns = [
    /YOUR_.*_HERE/i,       // YOUR_API_KEY_HERE, YOUR_TOKEN_HERE, etc.
    /CHANGE_ME/i,          // CHANGE_ME
    /REPLACE_THIS/i,       // REPLACE_THIS
    /PLACEHOLDER/i,        // placeholder, PLACEHOLDER
    /TODO/i,               // TODO:..., TODO_REPLACE
    /^xxx+$/i,             // xxx, XXXX, etc.
    /^<.*>$/,              // <your-key-here>, <api-key>
    /INSERT_.*_HERE/i,     // INSERT_KEY_HERE
    /EXAMPLE_/i,           // EXAMPLE_KEY
    /DEMO_/i,              // DEMO_TOKEN
    /YOUR_.*_KEY$/i,       // YOUR_LINEAR_KEY (without _HERE suffix)
  ];
  return placeholderPatterns.some(pattern => pattern.test(value.trim()));
}

/**
 * Parse an .env file and return key-value pairs
 */
function parseEnvFile(envPath: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const [key, ...valueParts] = trimmed.split("=");
          if (key && valueParts.length > 0) {
            const value = valueParts.join("=").trim();
            // Remove quotes if present
            const cleanValue = value.replace(/^["']|["']$/g, "");
            result[key.trim()] = cleanValue;
          }
        }
      }
    }
  } catch (error) {
    // Ignore errors reading .env file
  }
  return result;
}

/**
 * Load environment variables with priority: workspace .env > global .env
 * Sets process.env values
 */
export function loadEnvFile(workspaceRoot?: string): void {
  const workspace = workspaceRoot || process.env.CLIVE_WORKSPACE || process.cwd();
  const workspaceEnvPath = path.join(workspace, ".clive", ".env");

  // Load global env first (lower priority)
  const globalEnv = parseEnvFile(GLOBAL_ENV_PATH);

  // Load workspace env (higher priority, but only if not a placeholder)
  const workspaceEnv = parseEnvFile(workspaceEnvPath);

  // Merge: workspace takes precedence UNLESS it's a placeholder value
  // This prevents example/template configs from overriding real API keys
  const mergedEnv: Record<string, string> = { ...globalEnv };
  for (const [key, value] of Object.entries(workspaceEnv)) {
    // Only use workspace value if it's not a placeholder
    // OR if there's no global value to preserve
    if (!isPlaceholderValue(value) || !globalEnv[key]) {
      mergedEnv[key] = value;
    }
  }

  // Set in process.env (only if not already set by actual env var)
  for (const [key, value] of Object.entries(mergedEnv)) {
    // Don't override if already set by real environment variable
    // Check if it was set before we started (not by previous loadEnvFile call)
    if (!process.env[key] || process.env[`_CLIVE_LOADED_${key}`]) {
      process.env[key] = value;
      process.env[`_CLIVE_LOADED_${key}`] = "1"; // Mark as loaded by us
    }
  }
}

/**
 * Save a sensitive value to ~/.clive/.env file
 */
export function saveEnvValue(key: string, value: string): void {
  try {
    if (!fs.existsSync(GLOBAL_CONFIG_DIR)) {
      fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    }

    // Read existing .env content
    let envContent = "";
    if (fs.existsSync(GLOBAL_ENV_PATH)) {
      envContent = fs.readFileSync(GLOBAL_ENV_PATH, "utf-8");
    }

    // Update or add the key
    const lines = envContent.split("\n");
    let found = false;
    const updatedLines = lines.map((line) => {
      if (line.trim().startsWith(`${key}=`)) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });

    if (!found) {
      // Filter out empty lines at the end before adding
      while (
        updatedLines.length > 0 &&
        updatedLines[updatedLines.length - 1] === ""
      ) {
        updatedLines.pop();
      }
      updatedLines.push(`${key}=${value}`);
    }

    fs.writeFileSync(GLOBAL_ENV_PATH, updatedLines.join("\n"), "utf-8");
    // Set restrictive permissions (owner read/write only)
    fs.chmodSync(GLOBAL_ENV_PATH, 0o600);

    // Also set in current process env
    process.env[key] = value;
  } catch (error) {
    console.error(`[config-loader] Failed to save ${key}:`, error);
  }
}

/**
 * Normalize Linear config fields (handle snake_case and camelCase)
 */
function normalizeLinearConfig(
  linear: Record<string, unknown> | undefined,
): LinearConfig | undefined {
  if (!linear) return undefined;

  // API key priority: env var > config file
  const apiKey =
    process.env.LINEAR_API_KEY ||
    (linear.apiKey as string) ||
    (linear.api_key as string);

  const teamID =
    (linear.teamID as string) ||
    (linear.team_id as string) ||
    (linear.teamId as string);

  if (!apiKey || !teamID) return undefined;

  return { apiKey, teamID };
}

/**
 * Load config from a specific path
 */
function loadConfigFromPath(configPath: string): IssueTrackerConfig | null {
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      const raw = JSON.parse(content);

      return {
        issueTracker: raw.issueTracker || raw.issue_tracker || null,
        linear: normalizeLinearConfig(raw.linear),
        beads: raw.beads,
        worker: raw.worker,
      };
    }
  } catch (error) {
    // Config doesn't exist or is invalid
  }
  return null;
}

/**
 * Load config with priority: workspace > global
 * Also loads env file to ensure LINEAR_API_KEY is available
 */
export function loadConfig(workspaceRoot?: string): IssueTrackerConfig | null {
  const workspace = workspaceRoot || process.env.CLIVE_WORKSPACE || process.cwd();

  // Load env file with workspace context (workspace .env takes priority over global)
  loadEnvFile(workspace);
  const workspaceConfigPath = path.join(workspace, ".clive", "config.json");

  // Try workspace config first
  let config = loadConfigFromPath(workspaceConfigPath);

  // Fall back to global config
  if (!config) {
    config = loadConfigFromPath(GLOBAL_CONFIG_PATH);
  }

  // If we have a config but Linear is missing API key, try to get it from env
  if (config?.issueTracker === "linear" && config.linear) {
    // Re-normalize to pick up env var
    const normalized = normalizeLinearConfig(config.linear as unknown as Record<string, unknown>);
    if (normalized) {
      config.linear = normalized;
    }
  }

  return config;
}

/**
 * Save config to global ~/.clive/config.json
 * API keys and tokens are saved separately in ~/.clive/.env for security
 */
export function saveConfig(config: IssueTrackerConfig): void {
  try {
    if (!fs.existsSync(GLOBAL_CONFIG_DIR)) {
      fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    }

    // Load existing config from disk to merge with (prevents data loss)
    let existingConfig: IssueTrackerConfig = {};
    try {
      if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
        const content = fs.readFileSync(GLOBAL_CONFIG_PATH, "utf-8");
        existingConfig = JSON.parse(content) as IssueTrackerConfig;
      }
    } catch {
      // Ignore errors reading existing config
    }

    // Deep clone the new config to avoid mutating the original
    const newConfig = JSON.parse(JSON.stringify(config)) as IssueTrackerConfig;

    // Merge: new config takes precedence, but preserve fields not in new config
    const configToSave: IssueTrackerConfig = {
      ...existingConfig,
      ...newConfig,
      // Preserve linear config if not explicitly set in new config
      linear: newConfig.linear ?? existingConfig.linear,
      // Preserve worker config if not explicitly set in new config
      worker: newConfig.worker ?? existingConfig.worker,
    };

    // Extract API key if present and save separately
    if (configToSave.linear?.apiKey) {
      saveEnvValue("LINEAR_API_KEY", configToSave.linear.apiKey);
      // Remove apiKey from config before saving
      delete (configToSave.linear as { apiKey?: string }).apiKey;
    }

    // Extract worker token if present and save separately
    if (configToSave.worker?.token) {
      saveEnvValue("CLIVE_WORKER_TOKEN", configToSave.worker.token);
      // Remove token from config before saving
      delete (configToSave.worker as { token?: string }).token;
    }

    fs.writeFileSync(
      GLOBAL_CONFIG_PATH,
      JSON.stringify(configToSave, null, 2),
      "utf-8",
    );
  } catch (error) {
    console.error("[config-loader] Failed to save config:", error);
  }
}

/**
 * Get the global config directory path
 */
export function getConfigDir(): string {
  return GLOBAL_CONFIG_DIR;
}

/**
 * Get the global config file path
 */
export function getConfigPath(): string {
  return GLOBAL_CONFIG_PATH;
}
