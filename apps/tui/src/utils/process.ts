import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ClaudeEvent,
  formatToolResult,
  parseClaudeEvent,
} from "./claude-events.js";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Find the clive CLI scripts directory
function findScriptsDir(): string {
  const possiblePaths = [
    path.join(__dirname, "..", "..", "cli", "scripts"), // apps/tui/dist -> apps/cli/scripts
    path.join(process.cwd(), "apps", "cli", "scripts"),
    "/usr/local/share/clive/scripts",
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }

  // Fallback: throw an error if scripts not found
  throw new Error(
    `Could not find clive CLI scripts directory. Searched: ${possiblePaths.join(", ")}`,
  );
}

export function cancelBuild(): void {
  const cancelFile = path.join(".claude", ".cancel-test-loop");
  const claudeDir = path.dirname(cancelFile);
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  fs.writeFileSync(cancelFile, new Date().toISOString());
}

// Interactive process handle for bidirectional communication
export interface InteractiveProcessHandle {
  /** Kill the process */
  kill: () => void;
  /** Subscribe to parsed Claude events */
  onEvent: (callback: (event: ClaudeEvent) => void) => void;
  /** Subscribe to raw output data (for display) */
  onData: (callback: (data: string) => void) => void;
  /** Subscribe to exit */
  onExit: (callback: (code: number) => void) => void;
  /** Send a tool result back to the process */
  sendToolResult: (toolCallId: string, result: string) => void;
  /** Send a user guidance message to the process */
  sendUserMessage: (message: string) => void;
  /** Close stdin to signal completion */
  close: () => void;
}

// Process handle for streaming output with optional stdin support
export interface ProcessHandle {
  kill: () => void;
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (code: number) => void) => void;
  /** Send a message to the process stdin (optional) */
  sendMessage?: (message: string) => void;
}

