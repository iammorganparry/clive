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

/**
 * Parse NDJSON line and return displayable text (like extension's parseCliOutput)
 * Returns null for events that should be filtered out
 */
function parseNdjsonLine(line: string): string | null {
  if (!line.trim()) return null;

  try {
    const data = JSON.parse(line);

    // Text deltas - main content
    if (data.type === "content_block_delta" && data.delta?.type === "text_delta") {
      return data.delta.text;
    }

    // Text block start
    if (data.type === "content_block_start" && data.content_block?.type === "text") {
      return data.content_block.text || null;
    }

    // Tool use - format nicely
    if (data.type === "content_block_start" && data.content_block?.type === "tool_use") {
      const name = data.content_block.name;
      const input = data.content_block.input;
      let detail = "";
      if (input?.file_path) detail = ` ${input.file_path}`;
      else if (input?.pattern) detail = ` "${input.pattern}"`;
      else if (input?.command) detail = ` ${String(input.command).slice(0, 50)}`;
      else if (input?.description) detail = ` ${input.description}`;
      return `● ${name}${detail}\n`;
    }

    // Assistant message with content
    if (data.type === "assistant" && data.message?.content) {
      for (const block of data.message.content) {
        if (block.type === "text") {
          return block.text;
        }
        if (block.type === "tool_use") {
          return `● ${block.name}\n`;
        }
      }
      return null;
    }

    // Filter out all other JSON events:
    // - user (tool results echoed back)
    // - system
    // - message_start, message_delta, message_stop
    // - content_block_stop
    // - result, error
    // - input_json_delta (streaming tool input)
    return null;
  } catch {
    // Not JSON - return as plain text (bash script output, etc.)
    return line + "\n";
  }
}

// Run build script and stream output with bidirectional communication
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

  // Use pipe for stdin to enable bidirectional communication
  const child = spawn("bash", [buildScript, ...buildArgs], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((code: number) => void) | null = null;
  let promptSent = false;
  let buffer = ""; // Buffer for incomplete NDJSON lines

  // Send prompt via stdin after spawn (like extension's claude-cli-service.ts)
  child.on("spawn", () => {
    // Wait a moment for build.sh to write the prompt path, then read and send it
    setTimeout(() => {
      if (promptSent) return;
      try {
        const promptPath = fs.readFileSync(
          path.join(process.cwd(), ".claude", ".build-prompt-path"),
          "utf-8",
        ).trim();

        if (promptPath && fs.existsSync(promptPath)) {
          const promptContent = fs.readFileSync(promptPath, "utf-8");
          const userMessage = JSON.stringify({
            type: "user",
            message: {
              role: "user",
              content: `Read and execute all instructions in this prompt:\n\n${promptContent}`,
            },
          });
          if (child.stdin?.writable) {
            child.stdin.write(`${userMessage}\n`);
            promptSent = true;
          }
        }
      } catch {
        // Prompt file not ready yet or error reading - will retry or fail gracefully
      }
    }, 200); // Wait for build.sh to write the prompt path
  });

  // Buffer and parse NDJSON, only emit displayable content
  child.stdout?.on("data", (data: Buffer) => {
    const chunk = data.toString();
    buffer += chunk;

    // Split into complete lines
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer

    // Parse each line and emit only displayable content
    for (const line of lines) {
      const displayText = parseNdjsonLine(line);
      if (displayText && dataCallback) {
        dataCallback(displayText);
      }
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    if (dataCallback) dataCallback(data.toString());
  });

  child.on("close", (code) => {
    // Flush any remaining buffer
    if (buffer.trim()) {
      const displayText = parseNdjsonLine(buffer);
      if (displayText && dataCallback) {
        dataCallback(displayText);
      }
    }
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
// Note: plan.sh uses Docker sandbox and doesn't support streaming NDJSON
// This function is kept for interface compatibility but bidirectional features are no-ops
export function runPlanInteractive(args: string[]): InteractiveProcessHandle {
  const scriptsDir = findScriptsDir();
  const planScript = path.join(scriptsDir, "plan.sh");

  // Plan uses the provided args directly
  const planArgs = [...args];

  const child = spawn("bash", [planScript, ...planArgs], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  let eventCallback: ((event: ClaudeEvent) => void) | null = null;
  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((code: number) => void) | null = null;

  // Just pass through stdout/stderr as plain text (not NDJSON)
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
    // Note: These methods are no-ops since plan.sh doesn't support bidirectional communication
    sendToolResult: (_toolCallId: string, _result: string) => {
      // Not supported
    },
    sendUserMessage: (_message: string) => {
      // Not supported
    },
    close: () => {
      // No-op
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

  // Use pipe for stdin to enable bidirectional communication
  const child = spawn("bash", [buildScript, ...buildArgs], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  let eventCallback: ((event: ClaudeEvent) => void) | null = null;
  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((code: number) => void) | null = null;
  let buffer = "";
  let promptSent = false;

  // Send prompt via stdin after spawn (like extension's claude-cli-service.ts)
  child.on("spawn", () => {
    // Wait a moment for build.sh to write the prompt path, then read and send it
    setTimeout(() => {
      if (promptSent) return;
      try {
        const promptPath = fs.readFileSync(
          path.join(process.cwd(), ".claude", ".build-prompt-path"),
          "utf-8",
        ).trim();

        if (promptPath && fs.existsSync(promptPath)) {
          const promptContent = fs.readFileSync(promptPath, "utf-8");
          const userMessage = JSON.stringify({
            type: "user",
            message: {
              role: "user",
              content: `Read and execute all instructions in this prompt:\n\n${promptContent}`,
            },
          });
          if (child.stdin?.writable) {
            child.stdin.write(`${userMessage}\n`);
            promptSent = true;
          }
        }
      } catch {
        // Prompt file not ready yet or error reading - will retry or fail gracefully
      }
    }, 200); // Wait for build.sh to write the prompt path
  });

  // Buffer and parse NDJSON, only emit displayable content
  child.stdout?.on("data", (data: Buffer) => {
    const chunk = data.toString();
    buffer += chunk;

    // Parse NDJSON lines
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      // Emit displayable content to dataCallback
      const displayText = parseNdjsonLine(line);
      if (displayText && dataCallback) {
        dataCallback(displayText);
      }

      // Also emit parsed events for eventCallback
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
      const displayText = parseNdjsonLine(buffer);
      if (displayText && dataCallback) {
        dataCallback(displayText);
      }
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
