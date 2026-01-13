import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

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

// Interactive process handle using child_process with pipes
export interface PtyProcessHandle {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (code: number) => void) => void;
}

// Run build script interactively with piped stdio
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

  const child = spawn('bash', [buildScript, ...args], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLUMNS: String(cols),
      LINES: String(rows),
      // Force interactive mode for Claude
      CLIVE_INTERACTIVE: '1',
    },
  });

  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((code: number) => void) | null = null;

  child.stdout?.on('data', (data: Buffer) => {
    const str = data.toString();
    debugLog(`runBuildPty stdout: ${str.length} chars`);
    if (dataCallback) {
      dataCallback(str);
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    const str = data.toString();
    debugLog(`runBuildPty stderr: ${str.length} chars`);
    if (dataCallback) {
      dataCallback(str);
    }
  });

  child.on('close', (code) => {
    debugLog(`runBuildPty: exited with code ${code}`);
    if (exitCallback) {
      exitCallback(code ?? 1);
    }
  });

  child.on('error', (err) => {
    debugLog(`runBuildPty error: ${err.message}`);
    if (dataCallback) {
      dataCallback(`Error: ${err.message}\n`);
    }
  });

  return {
    write: (data: string) => {
      debugLog(`runBuildPty: writing ${data.length} chars: ${JSON.stringify(data)}`);
      child.stdin?.write(data);
    },
    resize: (_newCols: number, _newRows: number) => {
      // Can't resize with pipes, but we can try to signal
      debugLog(`runBuildPty: resize requested (not supported with pipes)`);
    },
    kill: () => {
      debugLog(`runBuildPty: killing process`);
      child.kill('SIGTERM');
    },
    onData: (callback: (data: string) => void) => {
      dataCallback = callback;
    },
    onExit: (callback: (code: number) => void) => {
      exitCallback = callback;
    },
  };
}

// Run plan script interactively with piped stdio
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

  const child = spawn('bash', [planScript, ...args], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLUMNS: String(cols),
      LINES: String(rows),
      CLIVE_INTERACTIVE: '1',
    },
  });

  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((code: number) => void) | null = null;

  child.stdout?.on('data', (data: Buffer) => {
    const str = data.toString();
    debugLog(`runPlanPty stdout: ${str.length} chars`);
    if (dataCallback) {
      dataCallback(str);
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    const str = data.toString();
    debugLog(`runPlanPty stderr: ${str.length} chars`);
    if (dataCallback) {
      dataCallback(str);
    }
  });

  child.on('close', (code) => {
    debugLog(`runPlanPty: exited with code ${code}`);
    if (exitCallback) {
      exitCallback(code ?? 1);
    }
  });

  child.on('error', (err) => {
    debugLog(`runPlanPty error: ${err.message}`);
    if (dataCallback) {
      dataCallback(`Error: ${err.message}\n`);
    }
  });

  return {
    write: (data: string) => {
      debugLog(`runPlanPty: writing ${data.length} chars: ${JSON.stringify(data)}`);
      child.stdin?.write(data);
    },
    resize: (_newCols: number, _newRows: number) => {
      debugLog(`runPlanPty: resize requested (not supported with pipes)`);
    },
    kill: () => {
      debugLog(`runPlanPty: killing process`);
      child.kill('SIGTERM');
    },
    onData: (callback: (data: string) => void) => {
      dataCallback = callback;
    },
    onExit: (callback: (code: number) => void) => {
      exitCallback = callback;
    },
  };
}
