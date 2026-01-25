/**
 * ConversationLogger
 * Writes conversation events to NDJSON log files for debugging
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { debugLog } from '../utils/debug-logger';

export class ConversationLogger {
  private logFile: string | null = null;
  private logStream: fs.WriteStream | null = null;

  /**
   * Start logging to a new file
   */
  start(workspaceRoot: string, mode: 'plan' | 'build' | 'review'): void {
    const workspaceName = path.basename(workspaceRoot);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const logDir = path.join(os.homedir(), '.clive', 'logs', workspaceName);

    // Ensure log directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    this.logFile = path.join(logDir, `conversation-${mode}-${timestamp}.ndjson`);
    this.logStream = fs.createWriteStream(this.logFile, { flags: 'a' });

    debugLog('ConversationLogger', 'Started logging', {
      logFile: this.logFile,
      workspace: workspaceName,
      mode,
    });
  }

  /**
   * Log an event to the NDJSON file
   */
  log(event: any): void {
    if (!this.logStream) return;

    try {
      const line = JSON.stringify(event) + '\n';
      this.logStream.write(line);
    } catch (error) {
      debugLog('ConversationLogger', 'Error writing log', { error: String(error) });
    }
  }

  /**
   * Stop logging and close the file
   */
  stop(): void {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }

    if (this.logFile) {
      debugLog('ConversationLogger', 'Stopped logging', { logFile: this.logFile });
      this.logFile = null;
    }
  }

  /**
   * Get the current log file path
   */
  getLogFile(): string | null {
    return this.logFile;
  }
}
