/**
 * PtyCliManager
 * PTY-based Claude CLI manager for interactive terminal rendering
 *
 * Responsibilities:
 * - Spawns Node.js subprocess to handle PTY (node-pty doesn't work with Bun)
 * - Accumulates ANSI output for ghostty-terminal rendering
 * - Provides input handling for user interaction
 * - Maintains session state
 */

import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { debugLog } from '../utils/debug-logger';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface PtyCliManagerOptions {
  workspaceRoot: string;
  systemPrompt?: string;
  model?: string; // 'sonnet', 'opus', 'haiku', or full model name
  mode?: 'plan' | 'build';
  mcpConfig?: any; // MCP server configuration
  addDirs?: string[]; // Additional directories to allow access
  betas?: string[]; // Beta features to enable
}

export interface PtyDimensions {
  cols: number;
  rows: number;
  maxWidth: number;
  maxHeight: number;
}

export class PtyCliManager extends EventEmitter {
  private nodeProcess: ChildProcess | null = null;
  private ansiBuffer = '';
  private activeMode: 'plan' | 'build' | null = null;
  private ptyDimensions: PtyDimensions | null = null;

  /**
   * Execute Claude CLI in interactive mode with PTY via Node.js subprocess
   */
  async execute(prompt: string, options: PtyCliManagerOptions): Promise<void> {
    debugLog('PtyCliManager', 'Starting PTY execution via Node.js subprocess', {
      promptLength: prompt.length,
      model: options.model,
      mode: options.mode,
    });

    // Spawn Node.js subprocess to handle PTY
    const handlerPath = path.join(__dirname, 'pty-handler.cjs');

    debugLog('PtyCliManager', 'Spawning Node.js subprocess', {
      handlerPath,
      nodeVersion: process.version,
    });

    this.nodeProcess = spawn('node', [handlerPath], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      cwd: options.workspaceRoot,
    });

    this.activeMode = options.mode || null;

    // Listen for messages from Node.js subprocess
    this.nodeProcess.on('message', (message: any) => {
      this.handleMessage(message);
    });

    // Listen for subprocess exit
    this.nodeProcess.on('exit', (code, signal) => {
      debugLog('PtyCliManager', 'Node.js subprocess exited', { code, signal });
      this.nodeProcess = null;
    });

    // Listen for subprocess errors
    this.nodeProcess.on('error', (error) => {
      debugLog('PtyCliManager', 'Node.js subprocess error', {
        error: String(error),
        stack: error.stack,
      });
      this.emit('error', error);
    });

    // Wait for handler to be ready
    await new Promise<void>((resolve) => {
      const handler = (message: any) => {
        if (message.type === 'handler-ready') {
          this.nodeProcess?.off('message', handler);
          resolve();
        }
      };
      this.nodeProcess?.on('message', handler);
    });

    debugLog('PtyCliManager', 'Node.js subprocess ready, spawning PTY');

    // Calculate terminal dimensions - use all available space
    const termWidth = process.stdout.columns || 80;
    const termHeight = process.stdout.rows || 24;

    // Calculate available space by subtracting TUI chrome
    const dimensions = this.calculateDimensions(termWidth, termHeight, options.mode);

    // Store dimensions for OutputPanel
    this.ptyDimensions = dimensions;

    debugLog('PtyCliManager', 'Calculated initial PTY dimensions', {
      termWidth,
      termHeight,
      ptyWidth: dimensions.cols,
      ptyHeight: dimensions.rows,
    });

    // Emit dimensions for OutputPanel to use for centering
    this.emit('dimensions', this.ptyDimensions);

