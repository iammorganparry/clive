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
  mode?: 'plan' | 'build' | 'review';
  mcpConfig?: any; // MCP server configuration
  addDirs?: string[]; // Additional directories to allow access
  betas?: string[]; // Beta features to enable
  cols?: number; // Explicit terminal columns (for direct mode)
  rows?: number; // Explicit terminal rows (for direct mode)
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
  private activeMode: 'plan' | 'build' | 'review' | null = null;
  private ptyDimensions: PtyDimensions | null = null;
  private directMode = false;

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

    // Calculate terminal dimensions
    const termWidth = process.stdout.columns || 80;
    const termHeight = process.stdout.rows || 24;

    // Use explicit dimensions if provided (direct mode), otherwise calculate
    let dimensions: PtyDimensions;
    if (this.directMode && options.cols && options.rows) {
      // Direct mode: use full terminal
      dimensions = {
        cols: options.cols,
        rows: options.rows,
        maxWidth: options.cols,
        maxHeight: options.rows,
      };
    } else {
      // Normal mode: Calculate available space by subtracting TUI chrome
      dimensions = this.calculateDimensions(termWidth, termHeight, options.mode);
    }

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

    // If direct mode is enabled, send the setting first
    if (this.directMode) {
      this.nodeProcess.send({ type: 'set-direct-mode', enabled: true });
    }

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
        debug: false, // Debug mode disabled - not needed for normal operation
        cols: dimensions.cols,
        rows: dimensions.rows,
      },
    });
  }

  /**
   * Calculate PTY dimensions based on terminal size and TUI chrome
   */
  private calculateDimensions(termWidth: number, termHeight: number, mode?: 'plan' | 'build' | 'review'): PtyDimensions {
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

      case 'input-ready':
        debugLog('PtyCliManager', 'Claude Code input ready');
        this.emit('input-ready');
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
    // In direct mode, use full terminal; otherwise calculate with TUI chrome
    const newDimensions = this.directMode
      ? { cols: termWidth, rows: termHeight, maxWidth: termWidth, maxHeight: termHeight }
      : this.calculateDimensions(termWidth, termHeight, this.activeMode || undefined);

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

  /**
   * Enable or disable direct mode
   * In direct mode, PTY output goes directly to stdout and stdin is passed through
   */
  setDirectMode(enabled: boolean): void {
    this.directMode = enabled;
    if (this.nodeProcess) {
      this.nodeProcess.send({ type: 'set-direct-mode', enabled });
    }
  }

  /**
   * Check if direct mode is enabled
   */
  isDirectMode(): boolean {
    return this.directMode;
  }

  /**
   * Set terminal scroll region for embedded direct mode
   * This confines Claude Code's scrolling to a specific row range
   */
  setScrollRegion(top: number, bottom: number): void {
    if (this.nodeProcess) {
      this.nodeProcess.send({ type: 'set-scroll-region', top, bottom });
    }
  }

  /**
   * Reset scroll region to full terminal
   */
  resetScrollRegion(): void {
    if (this.nodeProcess) {
      this.nodeProcess.send({ type: 'reset-scroll-region' });
    }
  }

  /**
   * Enable embedded direct mode with scroll region
   * This lets Claude Code render directly while confining it to a specific area
   */
  enableEmbeddedDirectMode(region: { top: number; bottom: number; cols: number; rows: number }): void {
    this.directMode = true;

    if (this.nodeProcess) {
      // Enable direct mode first
      this.nodeProcess.send({ type: 'set-direct-mode', enabled: true });

      // Set the scroll region
      this.nodeProcess.send({
        type: 'set-scroll-region',
        top: region.top,
        bottom: region.bottom,
      });

      // Resize PTY to match the region dimensions
      this.nodeProcess.send({
        type: 'resize',
        cols: region.cols,
        rows: region.rows,
      });
    }

    debugLog('PtyCliManager', 'Enabled embedded direct mode', region);
  }

  /**
   * Disable embedded direct mode and restore normal buffered mode
   */
  disableEmbeddedDirectMode(): void {
    this.directMode = false;

    if (this.nodeProcess) {
      // Reset scroll region
      this.nodeProcess.send({ type: 'reset-scroll-region' });

      // Disable direct mode
      this.nodeProcess.send({ type: 'set-direct-mode', enabled: false });
    }

    debugLog('PtyCliManager', 'Disabled embedded direct mode');
  }
}
