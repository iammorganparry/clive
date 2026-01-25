/**
 * Debug Logger
 * Writes debug logs to a file for easier troubleshooting
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const LOG_FILE_PATH = path.join(os.homedir(), ".clive", "tui-debug.log");

// Ensure log directory exists
function ensureLogDir() {
  const logDir = path.dirname(LOG_FILE_PATH);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

// Initialize log file
function initLogFile() {
  try {
    ensureLogDir();
    const timestamp = new Date().toISOString();
    fs.writeFileSync(
      LOG_FILE_PATH,
      `\n\n=== Clive TUI Debug Log - Session started at ${timestamp} ===\n\n`,
      { flag: "a" },
    );
  } catch (error) {
    // Silently fail if we can't create log file
    console.error("[debug-logger] Failed to initialize log file:", error);
  }
}

/**
 * Write a debug log entry to file
 */
export function debugLog(component: string, message: string, data?: any) {
  if (!process.env.DEBUG && process.env.NODE_ENV !== "development") {
    return; // Only log in debug mode
  }

  try {
    const timestamp = new Date().toISOString();
    const dataStr = data ? `\n  Data: ${JSON.stringify(data, null, 2)}` : "";
    const logEntry = `[${timestamp}] [${component}] ${message}${dataStr}\n`;

    fs.appendFileSync(LOG_FILE_PATH, logEntry);

    // Also log to console
    console.log(`[${component}] ${message}`, data || "");
  } catch (error) {
    // Silently fail if we can't write to log file
    console.error("[debug-logger] Failed to write log:", error);
  }
}

/**
 * Get the log file path for user reference
 */
export function getLogFilePath(): string {
  return LOG_FILE_PATH;
}

/**
 * Clear the log file
 */
export function clearLogFile() {
  try {
    ensureLogDir();
    fs.writeFileSync(LOG_FILE_PATH, "");
  } catch (error) {
    console.error("[debug-logger] Failed to clear log file:", error);
  }
}

// Initialize on module load
initLogFile();
