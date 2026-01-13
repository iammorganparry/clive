import { spawn, ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import * as pty from 'node-pty';

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

export function runPlan(
  args: string[],
  onOutput: (data: string, type: 'stdout' | 'stderr') => void
): ProcessHandle {
  const scriptsDir = findScriptsDir();
  const planScript = path.join(scriptsDir, 'plan.sh');

  // Use PTY for proper terminal emulation (Claude Code needs a TTY)
  const ptyProcess = pty.spawn('bash', [planScript, ...args], {
    name: 'xterm-256color',
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    cwd: process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  ptyProcess.onData((data: string) => {
    // Strip cursor control sequences but keep colors
    onOutput(stripAnsiCursor(data), 'stdout');
  });

  return {
    kill: () => ptyProcess.kill(),
    write: (data: string) => ptyProcess.write(data),
    onExit: (callback: (code: number) => void) => {
      ptyProcess.onExit(({ exitCode }) => callback(exitCode));
    },
  };
}

export function runBuild(
  args: string[],
  onOutput: (data: string, type: 'stdout' | 'stderr') => void
): ProcessHandle {
  const scriptsDir = findScriptsDir();
  const buildScript = path.join(scriptsDir, 'build.sh');

  // Use PTY for proper terminal emulation
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
}

export function cancelBuild(): void {
  const cancelFile = path.join('.claude', '.cancel-test-loop');
  fs.writeFileSync(cancelFile, new Date().toISOString());
}
