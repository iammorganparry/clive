import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Task } from "../types.js";
import {
  type BeadsEpic,
  getAllTasks,
  getEpics,
  getEpicTasks,
  getReadyTasks,
} from "../utils/beads.js";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Process handle for streaming output
 */
export interface ProcessHandle {
  kill: () => void;
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (code: number) => void) => void;
}

/**
 * RPC Context - provides implementations for router procedures
 */
export interface RpcContext {
  // Process management
  runBuild: (args: string[], epicId?: string) => ProcessHandle;
  runPlan: (args: string[]) => ProcessHandle;
  cancelBuild: () => void;
  killCurrentProcess: () => void;

  // Task operations
  getAllTasks: () => Task[];
  getEpicTasks: (epicId: string) => Task[];
  getReadyTasks: () => Task[];
  getEpics: () => BeadsEpic[];
}

// Find the clive CLI scripts directory
function findScriptsDir(): string {
  const possiblePaths = [
    path.join(__dirname, "..", "..", "..", "..", "cli", "scripts"), // apps/tui/dist/rpc -> apps/cli/scripts
    path.join(__dirname, "..", "..", "..", "cli", "scripts"), // apps/tui/src/rpc -> apps/cli/scripts
    path.join(process.cwd(), "apps", "cli", "scripts"),
    "/usr/local/share/clive/scripts",
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }

  return process.cwd();
}

/**
 * Create the RPC context with all implementations
 */
export function createRpcContext(): RpcContext {
  let currentProcess: ReturnType<typeof spawn> | null = null;

  const runBuild = (args: string[], epicId?: string): ProcessHandle => {
    const scriptsDir = findScriptsDir();
    const buildScript = path.join(scriptsDir, "build.sh");

    // Filter out -i/--interactive flags (TUI uses streaming mode)
    const filteredArgs = args.filter(
      (a) => a !== "-i" && a !== "--interactive",
    );

    // Build command args
    const buildArgs = ["--streaming", ...filteredArgs];

    // Add epic filter if provided
    if (epicId) {
      buildArgs.push("--epic", epicId);
    }

    const child = spawn("bash", [buildScript, ...buildArgs], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    currentProcess = child;

    let dataCallback: ((data: string) => void) | null = null;
    let exitCallback: ((code: number) => void) | null = null;

    child.stdout?.on("data", (data: Buffer) => {
      if (dataCallback) dataCallback(data.toString());
    });

    child.stderr?.on("data", (data: Buffer) => {
      if (dataCallback) dataCallback(data.toString());
    });

    child.on("close", (code) => {
      currentProcess = null;
      if (exitCallback) exitCallback(code ?? 1);
    });

    child.on("error", (err) => {
      if (dataCallback) dataCallback(`Error: ${err.message}\n`);
    });

    return {
      kill: () => child.kill("SIGTERM"),
      onData: (callback) => {
        dataCallback = callback;
      },
      onExit: (callback) => {
        exitCallback = callback;
      },
    };
  };

  const runPlan = (args: string[]): ProcessHandle => {
    const scriptsDir = findScriptsDir();
    const planScript = path.join(scriptsDir, "plan.sh");

    const child = spawn("bash", [planScript, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    currentProcess = child;

    let dataCallback: ((data: string) => void) | null = null;
    let exitCallback: ((code: number) => void) | null = null;

    child.stdout?.on("data", (data: Buffer) => {
      if (dataCallback) dataCallback(data.toString());
    });

    child.stderr?.on("data", (data: Buffer) => {
      if (dataCallback) dataCallback(data.toString());
    });

    child.on("close", (code) => {
      currentProcess = null;
      if (exitCallback) exitCallback(code ?? 1);
    });

    child.on("error", (err) => {
      if (dataCallback) dataCallback(`Error: ${err.message}\n`);
    });

    return {
      kill: () => child.kill("SIGTERM"),
      onData: (callback) => {
        dataCallback = callback;
      },
      onExit: (callback) => {
        exitCallback = callback;
      },
    };
  };

  const cancelBuild = (): void => {
    const cancelFile = path.join(".claude", ".cancel-test-loop");
    const claudeDir = path.dirname(cancelFile);
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    fs.writeFileSync(cancelFile, new Date().toISOString());

    // Also kill current process if running
    if (currentProcess) {
      currentProcess.kill("SIGTERM");
      currentProcess = null;
    }
  };

  const killCurrentProcess = (): void => {
    if (currentProcess) {
      currentProcess.kill("SIGTERM");
      currentProcess = null;
    }
  };

  return {
    runBuild,
    runPlan,
    cancelBuild,
    killCurrentProcess,
    getAllTasks,
    getEpicTasks,
    getReadyTasks,
    getEpics,
  };
}
