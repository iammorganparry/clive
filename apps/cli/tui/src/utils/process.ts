import { spawn, spawnSync, ChildProcess } from 'node:child_process';
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

// Debug log file for tracing output flow
const DEBUG_LOG = process.env.CLIVE_DEBUG === '1';
function debugLog(msg: string): void {
  if (DEBUG_LOG) {
    const logFile = path.join(process.cwd(), '.claude', 'debug.log');
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  }
}

// Capture content from a tmux pane
export function captureTmuxPane(paneId: string): string | null {
  const result = spawnSync('tmux', [
    'capture-pane',
    '-p',           // Print to stdout
    '-t', paneId,   // Target pane
    '-S', '-',      // Start from beginning of scrollback
  ], {
    encoding: 'utf8',
    env: { ...process.env },
  });

  if (result.status !== 0) {
    debugLog(`capture-pane failed for ${paneId}: ${result.stderr}`);
    return null;
  }

  debugLog(`capture-pane got ${result.stdout?.length || 0} chars`);
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

  debugLog(`runPlanInTmux: created pane ${paneId}`);

  let lastContent = '';
  let stopped = false;

  // Poll for pane content and completion
  const pollInterval = setInterval(() => {
    if (stopped) return;

    // Capture pane content
    const content = captureTmuxPane(paneId);
    debugLog(`runPlanInTmux poll: content=${content?.length || 0} chars, lastContent=${lastContent.length} chars`);

    if (content && content !== lastContent) {
      // Send new content (character-based diff)
      const newContent = content.length > lastContent.length
        ? content.slice(lastContent.length)
        : content; // If content is shorter/different, send all of it

      debugLog(`runPlanInTmux: sending ${newContent.length} new chars`);
      if (newContent.trim()) {
        onOutput(newContent);
      }
      lastContent = content;
    }

    // Check for completion
    if (fs.existsSync(completionFile)) {
      stopped = true;
      clearInterval(pollInterval);
      debugLog(`runPlanInTmux: completion file found`);
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

// Run build in a hidden tmux pane and stream output
export function runBuildInTmux(
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
  const buildScript = path.join(scriptsDir, 'build.sh');
  const cwd = process.cwd();

  // Ensure .claude directory exists
  const claudeDir = path.join(cwd, '.claude');
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  // Create a completion marker file
  const completionFile = path.join(claudeDir, '.build-complete');

  // Remove old completion file
  if (fs.existsSync(completionFile)) {
    fs.unlinkSync(completionFile);
  }

  // Build command that will signal completion
  const escapedArgs = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
  const shellCommand = `cd '${cwd}' && bash '${buildScript}' ${escapedArgs}; echo $? > '${completionFile}'`;

  // Create a new HIDDEN tmux window for the build
  const result = spawnSync('tmux', [
    'new-window',
    '-d',
    '-P',
    '-F', '#{pane_id}',
    '-n', 'claude-build',
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

  debugLog(`runBuildInTmux: created pane ${paneId}`);

  let lastContent = '';
  let stopped = false;

  // Poll for pane content and completion
  const pollInterval = setInterval(() => {
    if (stopped) return;

    // Capture pane content
    const content = captureTmuxPane(paneId);
    debugLog(`runBuildInTmux poll: content=${content?.length || 0} chars, lastContent=${lastContent.length} chars`);

    if (content && content !== lastContent) {
      // Send new content (character-based diff)
      const newContent = content.length > lastContent.length
        ? content.slice(lastContent.length)
        : content; // If content is shorter/different, send all of it

      debugLog(`runBuildInTmux: sending ${newContent.length} new chars`);
      if (newContent.trim()) {
        onOutput(newContent);
      }
      lastContent = content;
    }

    // Check for completion
    if (fs.existsSync(completionFile)) {
      stopped = true;
      clearInterval(pollInterval);
      debugLog(`runBuildInTmux: completion file found`);
      try {
        const code = parseInt(fs.readFileSync(completionFile, 'utf8').trim(), 10) || 0;
        fs.unlinkSync(completionFile);
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

  debugLog(`runBuildPty: starting with args ${args.join(' ')}`);

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
    resize: (cols: number, rows: number) => {
      debugLog(`runBuildPty: resize to ${cols}x${rows}`);
      ptyProcess.resize(cols, rows);
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

  debugLog(`runPlanPty: starting with args ${args.join(' ')}`);

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
    resize: (cols: number, rows: number) => {
      debugLog(`runPlanPty: resize to ${cols}x${rows}`);
      ptyProcess.resize(cols, rows);
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
