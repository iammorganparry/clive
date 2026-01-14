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
 * Extract a meaningful detail string from tool input
 */
function extractToolDetail(name: string, input: Record<string, unknown> | undefined): string {
  if (!input || Object.keys(input).length === 0) return "";

  switch (name) {
    case "Read":
      if (input.file_path) return ` ${input.file_path}`;
      break;
    case "Write":
    case "Edit":
      if (input.file_path) return ` ${input.file_path}`;
      break;
    case "Bash":
      if (input.command) {
        const cmd = String(input.command).split("\n")[0].slice(0, 60);
        return ` ${cmd}${String(input.command).length > 60 ? "..." : ""}`;
      }
      if (input.description) return ` ${input.description}`;
      break;
    case "Grep":
      if (input.pattern) {
        const pattern = String(input.pattern).slice(0, 30);
        const path = input.path ? ` in ${input.path}` : "";
        return ` "${pattern}"${path}`;
      }
      break;
    case "Glob":
      if (input.pattern) return ` ${input.pattern}`;
      break;
    case "Task":
      if (input.description) return ` ${input.description}`;
      break;
    case "TodoWrite":
      return " updating tasks";
    case "WebFetch":
      if (input.url) return ` ${input.url}`;
      break;
    case "WebSearch":
      if (input.query) return ` "${input.query}"`;
      break;
    default:
      // Generic fallback: try common field names
      if (input.file_path) return ` ${input.file_path}`;
      if (input.pattern) return ` "${input.pattern}"`;
      if (input.command) return ` ${String(input.command).slice(0, 50)}`;
      if (input.description) return ` ${input.description}`;
      if (input.query) return ` "${input.query}"`;
      if (input.url) return ` ${input.url}`;
  }
  return "";
}

// Track partial tool inputs during streaming (indexed by content block index)
const toolInputBuffers: Map<number, { name: string; partialJson: string }> = new Map();

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

    // Tool use start - initialize buffer for streaming input
    if (data.type === "content_block_start" && data.content_block?.type === "tool_use") {
      const name = data.content_block.name;
      const input = data.content_block.input as Record<string, unknown> | undefined;
      const index = data.index ?? 0;

      // Initialize buffer for this tool's streaming input
      toolInputBuffers.set(index, { name, partialJson: "" });

      // If input is already populated (non-streaming), show it
      const detail = extractToolDetail(name, input);
      if (detail) {
        return `● ${name}${detail}\n`;
      }
      // Otherwise just show the name - we'll update when we get input_json_delta
      return `● ${name}\n`;
    }

    // Streaming tool input - accumulate JSON and try to extract details
    if (data.type === "content_block_delta" && data.delta?.type === "input_json_delta") {
      const index = data.index ?? 0;
      const partial = data.delta.partial_json ?? "";
      const buffer = toolInputBuffers.get(index);

      if (buffer) {
        buffer.partialJson += partial;

        // Try to parse accumulated JSON to extract details
        try {
          const input = JSON.parse(buffer.partialJson) as Record<string, unknown>;
          const detail = extractToolDetail(buffer.name, input);
          if (detail) {
            // Clear buffer and emit the detail
            toolInputBuffers.delete(index);
            return `  → ${detail.trim()}\n`;
          }
        } catch {
          // JSON not complete yet, keep accumulating
        }
      }
      return null;
    }

    // Tool use complete - clear buffer
    if (data.type === "content_block_stop") {
      const index = data.index ?? 0;
      toolInputBuffers.delete(index);
      return null;
    }

    // Assistant message with content (non-streaming format)
    if (data.type === "assistant" && data.message?.content) {
      const results: string[] = [];
      for (const block of data.message.content) {
        if (block.type === "text") {
          results.push(block.text);
        }
        if (block.type === "tool_use") {
          const detail = extractToolDetail(block.name, block.input as Record<string, unknown>);
          results.push(`● ${block.name}${detail}\n`);
        }
      }
      return results.length > 0 ? results.join("") : null;
    }

    // Filter out all other JSON events:
    // - user (tool results echoed back)
    // - system
    // - message_start, message_delta, message_stop
    // - result, error
    return null;
  } catch {
    // Not JSON - return as plain text (bash script output, etc.)
    return line + "\n";
  }
}

