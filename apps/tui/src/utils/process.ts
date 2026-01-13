import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Find the clive CLI scripts directory
function findScriptsDir(): string {
  const possiblePaths = [
    path.join(__dirname, '..', '..', '..', 'cli', 'scripts'), // apps/tui/dist -> apps/cli/scripts
    path.join(process.cwd(), 'apps', 'cli', 'scripts'),
    '/usr/local/share/clive/scripts',
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }

  return process.cwd();
}

export function cancelBuild(): void {
  const cancelFile = path.join('.claude', '.cancel-test-loop');
  const claudeDir = path.dirname(cancelFile);
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  fs.writeFileSync(cancelFile, new Date().toISOString());
}

// Process handle for streaming output
export interface ProcessHandle {
  kill: () => void;
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (code: number) => void) => void;
}

// Run build script and stream output
export function runBuild(args: string[], epicId?: string): ProcessHandle {
  const scriptsDir = findScriptsDir();
  const buildScript = path.join(scriptsDir, 'build.sh');

  // Filter out -i/--interactive flags (TUI uses streaming mode)
  const filteredArgs = args.filter(a => a !== '-i' && a !== '--interactive');

  // Build command args
  const buildArgs = ['--streaming', ...filteredArgs];

  // Add epic filter if provided
  if (epicId) {
    buildArgs.push('--epic', epicId);
  }

  // Always use --streaming flag for TUI output capture
  const child = spawn('bash', [buildScript, ...buildArgs], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((code: number) => void) | null = null;

  child.stdout?.on('data', (data: Buffer) => {
    if (dataCallback) dataCallback(data.toString());
  });

  child.stderr?.on('data', (data: Buffer) => {
    if (dataCallback) dataCallback(data.toString());
  });

  child.on('close', (code) => {
    if (exitCallback) exitCallback(code ?? 1);
  });

  child.on('error', (err) => {
    if (dataCallback) dataCallback(`Error: ${err.message}\n`);
  });

  return {
    kill: () => child.kill('SIGTERM'),
    onData: (callback) => { dataCallback = callback; },
    onExit: (callback) => { exitCallback = callback; },
  };
}

// Run plan script and stream output
export function runPlan(args: string[]): ProcessHandle {
  const scriptsDir = findScriptsDir();
  const planScript = path.join(scriptsDir, 'plan.sh');

  const child = spawn('bash', [planScript, ...args], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((code: number) => void) | null = null;

  child.stdout?.on('data', (data: Buffer) => {
    if (dataCallback) dataCallback(data.toString());
  });

  child.stderr?.on('data', (data: Buffer) => {
    if (dataCallback) dataCallback(data.toString());
  });

  child.on('close', (code) => {
    if (exitCallback) exitCallback(code ?? 1);
  });

  child.on('error', (err) => {
    if (dataCallback) dataCallback(`Error: ${err.message}\n`);
  });

  return {
    kill: () => child.kill('SIGTERM'),
    onData: (callback) => { dataCallback = callback; },
    onExit: (callback) => { exitCallback = callback; },
  };
}
