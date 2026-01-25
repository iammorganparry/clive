/**
 * PTY Handler - Node.js subprocess
 *
 * This script runs in a separate Node.js process to handle PTY spawning
 * (node-pty doesn't work properly with Bun runtime)
 *
 * Communication with parent process via IPC:
 * - Parent sends: { type: 'spawn', options: {...} }
 * - Parent sends: { type: 'input', data: string }
 * - Parent sends: { type: 'resize', cols: number, rows: number }
 * - Parent sends: { type: 'kill' }
 *
 * - Child sends: { type: 'output', data: string }
 * - Child sends: { type: 'exit', exitCode: number, signal: number }
 * - Child sends: { type: 'error', error: string }
 * - Child sends: { type: 'ready' }
 */

const pty = require('node-pty');
const fs = require('fs');
const path = require('path');
const os = require('os');

let ptyProcess = null;
let ansiBuffer = '';
let directMode = false; // When true, write PTY output directly to stdout
let inputReadyEmitted = false; // Track if we've sent the input-ready signal

// Buffer size limit to prevent memory issues with long-running sessions
// Keep approximately the last 500KB of output (enough for scrollback)
const MAX_BUFFER_SIZE = 500 * 1024;

// Patterns that indicate Claude Code is ready for input
// Claude Code shows ">" prompt when ready, or specific UI elements
const INPUT_READY_PATTERNS = [
  /^>/m,                           // Standard prompt
  /\x1b\[\?25h/,                   // Cursor show (often indicates input ready)
  /What would you like to do\?/,   // First-run prompt
  /How can I help/,                // Greeting prompt
];

// Send message to parent process
function send(message) {
  if (process.send) {
    process.send(message);
  }
}

// Find Claude CLI binary
function findClaudeCli() {
  const possiblePaths = [
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const realPath = fs.realpathSync(p);
        return realPath;
      } catch (error) {
        // Continue to next path
      }
    }
  }

  throw new Error('Claude CLI not found. Please ensure it is installed and in your PATH.');
}

// Spawn PTY process
function spawnPty(options) {
  // Reset input ready flag for new session
  inputReadyEmitted = false;

  try {
    const cliPath = findClaudeCli();
    const args = [];

    // Build arguments
    if (options.debug) {
      args.push('--debug');
    }

    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt);
    }

    if (options.model) {
      args.push('--model', options.model);
    }

    args.push('--add-dir', options.workspaceRoot);

    if (options.addDirs) {
      options.addDirs.forEach(dir => {
        args.push('--add-dir', dir);
      });
    }

    if (options.mode === 'plan') {
      args.push('--permission-mode', 'plan');
    } else {
      args.push('--permission-mode', 'acceptEdits');
    }

    if (options.mcpConfig) {
      args.push('--mcp-config', JSON.stringify(options.mcpConfig));
    }

    if (options.betas && options.betas.length > 0) {
      args.push('--betas', ...options.betas);
    }

    // Add prompt as positional argument
    if (options.prompt) {
      args.push(options.prompt);
    }

    send({ type: 'log', message: 'Spawning PTY', data: { cliPath, args, cols: options.cols, rows: options.rows } });

    ptyProcess = pty.spawn(cliPath, args, {
      name: 'xterm-256color',
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.workspaceRoot,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
        COLORTERM: 'truecolor',
      },
      handleFlowControl: true,
    });

    send({ type: 'log', message: 'PTY spawned', data: { pid: ptyProcess.pid } });

    // Listen for data
    ptyProcess.onData((data) => {
      if (directMode) {
        // Write directly to stdout - PTY has full terminal control
        process.stdout.write(data);
      } else {
        // Normal mode: accumulate and send via IPC
        ansiBuffer += data;

        // Trim buffer if it exceeds max size to prevent memory issues
        // Trim from the beginning (oldest content) to keep recent output
        if (ansiBuffer.length > MAX_BUFFER_SIZE) {
          // Find a good break point (newline) near the trim point
          const trimPoint = ansiBuffer.length - MAX_BUFFER_SIZE;
          const newlineIndex = ansiBuffer.indexOf('\n', trimPoint);
          if (newlineIndex !== -1 && newlineIndex < trimPoint + 1000) {
            ansiBuffer = ansiBuffer.slice(newlineIndex + 1);
          } else {
            ansiBuffer = ansiBuffer.slice(trimPoint);
          }
        }

        send({ type: 'output', data: ansiBuffer });

        // Check if Claude Code is ready for input (only emit once per session)
        if (!inputReadyEmitted) {
          const isReady = INPUT_READY_PATTERNS.some(pattern => pattern.test(ansiBuffer));
          if (isReady) {
            inputReadyEmitted = true;
            send({ type: 'input-ready' });
            send({ type: 'log', message: 'Claude Code input ready detected' });
          }
        }
      }
    });

    // Listen for exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      send({ type: 'log', message: 'PTY exited', data: { exitCode, signal, bufferSize: ansiBuffer.length } });
      send({ type: 'exit', exitCode, signal });
      ptyProcess = null;
    });

    send({ type: 'ready', pid: ptyProcess.pid });
  } catch (error) {
    send({ type: 'error', error: String(error), stack: error.stack });
  }
}

