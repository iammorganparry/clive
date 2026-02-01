/**
 * ConversationWatcher
 * Watches Claude CLI debug conversation files for structured events
 *
 * Responsibilities:
 * - Monitors ~/.claude/sessions directory for conversation files
 * - Parses JSONL format conversation events
 * - Emits structured events for event hooks (e.g., Linear task refetching)
 * - Handles file rotation and cleanup
 */

import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { debugLog } from "../utils/debug-logger";

export interface ClaudeEvent {
  type: string;
  id?: string;
  name?: string;
  input?: any;
  content?: any;
  [key: string]: any;
}

export class ConversationWatcher extends EventEmitter {
  private watcher: fs.FSWatcher | null = null;
  private fileWatcher: fs.FSWatcher | null = null;
  private lastPosition = 0;
  private sessionFile: string | null = null;
  private checkInterval: NodeJS.Timeout | null = null;

  /**
   * Start watching for conversation files
   * If sessionId is provided, watch that specific session
   * Otherwise, watch for the most recently created session file
   */
  start(sessionId?: string): void {
    const sessionsDir = path.join(os.homedir(), ".claude", "sessions");

    // Ensure sessions directory exists
    if (!fs.existsSync(sessionsDir)) {
      debugLog("ConversationWatcher", "Sessions directory does not exist", {
        sessionsDir,
      });
      return;
    }

    if (sessionId) {
      // Watch specific session file
      this.sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
      if (fs.existsSync(this.sessionFile)) {
        this.watchSessionFile();
      } else {
        debugLog("ConversationWatcher", "Session file not found", {
          sessionFile: this.sessionFile,
        });
      }
    } else {
      // Watch for newest file in sessions directory
      debugLog("ConversationWatcher", "Watching for newest session file", {
        sessionsDir,
      });

      // Start polling for new files (since fs.watch can be unreliable for new files)
      this.checkInterval = setInterval(() => {
        const newestFile = this.findNewestSessionFile(sessionsDir);
        if (newestFile && newestFile !== this.sessionFile) {
          debugLog("ConversationWatcher", "Found new session file", {
            file: newestFile,
          });
          this.sessionFile = newestFile;
          this.lastPosition = 0; // Reset position for new file
          this.watchSessionFile();
        }
      }, 1000);

      // Also check immediately
      const newestFile = this.findNewestSessionFile(sessionsDir);
      if (newestFile) {
        debugLog("ConversationWatcher", "Initial session file", {
          file: newestFile,
        });
        this.sessionFile = newestFile;
        this.watchSessionFile();
      }
    }
  }

  /**
   * Find the most recently modified session file
   */
  private findNewestSessionFile(sessionsDir: string): string | null {
    try {
      const files = fs
        .readdirSync(sessionsDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => ({
          path: path.join(sessionsDir, f),
          mtime: fs.statSync(path.join(sessionsDir, f)).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      return files.length > 0 ? files[0]!.path : null;
    } catch (error) {
      debugLog("ConversationWatcher", "Error finding newest file", {
        error: String(error),
      });
      return null;
    }
  }

  /**
   * Watch a specific session file for changes
   */
  private watchSessionFile(): void {
    if (!this.sessionFile) return;

    // Close existing watcher
    if (this.fileWatcher) {
      this.fileWatcher.close();
    }

    debugLog("ConversationWatcher", "Starting file watch", {
      file: this.sessionFile,
    });

    // Watch for file changes
    try {
      this.fileWatcher = fs.watch(this.sessionFile, (eventType) => {
        if (eventType === "change") {
          this.readNewEvents();
        }
      });

      // Read any existing events
      this.readNewEvents();
    } catch (error) {
      debugLog("ConversationWatcher", "Error watching file", {
        error: String(error),
      });
    }
  }

  /**
   * Read new events from the session file since last position
   */
  private readNewEvents(): void {
    if (!this.sessionFile) return;

    try {
      const content = fs.readFileSync(this.sessionFile, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      // Read only new lines since last position
      const newLines = lines.slice(this.lastPosition);
      this.lastPosition = lines.length;

      debugLog("ConversationWatcher", "Reading new events", {
        newLines: newLines.length,
        totalLines: lines.length,
      });

      for (const line of newLines) {
        try {
          const event = JSON.parse(line) as ClaudeEvent;
          debugLog("ConversationWatcher", "Parsed event", {
            type: event.type,
            name: event.name,
          });

          this.emit("event", event);

          // Emit specific event types
          if (event.type === "tool_use") {
            this.emit("tool_use", event);

            // Special handling for Task tool (subagent spawning)
            if (event.name === "Task") {
              debugLog("ConversationWatcher", "Task spawn detected", {
                subagentType: event.input?.subagent_type,
              });
              this.emit("task_spawn", event);
            }

            // Special handling for Linear project creation
            if (event.name === "mcp__linear__create_project") {
              debugLog(
                "ConversationWatcher",
                "Linear project creation detected",
                {
                  toolId: event.id,
                },
              );
              this.emit("linear_project_create", event);
            }

            // Special handling for Linear issue creation
            if (event.name === "mcp__linear__create_issue") {
              debugLog(
                "ConversationWatcher",
                "Linear issue creation detected",
                {
                  toolId: event.id,
                },
              );
              this.emit("linear_issue_create", event);
            }

            // Special handling for Linear issue updates
            if (event.name === "mcp__linear__update_issue") {
              debugLog("ConversationWatcher", "Linear issue update detected", {
                toolId: event.id,
              });
              this.emit("linear_issue_update", event);
            }
          } else if (event.type === "tool_result") {
            this.emit("tool_result", event);

            // Capture Linear tool results to extract IDs
            if (
              event.name === "mcp__linear__create_project" ||
              event.name === "mcp__linear__create_issue" ||
              event.name === "mcp__linear__update_issue"
            ) {
              debugLog("ConversationWatcher", "Linear tool result", {
                toolName: event.name,
                toolId: event.id,
              });
              this.emit("linear_tool_result", event);
            }
          } else if (event.type === "text") {
            this.emit("text", event);
          } else if (event.type === "thinking") {
            this.emit("thinking", event);
          }
        } catch (err) {
          debugLog("ConversationWatcher", "Failed to parse line", {
            error: String(err),
            line: line.substring(0, 100),
          });
        }
      }
    } catch (error) {
      debugLog("ConversationWatcher", "Error reading file", {
        error: String(error),
      });
    }
  }

  /**
   * Get the current session ID being watched
   */
  getCurrentSessionId(): string | null {
    if (!this.sessionFile) return null;

    // Extract session ID from file path: /path/to/<session-id>.jsonl
    const fileName = path.basename(this.sessionFile, ".jsonl");
    return fileName;
  }

  /**
   * Stop watching and cleanup
   */
  stop(): void {
    debugLog("ConversationWatcher", "Stopping watcher");

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.sessionFile = null;
    this.lastPosition = 0;
  }
}
