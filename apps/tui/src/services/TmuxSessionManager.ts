/**
 * TmuxSessionManager
 *
 * Manages tmux sessions and windows for multi-session Claude CLI.
 * Each chat/worker session runs as an interactive Claude CLI in its own tmux window.
 * Users navigate with native tmux keybindings (Ctrl-b n/p, Ctrl-b 1-9).
 */

import { execSync, type ExecSyncOptions } from "node:child_process";
import { EventEmitter } from "node:events";

export interface TmuxWindow {
  /** Our session/chat ID */
  id: string;
  /** tmux window index */
  tmuxIndex: number;
  /** Window name shown in tmux status bar */
  name: string;
  /** PID of the pane's process (claude CLI) */
  panePid: number | null;
}

export interface CreateWindowOptions {
  /** Session/chat ID */
  id: string;
  /** Window title (e.g., "plan-abc123") */
  name: string;
  /** Working directory for the window */
  cwd: string;
  /** Full command to run (e.g., the claude CLI command) */
  command: string;
}

export interface TmuxSessionManagerEvents {
  /** Emitted when a window's process exits (session complete) */
  windowExited: (id: string) => void;
}

const EXEC_OPTS: ExecSyncOptions = { encoding: "utf-8", stdio: "pipe" };

export class TmuxSessionManager extends EventEmitter {
  private sessionName: string;
  private windows = new Map<string, TmuxWindow>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(sessionName = "clive") {
    super();
    this.sessionName = sessionName;
  }

  // ── Lifecycle ──

  /**
   * Ensure the tmux session exists.
   * If we're already inside tmux, renames the current session.
   * Otherwise creates a new detached session.
   */
  ensureSession(): void {
    if (this.isInsideTmux()) {
      // We're already in a tmux session — rename it to our session name
      const currentSession = this.getCurrentTmuxSession();
      if (currentSession && currentSession !== this.sessionName) {
        try {
          execSync(
            `tmux rename-session -t "${currentSession}" "${this.sessionName}"`,
            EXEC_OPTS,
          );
        } catch {
          // Session name might already exist; that's fine
        }
      }
    } else {
      // Check if session already exists
      try {
        execSync(`tmux has-session -t "${this.sessionName}" 2>/dev/null`, EXEC_OPTS);
        // Session exists, we'll attach to it later
      } catch {
        // Session doesn't exist, create it
        execSync(
          `tmux new-session -d -s "${this.sessionName}"`,
          EXEC_OPTS,
        );
      }
    }

    // Name the initial window "orchestrator"
    try {
      execSync(
        `tmux rename-window -t "${this.sessionName}:0" "orchestrator"`,
        EXEC_OPTS,
      );
    } catch {
      // Ignore if window 0 doesn't exist
    }

    // Configure remain-on-exit so we can detect when processes finish
    try {
      execSync(
        `tmux set-option -t "${this.sessionName}" remain-on-exit on`,
        EXEC_OPTS,
      );
    } catch {
      // Ignore
    }

    // Start polling for window exits
    this.startPolling();
  }

  /**
   * Kill the entire tmux session and clean up.
   */
  destroy(): void {
    this.stopPolling();

    try {
      execSync(`tmux kill-session -t "${this.sessionName}"`, EXEC_OPTS);
    } catch {
      // Session may already be gone
    }

    this.windows.clear();
  }

  // ── Window Management ──

  /**
   * Create a new tmux window running the given command.
   */
  createWindow(opts: CreateWindowOptions): TmuxWindow {
    const { id, name, cwd, command } = opts;

    // Create the window with the command
    const escapedCmd = command.replace(/"/g, '\\"');
    const escapedName = name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 30);

    try {
      execSync(
        `tmux new-window -t "${this.sessionName}" -n "${escapedName}" -c "${cwd}" "${escapedCmd}"`,
        EXEC_OPTS,
      );
    } catch (error) {
      throw new Error(`Failed to create tmux window: ${error}`);
    }

    // Get the index and PID of the new window
    const windowInfo = this.getLatestWindowInfo();
    const tmuxIndex = windowInfo?.index ?? -1;
    const panePid = windowInfo?.panePid ?? null;

    const window: TmuxWindow = {
      id,
      tmuxIndex,
      name: escapedName,
      panePid,
    };

    this.windows.set(id, window);
    return window;
  }

  /**
   * Close a specific window by our session ID.
   */
  closeWindow(id: string): void {
    const window = this.windows.get(id);
    if (!window) return;

    try {
      execSync(
        `tmux kill-window -t "${this.sessionName}:${window.tmuxIndex}"`,
        EXEC_OPTS,
      );
    } catch {
      // Window may already be closed
    }

    this.windows.delete(id);
  }

