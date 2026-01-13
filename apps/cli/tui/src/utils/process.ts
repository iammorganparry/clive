import { spawn, spawnSync, ChildProcess } from 'node:child_process';
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

export interface ProcessHandle {
  kill: () => void;
  write?: (data: string) => void;
  onExit: (callback: (code: number) => void) => void;
}

export function runPlan(
  args: string[],
  onOutput: (data: string, type: 'stdout' | 'stderr') => void
): ProcessHandle {
  const scriptsDir = findScriptsDir();
  const planScript = path.join(scriptsDir, 'plan.sh');

  const child = spawn('bash', [planScript, ...args], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  child.stdout?.on('data', (data: Buffer) => {
    onOutput(data.toString(), 'stdout');
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

export function runBuild(
  args: string[],
  onOutput: (data: string, type: 'stdout' | 'stderr') => void
): ProcessHandle {
  const scriptsDir = findScriptsDir();
  const buildScript = path.join(scriptsDir, 'build.sh');

  const child = spawn('bash', [buildScript, ...args], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  child.stdout?.on('data', (data: Buffer) => {
    onOutput(data.toString(), 'stdout');
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

export function cancelBuild(): void {
  const cancelFile = path.join('.claude', '.cancel-test-loop');
  fs.writeFileSync(cancelFile, new Date().toISOString());
}

// Check if running inside tmux
export function isInTmux(): boolean {
  return !!process.env.TMUX;
}

// Capture content from a tmux pane
export function captureTmuxPane(paneId: string): string | null {
  const result = spawnSync('tmux', [
    'capture-pane',
    '-p',           // Print to stdout
    '-t', paneId,   // Target pane
    '-e',           // Include escape sequences (colors)
  ], {
    encoding: 'utf8',
    env: { ...process.env },
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout || '';
}

// Kill a tmux pane
export function killTmuxPane(paneId: string): void {
  spawnSync('tmux', ['kill-pane', '-t', paneId], {
    encoding: 'utf8',
  });
}

// Run plan in a hidden tmux pane and stream output
export function runPlanInTmux(
  args: string[],
  onOutput: (content: string) => void,
  onComplete: (code: number) => void,
  onError?: (error: string) => void
): { paneId: string; stop: () => void } | null {
  if (!isInTmux()) {
    onError?.('Not running inside tmux');
    return null;
  }

  const scriptsDir = findScriptsDir();
  const planScript = path.join(scriptsDir, 'plan.sh');
  const cwd = process.cwd();

  // Ensure .claude directory exists
  const claudeDir = path.join(cwd, '.claude');
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  // Create a completion marker file
  const completionFile = path.join(claudeDir, '.plan-complete');

  // Remove old completion file
  if (fs.existsSync(completionFile)) {
    fs.unlinkSync(completionFile);
  }

  // Build command that will signal completion
  const escapedArgs = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
  const shellCommand = `cd '${cwd}' && bash '${planScript}' ${escapedArgs}; echo $? > '${completionFile}'`;

  // Create a new HIDDEN tmux window (not a split) for Claude
  // This runs Claude in the background without splitting our view
  const result = spawnSync('tmux', [
    'new-window',
    '-d',           // Don't switch to new window
    '-P',           // Print window/pane info
    '-F', '#{pane_id}',
    '-n', 'claude-plan',  // Window name
    '-c', cwd,
    'bash', '-c', shellCommand,
  ], {
    encoding: 'utf8',
    env: { ...process.env },
  });

  if (result.status !== 0) {
    onError?.(`tmux new-window failed: ${result.stderr || 'unknown error'}`);
    return null;
  }

  const paneId = result.stdout?.trim();

  if (!paneId) {
    onError?.('No pane ID returned from tmux');
    return null;
  }

  let lastContent = '';
  let stopped = false;

  // Poll for pane content and completion
  const pollInterval = setInterval(() => {
    if (stopped) return;

    // Capture pane content
    const content = captureTmuxPane(paneId);
    if (content && content !== lastContent) {
      lastContent = content;
      onOutput(content);
    }

    // Check for completion
    if (fs.existsSync(completionFile)) {
      stopped = true;
      clearInterval(pollInterval);
      try {
        const code = parseInt(fs.readFileSync(completionFile, 'utf8').trim(), 10) || 0;
        fs.unlinkSync(completionFile);
        // Kill the background window
        killTmuxPane(paneId);
        onComplete(code);
      } catch {
        killTmuxPane(paneId);
        onComplete(1);
      }
    }
  }, 500);

  return {
    paneId,
    stop: () => {
      stopped = true;
      clearInterval(pollInterval);
      killTmuxPane(paneId);
    },
  };
}

// Run plan interactively - this blocks and takes over the terminal
export function runPlanInteractive(args: string[]): number {
  const scriptsDir = findScriptsDir();
  const planScript = path.join(scriptsDir, 'plan.sh');

  const result = spawnSync('bash', [planScript, ...args], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env },
  });

  return result.status ?? 1;
}
