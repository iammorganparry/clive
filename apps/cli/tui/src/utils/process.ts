import { spawn, ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Try to load node-pty, fall back to null if unavailable
let pty: typeof import('node-pty') | null = null;
try {
  pty = await import('node-pty');
} catch {
  // PTY not available, will use fallback
}

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Find the clive CLI scripts directory
function findScriptsDir(): string {
  // Look for the scripts relative to this file
  const possiblePaths = [
    path.join(__dirname, '..', '..', '..', 'scripts'),
    path.join(process.cwd(), 'apps', 'cli', 'scripts'),
    '/usr/local/share/clive/scripts',
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }

  // Fall back to current directory
  return process.cwd();
}

export interface ProcessHandle {
  kill: () => void;
  write?: (data: string) => void;
  onExit: (callback: (code: number) => void) => void;
}

// Strip ANSI escape sequences that would interfere with our TUI
function stripAnsiCursor(str: string): string {
  // Remove cursor movement, screen clearing, and other problematic sequences
  // Keep colors and basic formatting
  return str
    .replace(/\x1b\[\?25[hl]/g, '') // Hide/show cursor
    .replace(/\x1b\[\d*[ABCDEFGJKST]/g, '') // Cursor movement
    .replace(/\x1b\[\d*;\d*[Hf]/g, '') // Cursor positioning
    .replace(/\x1b\[2J/g, '') // Clear screen
    .replace(/\x1b\[H/g, ''); // Home cursor
}

// Fallback spawn using regular child_process (no PTY)
function spawnWithFallback(
  script: string,
  args: string[],
  onOutput: (data: string, type: 'stdout' | 'stderr') => void
): ProcessHandle {
  // Use 'script' command to create a PTY on macOS/Linux
  const isWin = process.platform === 'win32';

  let child: ChildProcess;

  if (!isWin) {
    // Use 'script' command for PTY emulation on Unix
    // -q: quiet, no start/done messages
    // /dev/null: don't save to file
    child = spawn('script', ['-q', '/dev/null', 'bash', script, ...args], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color' },
    });
  } else {
    child = spawn('bash', [script, ...args], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
  }

  child.stdout?.on('data', (data: Buffer) => {
    onOutput(stripAnsiCursor(data.toString()), 'stdout');
  });

  child.stderr?.on('data', (data: Buffer) => {
    onOutput(data.toString(), 'stderr');
  });

  let exitCallback: ((code: number) => void) | null = null;
  child.on('close', (code) => {
    if (exitCallback) exitCallback(code ?? 1);
  });

  return {
    kill: () => child.kill('SIGTERM'),
    write: (data: string) => child.stdin?.write(data),
    onExit: (callback: (code: number) => void) => {
      exitCallback = callback;
    },
  };
}

export function runPlan(
  args: string[],
  onOutput: (data: string, type: 'stdout' | 'stderr') => void
): ProcessHandle {
  const scriptsDir = findScriptsDir();
  const planScript = path.join(scriptsDir, 'plan.sh');

  // Try PTY first, fall back to script command
  if (pty) {
    try {
      const ptyProcess = pty.spawn('bash', [planScript, ...args], {
        name: 'xterm-256color',
        cols: process.stdout.columns || 80,
        rows: process.stdout.rows || 24,
        cwd: process.cwd(),
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      ptyProcess.onData((data: string) => {
        onOutput(stripAnsiCursor(data), 'stdout');
      });

      return {
        kill: () => ptyProcess.kill(),
        write: (data: string) => ptyProcess.write(data),
        onExit: (callback: (code: number) => void) => {
          ptyProcess.onExit(({ exitCode }) => callback(exitCode));
        },
      };
    } catch (err) {
      onOutput(`PTY failed, using fallback: ${err}\n`, 'stderr');
    }
  }

  // Fallback to script command
  return spawnWithFallback(planScript, args, onOutput);
}

export function runBuild(
  args: string[],
  onOutput: (data: string, type: 'stdout' | 'stderr') => void
): ProcessHandle {
  const scriptsDir = findScriptsDir();
  const buildScript = path.join(scriptsDir, 'build.sh');

  // Try PTY first, fall back to script command
  if (pty) {
    try {
      const ptyProcess = pty.spawn('bash', [buildScript, ...args], {
        name: 'xterm-256color',
        cols: process.stdout.columns || 80,
        rows: process.stdout.rows || 24,
        cwd: process.cwd(),
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      ptyProcess.onData((data: string) => {
        onOutput(stripAnsiCursor(data), 'stdout');
      });

      return {
        kill: () => ptyProcess.kill(),
        write: (data: string) => ptyProcess.write(data),
        onExit: (callback: (code: number) => void) => {
          ptyProcess.onExit(({ exitCode }) => callback(exitCode));
        },
      };
    } catch (err) {
      onOutput(`PTY failed, using fallback: ${err}\n`, 'stderr');
    }
  }

  // Fallback to script command
  return spawnWithFallback(buildScript, args, onOutput);
}

export function cancelBuild(): void {
  const cancelFile = path.join('.claude', '.cancel-test-loop');
  fs.writeFileSync(cancelFile, new Date().toISOString());
}