    // Send spawn message to subprocess
    this.nodeProcess.send({
      type: 'spawn',
      options: {
        prompt,
        workspaceRoot: options.workspaceRoot,
        systemPrompt: options.systemPrompt,
        model: options.model,
        mode: options.mode,
        mcpConfig: options.mcpConfig,
        addDirs: options.addDirs,
        betas: options.betas,
        debug: true, // Enable debug for conversation file watching
        cols: dimensions.cols,
        rows: dimensions.rows,
      },
    });
  }

  /**
   * Calculate PTY dimensions based on terminal size and TUI chrome
   */
  private calculateDimensions(termWidth: number, termHeight: number, mode?: 'plan' | 'build'): PtyDimensions {
    // TUI chrome constants
    const INPUT_HEIGHT = 3;
    const STATUS_HEIGHT = 1;
    const BORDER_HEIGHT = 2;
    const modeHeaderHeight = mode ? 1 : 0;
    const chromeHeight = INPUT_HEIGHT + STATUS_HEIGHT + BORDER_HEIGHT + modeHeaderHeight;

    const SIDEBAR_WIDTH = 30;

    // Calculate available space
    const availableHeight = termHeight - chromeHeight;
    const availableWidth = termWidth - SIDEBAR_WIDTH;

    // Use all available space - let Claude handle its own layout
    // Claude Code is designed to be responsive and will adapt to any size
    const ptyWidth = Math.max(40, availableWidth); // Minimum 40 cols to prevent breaking
    const ptyHeight = Math.max(10, availableHeight); // Minimum 10 rows to prevent breaking

    return {
      cols: ptyWidth,
      rows: ptyHeight,
      maxWidth: availableWidth,
      maxHeight: availableHeight,
    };
  }

  /**
   * Handle messages from Node.js subprocess
   */
  private handleMessage(message: any): void {
    switch (message.type) {
      case 'output':
        this.ansiBuffer = message.data;
        debugLog('PtyCliManager', 'Received output from subprocess', {
          bufferSize: this.ansiBuffer.length,
        });
        this.emit('output', { ansi: this.ansiBuffer });
        break;

      case 'exit':
        debugLog('PtyCliManager', 'PTY exited', {
          exitCode: message.exitCode,
          signal: message.signal,
        });
        this.emit('complete', { exitCode: message.exitCode });
        this.activeMode = null;
        break;

      case 'error':
        debugLog('PtyCliManager', 'PTY error', {
          error: message.error,
          stack: message.stack,
        });
        this.emit('error', new Error(message.error));
        break;

      case 'ready':
        debugLog('PtyCliManager', 'PTY ready', {
          pid: message.pid,
        });
        break;

      case 'log':
        debugLog('PtyCliManager:subprocess', message.message, message.data || {});
        break;

      default:
        debugLog('PtyCliManager', 'Unknown message type from subprocess', {
          type: message.type,
          message,
        });
    }
  }

  /**
   * Send input to the PTY stdin via subprocess (adds '\r' automatically)
   */
  sendInput(input: string): void {
    if (!this.nodeProcess) {
      debugLog('PtyCliManager', 'ERROR: No active Node.js subprocess');
      console.error('[PtyCliManager] No active Node.js subprocess');
      return;
    }

    debugLog('PtyCliManager', 'Sending input to PTY via subprocess', {
      inputLength: input.length,
      inputPreview: input.substring(0, 100),
    });

    this.nodeProcess.send({
      type: 'input',
      data: input,
    });
  }

  /**
   * Send raw input to PTY (no automatic '\r' added)
   */
  sendRawInput(input: string): void {
    if (!this.nodeProcess) {
      debugLog('PtyCliManager', 'ERROR: No active Node.js subprocess');
      console.error('[PtyCliManager] No active Node.js subprocess');
      return;
    }

    debugLog('PtyCliManager', 'Sending raw input to PTY via subprocess', {
      inputLength: input.length,
      hex: input.split('').map(c => c.charCodeAt(0).toString(16)).join(' '),
    });

    this.nodeProcess.send({
      type: 'raw-input',
      data: input,
    });
  }

  /**
   * Send tool result (for question answering)
   * In PTY mode, this is just regular input
   */
  sendToolResult(toolId: string, result: string): void {
    debugLog('PtyCliManager', 'sendToolResult called', {
      toolId,
      resultLength: result.length,
    });

    // In PTY mode, tool results are just text input
    // For AskUserQuestion, we just send the answer as-is
    this.sendInput(result);
  }

  /**
   * Send a message to the active agent session
   */
  sendMessageToAgent(message: string): void {
    if (!this.hasActiveSession()) {
      throw new Error('No active agent session');
    }

    debugLog('PtyCliManager', 'sendMessageToAgent', { message });
    this.sendInput(message);
  }

  /**
   * Check if there's an active agent session
   */
  hasActiveSession(): boolean {
    return !!(this.nodeProcess && this.activeMode);
  }

  /**
   * Get the current active mode
   */
  getActiveMode(): 'plan' | 'build' | null {
    return this.hasActiveSession() ? this.activeMode : null;
  }

  /**
   * Resize the PTY terminal via subprocess
   * Recalculates dimensions based on new terminal size
   */
  resize(termWidth: number, termHeight: number): void {
    if (!this.nodeProcess) return;

    // Recalculate PTY dimensions based on new terminal size
    const newDimensions = this.calculateDimensions(termWidth, termHeight, this.activeMode || undefined);

    // Check if dimensions actually changed
    if (this.ptyDimensions &&
        this.ptyDimensions.cols === newDimensions.cols &&
        this.ptyDimensions.rows === newDimensions.rows) {
      // No change, skip resize
      return;
    }

    debugLog('PtyCliManager', 'Resizing PTY via subprocess', {
      termWidth,
      termHeight,
      oldCols: this.ptyDimensions?.cols,
      oldRows: this.ptyDimensions?.rows,
      newCols: newDimensions.cols,
      newRows: newDimensions.rows,
    });

    // Update stored dimensions
    this.ptyDimensions = newDimensions;

    // Send resize message to subprocess
    this.nodeProcess.send({
      type: 'resize',
      cols: newDimensions.cols,
      rows: newDimensions.rows,
    });

    // Emit new dimensions for OutputPanel to update
    this.emit('dimensions', this.ptyDimensions);
  }

  /**
   * Kill the Node.js subprocess and PTY process
   */
  kill(): void {
    if (!this.nodeProcess) return;

    debugLog('PtyCliManager', 'Killing Node.js subprocess');

    const proc = this.nodeProcess;
    this.nodeProcess = null;
    this.activeMode = null;
    this.ptyDimensions = null;

    // Immediately send SIGKILL (no graceful shutdown, just kill it)
    try {
      if (!proc.killed) {
        debugLog('PtyCliManager', 'Sending SIGKILL to subprocess');
        proc.kill('SIGKILL');
      }
    } catch (error) {
      debugLog('PtyCliManager', 'Error sending SIGKILL', { error: String(error) });
    }

    // Don't wait for subprocess to die - just emit killed event
    this.emit('killed');
  }

  /**
   * Interrupt the PTY process (Ctrl+C) via subprocess
   */
  interrupt(): void {
    if (this.nodeProcess) {
      debugLog('PtyCliManager', 'Interrupting PTY process via subprocess');
      this.nodeProcess.send({ type: 'interrupt' });
    }
  }

  /**
   * Clear the ANSI buffer
   */
  clear(): void {
    this.ansiBuffer = '';
    this.emit('output', { ansi: this.ansiBuffer });
  }

  /**
   * Get the current ANSI buffer
   */
  getBuffer(): string {
    return this.ansiBuffer;
  }

  /**
   * Get the PTY dimensions (for centering in OutputPanel)
   */
  getDimensions(): PtyDimensions | null {
    return this.ptyDimensions;
  }
}