// Handle messages from parent process
process.on('message', (message) => {
  try {
    switch (message.type) {
      case 'spawn':
        spawnPty(message.options);
        break;

      case 'input':
        if (ptyProcess) {
          ptyProcess.write(message.data + '\r');
        }
        break;

      case 'raw-input':
        // Raw input - send exactly as-is without adding '\r'
        if (ptyProcess) {
          ptyProcess.write(message.data);
        }
        break;

      case 'resize':
        if (ptyProcess) {
          ptyProcess.resize(message.cols, message.rows);
        }
        break;

      case 'kill':
        if (ptyProcess) {
          ptyProcess.kill();
          ptyProcess = null;
        }
        // Clear buffer to free memory
        ansiBuffer = '';
        break;

      case 'clear-buffer':
        // Allow parent to clear buffer manually to free memory
        ansiBuffer = '';
        send({ type: 'log', message: 'Buffer cleared', data: { freedSize: ansiBuffer.length } });
        break;

      case 'interrupt':
        if (ptyProcess) {
          ptyProcess.write('\x03');
        }
        break;

      case 'set-direct-mode':
        directMode = message.enabled;
        if (directMode) {
          // Clear buffer when entering direct mode - PTY will render directly
          ansiBuffer = '';
        }
        send({ type: 'log', message: 'Direct mode set', data: { directMode } });
        break;

      case 'set-scroll-region':
        // Set terminal scroll region for embedded direct mode
        // This confines Claude Code's scrolling to a specific area
        if (message.top && message.bottom) {
          const setRegion = `\x1b[${message.top};${message.bottom}r`;
          process.stdout.write(setRegion);
          // Move cursor to top of scroll region
          process.stdout.write(`\x1b[${message.top};1H`);
          send({ type: 'log', message: 'Scroll region set', data: { top: message.top, bottom: message.bottom } });
        }
        break;

      case 'reset-scroll-region':
        // Reset scroll region to full terminal
        process.stdout.write('\x1b[r');
        send({ type: 'log', message: 'Scroll region reset' });
        break;

      default:
        send({ type: 'error', error: `Unknown message type: ${message.type}` });
    }
  } catch (error) {
    send({ type: 'error', error: String(error), stack: error.stack });
  }
});

// Handle process exit
process.on('exit', () => {
  if (ptyProcess) {
    ptyProcess.kill();
  }
});

process.on('SIGTERM', () => {
  if (ptyProcess) {
    ptyProcess.kill();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  if (ptyProcess) {
    ptyProcess.kill();
  }
  process.exit(0);
});

// Signal ready
send({ type: 'handler-ready' });
