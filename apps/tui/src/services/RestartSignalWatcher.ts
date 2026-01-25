/**
 * RestartSignalWatcher
 * Watches for restart signals from Claude Code hooks
 * Uses file-based IPC: .claude/.restart-session
 *
 * When the stop hook detects work remains, it:
 * 1. Syncs Linear statuses
 * 2. Writes a restart signal file
 * 3. Allows Claude to stop
 *
 * The TUI watches for this signal and:
 * 1. Kills the current PTY session
 * 2. Clears state
 * 3. Starts a new fresh session
 * 4. Injects the appropriate skill command
 */

import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { debugLog } from "../utils/debug-logger";

export interface RestartSignal {
  timestamp: string;
  reason: "fresh_context" | "context_limit" | "iteration_complete";
  mode?: "plan" | "build" | "review";
  context?: {
    issueId?: string;
    planFile?: string;
    iteration?: number;
    maxIterations?: number;
  };
}

export class RestartSignalWatcher extends EventEmitter {
  private watcher: fs.FSWatcher | null = null;
  private signalFile: string;
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(workspaceRoot: string) {
    super();
    this.signalFile = path.join(workspaceRoot, ".claude", ".restart-session");
  }

  /**
   * Start watching for restart signals
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const dir = path.dirname(this.signalFile);

    // Ensure .claude directory exists
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (error) {
        debugLog("RestartSignalWatcher", "Failed to create .claude directory", {
          error: String(error),
        });
      }
    }

    // Clean up any stale signal files from previous runs
    this.cleanup();

    // Try to watch the directory for changes
    try {
      this.watcher = fs.watch(dir, (eventType, filename) => {
        if (filename === ".restart-session" && eventType === "rename") {
          // File was created - check and handle signal
          this.handleSignal();
        }
      });

      this.watcher.on("error", (error) => {
        debugLog(
          "RestartSignalWatcher",
          "fs.watch error, falling back to polling",
          { error: String(error) },
        );
        this.watcher?.close();
        this.watcher = null;
      });

      debugLog("RestartSignalWatcher", "Started watching for restart signals", {
        signalFile: this.signalFile,
      });
    } catch (error) {
      debugLog("RestartSignalWatcher", "fs.watch failed, using polling only", {
        error: String(error),
      });
    }

    // Polling fallback (500ms for responsiveness)
    // This ensures we catch the signal even if fs.watch misses it
    this.checkInterval = setInterval(() => {
      if (fs.existsSync(this.signalFile)) {
        this.handleSignal();
      }
    }, 500);
  }

  /**
   * Handle a restart signal file
   */
  private handleSignal(): void {
    if (!fs.existsSync(this.signalFile)) return;

    try {
      const content = fs.readFileSync(this.signalFile, "utf-8");
      const signal = JSON.parse(content) as RestartSignal;

      // Delete the signal file immediately to prevent re-processing
      fs.unlinkSync(this.signalFile);

      debugLog("RestartSignalWatcher", "Restart signal received", {
        reason: signal.reason,
        mode: signal.mode,
        iteration: signal.context?.iteration,
      });

      // Emit the restart event for the TUI to handle
      this.emit("restart", signal);
    } catch (error) {
      debugLog("RestartSignalWatcher", "Failed to read/parse signal file", {
        error: String(error),
      });
      // Clean up the corrupted file
      this.cleanup();
    }
  }

  /**
   * Clean up any existing signal file
   */
  cleanup(): void {
    try {
      if (fs.existsSync(this.signalFile)) {
        fs.unlinkSync(this.signalFile);
        debugLog("RestartSignalWatcher", "Cleaned up stale signal file");
      }
    } catch (error) {
      debugLog("RestartSignalWatcher", "Failed to cleanup signal file", {
        error: String(error),
      });
    }
  }

  /**
   * Stop watching for restart signals
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Clean up signal file on stop
    this.cleanup();

    debugLog("RestartSignalWatcher", "Stopped watching for restart signals");
  }

  /**
   * Check if the watcher is currently running
   */
  isWatching(): boolean {
    return this.isRunning;
  }
}