// Completion markers that signal end of iteration
const COMPLETION_MARKERS = [
  "<promise>TASK_COMPLETE</promise>",
  "<promise>ALL_TASKS_COMPLETE</promise>",
  "<promise>ITERATION_COMPLETE</promise>", // Legacy
  "<promise>ALL_SUITES_COMPLETE</promise>", // Legacy
];

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
  let stdinClosed = false;
  let buffer = ""; // Buffer for incomplete NDJSON lines

  // Check if text contains a completion marker
  const checkForCompletion = (text: string): boolean => {
    return COMPLETION_MARKERS.some((marker) => text.includes(marker));
  };

  // Close stdin to signal Claude to exit (allows build loop to continue)
  const closeStdin = () => {
    if (!stdinClosed && child.stdin?.writable) {
      stdinClosed = true;
      child.stdin.end();
    }
  };

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
        // Check for completion markers - close stdin to let Claude exit
        if (checkForCompletion(displayText)) {
          closeStdin();
        }
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

// Run plan script and stream output with bidirectional communication
export function runPlan(args: string[]): ProcessHandle {
  const scriptsDir = findScriptsDir();
  const planScript = path.join(scriptsDir, "plan.sh");

  // Add --streaming flag for TUI mode
  const planArgs = ["--streaming", ...args];

  // Use pipe for stdin to enable bidirectional communication
  const child = spawn("bash", [planScript, ...planArgs], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((code: number) => void) | null = null;
  let promptSent = false;
  let buffer = ""; // Buffer for incomplete NDJSON lines

  // Send prompt via stdin after spawn
  child.on("spawn", () => {
    // Wait a moment for plan.sh to write the prompt path, then read and send it
    setTimeout(() => {
      if (promptSent) return;
      try {
        const promptPath = fs.readFileSync(
          path.join(process.cwd(), ".claude", ".plan-prompt-path"),
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
    }, 200); // Wait for plan.sh to write the prompt path
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

// Run plan script with interactive bidirectional communication
export function runPlanInteractive(args: string[]): InteractiveProcessHandle {
  const scriptsDir = findScriptsDir();
  const planScript = path.join(scriptsDir, "plan.sh");

  // Add --streaming flag for TUI mode
  const planArgs = ["--streaming", ...args];

  // Use pipe for stdin to enable bidirectional communication
  const child = spawn("bash", [planScript, ...planArgs], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  let eventCallback: ((event: ClaudeEvent) => void) | null = null;
  let dataCallback: ((data: string) => void) | null = null;
  let exitCallback: ((code: number) => void) | null = null;
  let buffer = "";
  let promptSent = false;

  // Send prompt via stdin after spawn
  child.on("spawn", () => {
    // Wait a moment for plan.sh to write the prompt path, then read and send it
    setTimeout(() => {
      if (promptSent) return;
      try {
        const promptPath = fs.readFileSync(
          path.join(process.cwd(), ".claude", ".plan-prompt-path"),
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
    }, 200); // Wait for plan.sh to write the prompt path
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
  let stdinClosed = false;

  // Close stdin to signal Claude to exit (allows build loop to continue)
  const closeStdin = () => {
    if (!stdinClosed && child.stdin?.writable) {
      stdinClosed = true;
      child.stdin.end();
    }
  };

  // Check if text contains a completion marker
  const checkForCompletion = (text: string): boolean => {
    return COMPLETION_MARKERS.some((marker) => text.includes(marker));
  };

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
        // Check for completion markers - close stdin to let Claude exit
        if (checkForCompletion(displayText)) {
          closeStdin();
        }
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