  /**
   * Focus (select) a specific window.
   */
  focusWindow(id: string): void {
    const window = this.windows.get(id);
    if (!window) return;

    try {
      execSync(
        `tmux select-window -t "${this.sessionName}:${window.tmuxIndex}"`,
        EXEC_OPTS,
      );
    } catch {
      // Ignore
    }
  }

  /**
   * Rename a window.
   */
  renameWindow(id: string, newName: string): void {
    const window = this.windows.get(id);
    if (!window) return;

    const escapedName = newName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 30);
    try {
      execSync(
        `tmux rename-window -t "${this.sessionName}:${window.tmuxIndex}" "${escapedName}"`,
        EXEC_OPTS,
      );
      window.name = escapedName;
    } catch {
      // Ignore
    }
  }

  /**
   * List all tracked windows with current status.
   */
  listWindows(): TmuxWindow[] {
    return Array.from(this.windows.values());
  }

  /**
   * Get a window by our session ID.
   */
  getWindow(id: string): TmuxWindow | undefined {
    return this.windows.get(id);
  }

  // ── Status ──

  /**
   * Check if we're running inside an existing tmux session.
   */
  isInsideTmux(): boolean {
    return !!process.env.TMUX;
  }

  /**
   * Get the name of the current tmux session (if inside one).
   */
  private getCurrentTmuxSession(): string | null {
    try {
      return (
        execSync('tmux display-message -p "#{session_name}"', EXEC_OPTS) as string
      ).trim();
    } catch {
      return null;
    }
  }

  /**
   * Get the currently active window index.
   */
  getActiveWindowIndex(): number | null {
    try {
      const result = (
        execSync(
          `tmux display-message -t "${this.sessionName}" -p "#{window_index}"`,
          EXEC_OPTS,
        ) as string
      ).trim();
      return parseInt(result, 10);
    } catch {
      return null;
    }
  }

  /**
   * Get the info of the most recently created window.
   */
  private getLatestWindowInfo(): { index: number; panePid: number | null } | null {
    try {
      const output = (
        execSync(
          `tmux list-windows -t "${this.sessionName}" -F "#{window_index} #{pane_pid}"`,
          EXEC_OPTS,
        ) as string
      ).trim();

      const lines = output.split("\n").filter(Boolean);
      if (lines.length === 0) return null;

      // The last line is the most recently created window
      const lastLine = lines[lines.length - 1]!;
      const [indexStr, pidStr] = lastLine.split(" ");
      return {
        index: parseInt(indexStr!, 10),
        panePid: pidStr ? parseInt(pidStr, 10) : null,
      };
    } catch {
      return null;
    }
  }

  // ── Completion Detection ──

  /**
   * Start polling tmux for window process exits.
   * Checks every 5 seconds if any tracked window's pane process has exited.
   */
  private startPolling(): void {
    if (this.pollTimer) return;

    this.pollTimer = setInterval(() => {
      this.checkForExitedWindows();
    }, 5000);
  }

  /** Stop polling for window exits without killing the session */
  stop(): void {
    this.stopPolling();
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Check for windows whose processes have exited.
   * Uses `tmux list-panes` to check pane_dead status.
   */
  private checkForExitedWindows(): void {
    if (this.windows.size === 0) return;

    try {
      // Get all windows with their dead status
      const output = (
        execSync(
          `tmux list-windows -t "${this.sessionName}" -F "#{window_index} #{window_name} #{pane_dead} #{pane_pid}"`,
          EXEC_OPTS,
        ) as string
      ).trim();

      const tmuxWindows = new Map<number, { dead: boolean; pid: number }>();
      for (const line of output.split("\n").filter(Boolean)) {
        const parts = line.split(" ");
        const index = parseInt(parts[0]!, 10);
        const dead = parts[2] === "1";
        const pid = parseInt(parts[3]!, 10);
        tmuxWindows.set(index, { dead, pid });
      }

      // Check each tracked window
      for (const [id, window] of this.windows) {
        const tmuxInfo = tmuxWindows.get(window.tmuxIndex);

        if (!tmuxInfo || tmuxInfo.dead) {
          // Process has exited — emit event and clean up the dead window
          this.emit("windowExited", id);

          // Kill the dead window to clean up
          try {
            execSync(
              `tmux kill-window -t "${this.sessionName}:${window.tmuxIndex}"`,
              EXEC_OPTS,
            );
          } catch {
            // Already gone
          }

          this.windows.delete(id);
        }
      }
    } catch {
      // tmux session may have been killed externally — stop polling
      if (this.windows.size > 0) {
        this.windows.clear();
      }
    }
  }
}