// Run build script and stream output
export function runBuild(args: string[], epicId?: string): ProcessHandle {
  const scriptsDir = findScriptsDir();
  const buildScript = path.join(scriptsDir, "build.sh");

  // Filter out -i/--interactive flags (TUI uses streaming mode)
  const filteredArgs = args.filter((a) => a !== "-i" && a !== "--interactive");

  // Build command args
  const buildArgs = ["--streaming", ...filteredArgs];

  // Add epic filter if provided
  if (epicId) {
    buildArgs.push("--epic", epicId);
  }

  // Use pipe for stdin to enable user guidance messages
  const child = spawn("bash", [buildScript, ...buildArgs], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((code: number) => void) | null = null;

  child.stdout?.on("data", (data: Buffer) => {
    if (dataCallback) dataCallback(data.toString());
  });

  child.stderr?.on("data", (data: Buffer) => {
    if (dataCallback) dataCallback(data.toString());
  });

  child.on("close", (code) => {
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
    sendMessage: (message: string) => {
      if (child.stdin?.writable) {
        // Send as JSON message for Claude to process
        const userMessage = JSON.stringify({
          type: "user",
          message: { role: "user", content: message },
        });
        child.stdin.write(`${userMessage}\n`);
      }
    },
  };
}

// Run plan script and stream output
export function runPlan(args: string[]): ProcessHandle {
  const scriptsDir = findScriptsDir();
  const planScript = path.join(scriptsDir, "plan.sh");

  const child = spawn("bash", [planScript, ...args], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((code: number) => void) | null = null;

  child.stdout?.on("data", (data: Buffer) => {
    if (dataCallback) dataCallback(data.toString());
  });

  child.stderr?.on("data", (data: Buffer) => {
    if (dataCallback) dataCallback(data.toString());
  });

  child.on("close", (code) => {
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
}

// Run plan script with interactive bidirectional communication
// This enables handling AskUserQuestion and tool approvals
export function runPlanInteractive(args: string[]): InteractiveProcessHandle {
  const scriptsDir = findScriptsDir();
  const planScript = path.join(scriptsDir, "plan.sh");

  // Plan uses the provided args directly
  const planArgs = [...args];

  const child = spawn("bash", [planScript, ...planArgs], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"], // Enable stdin for bidirectional communication
    env: process.env,
  });

  let eventCallback: ((event: ClaudeEvent) => void) | null = null;
  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((code: number) => void) | null = null;
  let buffer = "";

  // Process stdout as NDJSON
  child.stdout?.on("data", (data: Buffer) => {
    const chunk = data.toString();
    buffer += chunk;

    // Also emit raw data for display
    if (dataCallback) dataCallback(chunk);

    // Parse NDJSON lines
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = parseClaudeEvent(line);
      if (event && eventCallback) {
        eventCallback(event);
      }
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    if (dataCallback) dataCallback(data.toString());
  });

  child.on("close", (code) => {
    // Process any remaining buffer
    if (buffer.trim()) {
      const event = parseClaudeEvent(buffer);
      if (event && eventCallback) {
        eventCallback(event);
      }
    }
    if (exitCallback) exitCallback(code ?? 1);
  });

  child.on("error", (err) => {
    if (dataCallback) dataCallback(`Error: ${err.message}\n`);
    if (eventCallback) {
      eventCallback({ type: "error", message: err.message });
    }
  });

  return {
    kill: () => child.kill("SIGTERM"),
    onEvent: (callback) => {
      eventCallback = callback;
    },
    onData: (callback) => {
      dataCallback = callback;
    },
    onExit: (callback) => {
      exitCallback = callback;
    },
    sendToolResult: (toolCallId: string, result: string) => {
      if (child.stdin?.writable) {
        const message = formatToolResult(toolCallId, result);
        child.stdin.write(`${message}\n`);
      }
    },
    sendUserMessage: (message: string) => {
      if (child.stdin?.writable) {
        const userMessage = JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: message,
          },
        });
        child.stdin.write(`${userMessage}\n`);
      }
    },
    close: () => {
      if (child.stdin?.writable) {
        child.stdin.end();
      }
    },
  };
}

// Run build script with interactive bidirectional communication
export function runBuildInteractive(
  args: string[],
  epicId?: string,
): InteractiveProcessHandle {
  const scriptsDir = findScriptsDir();
  const buildScript = path.join(scriptsDir, "build.sh");

  // Filter out -i/--interactive flags (TUI uses streaming mode)
  const filteredArgs = args.filter((a) => a !== "-i" && a !== "--interactive");

  // Build command args - streaming mode handles output format internally
  const buildArgs = ["--streaming", ...filteredArgs];

  // Add epic filter if provided
  if (epicId) {
    buildArgs.push("--epic", epicId);
  }

  const child = spawn("bash", [buildScript, ...buildArgs], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"], // Enable stdin for bidirectional communication
    env: process.env,
  });

  let eventCallback: ((event: ClaudeEvent) => void) | null = null;
  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((code: number) => void) | null = null;
  let buffer = "";

  // Process stdout as NDJSON
  child.stdout?.on("data", (data: Buffer) => {
    const chunk = data.toString();
    buffer += chunk;

    // Also emit raw data for display
    if (dataCallback) dataCallback(chunk);

    // Parse NDJSON lines
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = parseClaudeEvent(line);
      if (event && eventCallback) {
        eventCallback(event);
      }
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    if (dataCallback) dataCallback(data.toString());
  });

  child.on("close", (code) => {
    // Process any remaining buffer
    if (buffer.trim()) {
      const event = parseClaudeEvent(buffer);
      if (event && eventCallback) {
        eventCallback(event);
      }
    }
    if (exitCallback) exitCallback(code ?? 1);
  });

  child.on("error", (err) => {
    if (dataCallback) dataCallback(`Error: ${err.message}\n`);
    if (eventCallback) {
      eventCallback({ type: "error", message: err.message });
    }
  });

  return {
    kill: () => child.kill("SIGTERM"),
    onEvent: (callback) => {
      eventCallback = callback;
    },
    onData: (callback) => {
      dataCallback = callback;
    },
    onExit: (callback) => {
      exitCallback = callback;
    },
    sendToolResult: (toolCallId: string, result: string) => {
      if (child.stdin?.writable) {
        const message = formatToolResult(toolCallId, result);
        child.stdin.write(`${message}\n`);
      }
    },
    sendUserMessage: (message: string) => {
      if (child.stdin?.writable) {
        const userMessage = JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: message,
          },
        });
        child.stdin.write(`${userMessage}\n`);
      }
    },
    close: () => {
      if (child.stdin?.writable) {
        child.stdin.end();
      }
    },
  };
}
