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

// Debug log file for tracing output flow
const DEBUG_LOG = process.env.CLIVE_DEBUG === '1';
function debugLog(msg: string): void {
  if (DEBUG_LOG) {
    const claudeDir = path.join(process.cwd(), '.claude');
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    const logFile = path.join(claudeDir, 'debug.log');
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  }
}

export function cancelBuild(): void {
  const cancelFile = path.join('.claude', '.cancel-test-loop');
  const claudeDir = path.dirname(cancelFile);
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  fs.writeFileSync(cancelFile, new Date().toISOString());
}

// PTY-based interactive process handle
export interface PtyProcessHandle {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (code: number) => void) => void;
}

// Run build script interactively with PTY support
export function runBuildPty(
  args: string[],
  cols: number = 80,
  rows: number = 24
): PtyProcessHandle {
  const scriptsDir = findScriptsDir();
  const buildScript = path.join(scriptsDir, 'build.sh');

  debugLog(`runBuildPty: script path: ${buildScript}`);
  debugLog(`runBuildPty: cwd: ${process.cwd()}`);
  debugLog(`runBuildPty: args: ${args.join(' ')}`);

  const ptyProcess = pty.spawn('bash', [buildScript, ...args], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.cwd(),
    env: process.env as { [key: string]: string },
  });

  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((code: number) => void) | null = null;

  ptyProcess.onData((data: string) => {
    debugLog(`runBuildPty: received ${data.length} chars`);
    if (dataCallback) {
      dataCallback(data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    debugLog(`runBuildPty: exited with code ${exitCode}`);
    if (exitCallback) {
      exitCallback(exitCode);
    }
  });

  return {
    write: (data: string) => {
      debugLog(`runBuildPty: writing ${data.length} chars`);
      ptyProcess.write(data);
    },
    resize: (newCols: number, newRows: number) => {
      debugLog(`runBuildPty: resize to ${newCols}x${newRows}`);
      ptyProcess.resize(newCols, newRows);
    },
    kill: () => {
      debugLog(`runBuildPty: killing process`);
      ptyProcess.kill();
    },
    onData: (callback: (data: string) => void) => {
      dataCallback = callback;
    },
    onExit: (callback: (code: number) => void) => {
      exitCallback = callback;
    },
  };
}

// Run plan script interactively with PTY support
export function runPlanPty(
  args: string[],
  cols: number = 80,
  rows: number = 24
): PtyProcessHandle {
  const scriptsDir = findScriptsDir();
  const planScript = path.join(scriptsDir, 'plan.sh');

  debugLog(`runPlanPty: script path: ${planScript}`);
  debugLog(`runPlanPty: cwd: ${process.cwd()}`);
  debugLog(`runPlanPty: args: ${args.join(' ')}`);

  const ptyProcess = pty.spawn('bash', [planScript, ...args], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.cwd(),
    env: process.env as { [key: string]: string },
  });

  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((code: number) => void) | null = null;

  ptyProcess.onData((data: string) => {
    debugLog(`runPlanPty: received ${data.length} chars`);
    if (dataCallback) {
      dataCallback(data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    debugLog(`runPlanPty: exited with code ${exitCode}`);
    if (exitCallback) {
      exitCallback(exitCode);
    }
  });

  return {
    write: (data: string) => {
      debugLog(`runPlanPty: writing ${data.length} chars`);
      ptyProcess.write(data);
    },
    resize: (newCols: number, newRows: number) => {
      debugLog(`runPlanPty: resize to ${newCols}x${newRows}`);
      ptyProcess.resize(newCols, newRows);
    },
    kill: () => {
      debugLog(`runPlanPty: killing process`);
      ptyProcess.kill();
    },
    onData: (callback: (data: string) => void) => {
      dataCallback = callback;
    },
    onExit: (callback: (code: number) => void) => {
      exitCallback = callback;
    },
  };
}
