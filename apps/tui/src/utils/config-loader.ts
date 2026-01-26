/**
 * Unified config loading utility
 * Single source of truth for loading Linear/issue tracker configuration
 *
 * All config is loaded from and saved to workspace .clive/ directory only.
 * Global ~/.clive/ directory is NOT used (no fallback, no merging).
 *
 * API Key Priority:
 * 1. LINEAR_API_KEY environment variable (if already set externally)
 * 2. Workspace .clive/.env file
 * 3. Config file's apiKey field
 *
 * SECURITY: Path traversal validation is performed on all workspace paths
 * to prevent directory escape attacks.
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
 * SECURITY: Validate that a path doesn't escape the base directory (path traversal prevention)
 * Returns true if the path is safe (stays within basePath), false otherwise.
 *
 * Examples:
 * - validatePathTraversal("/home/user/project/.clive", "/home/user/project") -> true
 * - validatePathTraversal("/home/user/project/../../../etc/passwd", "/home/user/project") -> false
 * - validatePathTraversal("/home/user/other/config", "/home/user/project") -> false
 */
export function validatePathTraversal(targetPath: string, basePath: string): boolean {
  try {
    // Resolve both paths to absolute, normalized paths
    const resolvedTarget = path.resolve(targetPath);
    const resolvedBase = path.resolve(basePath);

    // Ensure the target path starts with the base path
    // Add path separator to avoid matching partial directory names
    // e.g., "/home/user/project-evil" should not match base "/home/user/project"
    const normalizedBase = resolvedBase.endsWith(path.sep)
      ? resolvedBase
      : resolvedBase + path.sep;

    // Target is safe if:
    // 1. It equals the base path exactly, OR
    // 2. It starts with the base path followed by separator
    return resolvedTarget === resolvedBase || resolvedTarget.startsWith(normalizedBase);
  } catch {
    // If path resolution fails, treat as unsafe
    return false;
  }
}

/**
 * Get a safe workspace path, validating it doesn't escape expected boundaries.
 * Returns the validated workspace path or throws an error if path traversal detected.
 */
function getSafeWorkspacePath(workspaceRoot?: string): string {
  const workspace = workspaceRoot || process.env.CLIVE_WORKSPACE || process.cwd();

  // Resolve to absolute path
  const resolvedWorkspace = path.resolve(workspace);

  // Basic sanity checks
  if (!resolvedWorkspace || resolvedWorkspace === "/") {
    throw new Error("[config-loader] Invalid workspace path: cannot be root directory");
  }

  // Check for null bytes (common injection technique)
  if (resolvedWorkspace.includes("\0")) {
    throw new Error("[config-loader] Invalid workspace path: contains null bytes");
  }

  return resolvedWorkspace;
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
 * Load environment variables from workspace .clive/.env only
 * Sets process.env values
 * SECURITY: Validates workspace path to prevent path traversal
 */
export function loadEnvFile(workspaceRoot?: string): void {
  let workspace: string;
  try {
    workspace = getSafeWorkspacePath(workspaceRoot);
  } catch (error) {
    console.error("[config-loader] Path validation failed in loadEnvFile:", error);
    return;
  }
  const workspaceEnvPath = path.join(workspace, ".clive", ".env");

  // Load workspace env only - no global fallback
  const workspaceEnv = parseEnvFile(workspaceEnvPath);

  // Set in process.env (always update to ensure workspace values take effect)
  for (const [key, value] of Object.entries(workspaceEnv)) {
    // Skip placeholder values
    if (isPlaceholderValue(value)) {
      continue;
    }
    process.env[key] = value;
  }
}

/**
 * Save a sensitive value to workspace .clive/.env file
 * @param key - The environment variable key
 * @param value - The value to save
 * @param workspaceRoot - Optional workspace root (defaults to CLIVE_WORKSPACE or cwd)
 * SECURITY: Validates workspace path to prevent path traversal
 */
export function saveEnvValue(key: string, value: string, workspaceRoot?: string): void {
  try {
    const workspace = getSafeWorkspacePath(workspaceRoot);
    const workspaceConfigDir = path.join(workspace, ".clive");
    const workspaceEnvPath = path.join(workspaceConfigDir, ".env");

    // Create workspace .clive directory if needed
    if (!fs.existsSync(workspaceConfigDir)) {
      fs.mkdirSync(workspaceConfigDir, { recursive: true });
    }

    // Read existing workspace .env content
    let envContent = "";
    if (fs.existsSync(workspaceEnvPath)) {
      envContent = fs.readFileSync(workspaceEnvPath, "utf-8");
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

    fs.writeFileSync(workspaceEnvPath, updatedLines.join("\n"), "utf-8");
    // Set restrictive permissions (owner read/write only)
    fs.chmodSync(workspaceEnvPath, 0o600);

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
 * Load config from workspace .clive/config.json only
 * Also loads env file to ensure LINEAR_API_KEY is available
 * SECURITY: Validates workspace path to prevent path traversal
 */
export function loadConfig(workspaceRoot?: string): IssueTrackerConfig | null {
  let workspace: string;
  try {
    workspace = getSafeWorkspacePath(workspaceRoot);
  } catch (error) {
    console.error("[config-loader] Path validation failed in loadConfig:", error);
    return null;
  }

  // Load env file from workspace only
  loadEnvFile(workspace);
  const workspaceConfigPath = path.join(workspace, ".clive", "config.json");

  // Load workspace config only - no global fallback
  const config = loadConfigFromPath(workspaceConfigPath);

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
 * Save config to workspace .clive/config.json
 * API keys and tokens are saved separately in workspace .clive/.env for security
 * @param config - The config to save
 * @param workspaceRoot - Optional workspace root (defaults to CLIVE_WORKSPACE or cwd)
 * SECURITY: Validates workspace path to prevent path traversal
 */
export function saveConfig(config: IssueTrackerConfig, workspaceRoot?: string): void {
  try {
    const workspace = getSafeWorkspacePath(workspaceRoot);
    const workspaceConfigDir = path.join(workspace, ".clive");
    const workspaceConfigPath = path.join(workspaceConfigDir, "config.json");

    // Create workspace .clive directory if needed
    if (!fs.existsSync(workspaceConfigDir)) {
      fs.mkdirSync(workspaceConfigDir, { recursive: true });
    }

    // Load existing config from workspace to merge with (prevents data loss)
    let existingConfig: IssueTrackerConfig = {};
    try {
      if (fs.existsSync(workspaceConfigPath)) {
        const content = fs.readFileSync(workspaceConfigPath, "utf-8");
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

    // Extract API key if present and save separately to workspace .env
    if (configToSave.linear?.apiKey) {
      saveEnvValue("LINEAR_API_KEY", configToSave.linear.apiKey, workspace);
      // Remove apiKey from config before saving
      delete (configToSave.linear as { apiKey?: string }).apiKey;
    }

    // Extract worker token if present and save separately to workspace .env
    if (configToSave.worker?.token) {
      saveEnvValue("CLIVE_WORKER_TOKEN", configToSave.worker.token, workspace);
      // Remove token from config before saving
      delete (configToSave.worker as { token?: string }).token;
    }

    fs.writeFileSync(
      workspaceConfigPath,
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
