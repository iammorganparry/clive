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
      ansiBuffer += data;
      send({ type: 'output', data: ansiBuffer });
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
        break;

      case 'interrupt':
        if (ptyProcess) {
          ptyProcess.write('\x03');
        }
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
