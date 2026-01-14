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
  /** Subscribe to typed display output (for display with proper styling) */
  onData: (callback: (data: DisplayOutput) => void) => void;
  /** Subscribe to exit */
  onExit: (callback: (code: number) => void) => void;
  /** Send a tool result back to the process */
  sendToolResult: (toolCallId: string, result: string) => void;
  /** Send a user guidance message to the process */
  sendUserMessage: (message: string) => void;
  /** Close stdin to signal completion */
  close: () => void;
}

// Process handle for streaming output
export interface ProcessHandle {
  kill: () => void;
  onData: (callback: (data: DisplayOutput) => void) => void;
  onExit: (callback: (code: number) => void) => void;
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

// Typed output from NDJSON parsing
export interface DisplayOutput {
  type: "assistant" | "tool" | "tool_detail" | "plain";
  text: string;
  toolName?: string;
}

/**
 * Parse NDJSON line and return typed displayable output
 * Returns null for events that should be filtered out
 */
function parseNdjsonLine(line: string): DisplayOutput | null {
  if (!line.trim()) return null;

  try {
    const data = JSON.parse(line);

    // Text deltas - main content (assistant text)
    if (data.type === "content_block_delta" && data.delta?.type === "text_delta") {
      return { type: "assistant", text: data.delta.text };
    }

    // Text block start (assistant text)
    if (data.type === "content_block_start" && data.content_block?.type === "text") {
      const text = data.content_block.text;
      return text ? { type: "assistant", text } : null;
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
      return { type: "tool", text: `● ${name}${detail}\n`, toolName: name };
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
            return { type: "tool_detail", text: `  → ${detail.trim()}\n` };
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
      const results: DisplayOutput[] = [];
      for (const block of data.message.content) {
        if (block.type === "text") {
          results.push({ type: "assistant", text: block.text });
        }
        if (block.type === "tool_use") {
          const detail = extractToolDetail(block.name, block.input as Record<string, unknown>);
          results.push({ type: "tool", text: `● ${block.name}${detail}\n`, toolName: block.name });
        }
      }
      // Combine all text into one output
      if (results.length > 0) {
        const text = results.map(r => r.text).join("");
        // If any is assistant type, return assistant type
        const hasAssistant = results.some(r => r.type === "assistant");
        return { type: hasAssistant ? "assistant" : "tool", text };
      }
      return null;
    }

    // Filter out all other JSON events:
    // - user (tool results echoed back)
    // - system
    // - message_start, message_delta, message_stop
    // - result, error
    return null;
  } catch {
    // Not JSON - return as plain text (bash script output, etc.)
    return { type: "plain", text: line + "\n" };
  }
}

// Completion markers that signal iteration/loop completion
const COMPLETION_MARKERS = {
  TASK_COMPLETE: "<promise>TASK_COMPLETE</promise>",
  ALL_TASKS_COMPLETE: "<promise>ALL_TASKS_COMPLETE</promise>",
  // Legacy markers
  ITERATION_COMPLETE: "<promise>ITERATION_COMPLETE</promise>",
  ALL_SUITES_COMPLETE: "<promise>ALL_SUITES_COMPLETE</promise>",
};

// Exit codes from build-iteration.sh
export const BUILD_EXIT_CODES = {
  TASK_COMPLETE: 0,      // Task done, continue to next iteration
  ALL_COMPLETE: 10,      // All tasks done, stop looping
  ERROR: 1,              // Error occurred
} as const;

// Result from a single build iteration
export interface BuildIterationResult {
  exitCode: number;
  allComplete: boolean;
  taskComplete: boolean;
}

// Extended handle for build iterations (includes completion status)
export interface BuildIterationHandle extends InteractiveProcessHandle {
  /** Promise that resolves when iteration completes with result */
  result: Promise<BuildIterationResult>;
}

// Run a SINGLE build iteration with bidirectional communication
// TUI controls the loop and spawns this for each iteration
export function runBuildIteration(
  iteration: number,
  maxIterations: number,
  epicId?: string,
  skillOverride?: string,
): BuildIterationHandle {
  const scriptsDir = findScriptsDir();
  const iterationScript = path.join(scriptsDir, "build-iteration.sh");

  // Build args for single iteration
  const args = [
    "--iteration", String(iteration),
    "--max-iterations", String(maxIterations),
    "--streaming",
  ];

  if (epicId) {
    args.push("--epic", epicId);
  }

  if (skillOverride) {
    args.push("--skill", skillOverride);
  }

  // Use pipe for stdin to enable bidirectional communication
  const child = spawn("bash", [iterationScript, ...args], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  let eventCallback: ((event: ClaudeEvent) => void) | null = null;
  let dataCallback: ((data: DisplayOutput) => void) | null = null;
  let exitCallback: ((code: number) => void) | null = null;
  let buffer = "";
  let promptSent = false;
  let stdinClosed = false;
  let allComplete = false;
  let taskComplete = false;

  // Close stdin to signal Claude to exit
  const closeStdin = (): void => {
    if (!stdinClosed && child.stdin?.writable) {
      stdinClosed = true;
      child.stdin.end();
    }
  };

  // Check if output contains completion markers and close stdin if found
  const checkForCompletion = (text: string): void => {
    if (text.includes(COMPLETION_MARKERS.ALL_TASKS_COMPLETE) ||
        text.includes(COMPLETION_MARKERS.ALL_SUITES_COMPLETE)) {
      allComplete = true;
      taskComplete = true;
      closeStdin(); // Signal Claude to exit
    } else if (text.includes(COMPLETION_MARKERS.TASK_COMPLETE) ||
               text.includes(COMPLETION_MARKERS.ITERATION_COMPLETE)) {
      taskComplete = true;
      closeStdin(); // Signal Claude to exit
    }
  };

  // Promise for iteration result
  const resultPromise = new Promise<BuildIterationResult>((resolve) => {
    child.on("close", (code) => {
      const exitCode = code ?? 1;
      resolve({
        exitCode,
        allComplete: allComplete || exitCode === BUILD_EXIT_CODES.ALL_COMPLETE,
        taskComplete: taskComplete || exitCode === BUILD_EXIT_CODES.TASK_COMPLETE,
      });
    });
  });

  // Send prompt via stdin after spawn
  child.on("spawn", () => {
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
        // Prompt file not ready yet - will retry or fail gracefully
      }
    }, 200);
  });

  // Buffer and parse NDJSON
  child.stdout?.on("data", (data: Buffer) => {
    const chunk = data.toString();
    buffer += chunk;

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      const displayText = parseNdjsonLine(line);
      if (displayText && dataCallback) {
        dataCallback(displayText);
        checkForCompletion(displayText.text);
      }

      const event = parseClaudeEvent(line);
      if (event && eventCallback) {
        eventCallback(event);
      }
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    if (dataCallback) dataCallback({ type: "plain", text: data.toString() });
  });

  child.on("close", (code) => {
    if (buffer.trim()) {
      const displayText = parseNdjsonLine(buffer);
      if (displayText && dataCallback) {
        dataCallback(displayText);
        checkForCompletion(displayText.text);
      }
      const event = parseClaudeEvent(buffer);
      if (event && eventCallback) {
        eventCallback(event);
      }
    }
    if (exitCallback) exitCallback(code ?? 1);
  });

  child.on("error", (err) => {
    if (dataCallback) dataCallback({ type: "plain", text: `Error: ${err.message}\n` });
    if (eventCallback) {
      eventCallback({ type: "error", message: err.message });
    }
  });

  return {
    result: resultPromise,
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

// Run build script (old build.sh) for CLI usage - no TUI loop control
// This is kept for backwards compatibility with CLI commands
export function runBuild(args: string[], epicId?: string): ProcessHandle {
  const scriptsDir = findScriptsDir();
  const buildScript = path.join(scriptsDir, "build.sh");

  const filteredArgs = args.filter((a) => a !== "-i" && a !== "--interactive");
  const buildArgs = [...filteredArgs];

  if (epicId) {
    buildArgs.push("--epic", epicId);
  }

  const child = spawn("bash", [buildScript, ...buildArgs], {
    cwd: process.cwd(),
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
  });

  let dataCallback: ((data: DisplayOutput) => void) | null = null;
  let exitCallback: ((code: number) => void) | null = null;
  let buffer = "";

  child.stdout?.on("data", (data: Buffer) => {
    const chunk = data.toString();
    buffer += chunk;

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const displayText = parseNdjsonLine(line);
      if (displayText && dataCallback) {
        dataCallback(displayText);
      }
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    if (dataCallback) dataCallback({ type: "plain", text: data.toString() });
  });

  child.on("close", (code) => {
    if (buffer.trim()) {
      const displayOutput = parseNdjsonLine(buffer);
      if (displayOutput && dataCallback) {
        dataCallback(displayOutput);
      }
    }
    if (exitCallback) exitCallback(code ?? 1);
  });

  child.on("error", (err) => {
    if (dataCallback) dataCallback({ type: "plain", text: `Error: ${err.message}\n` });
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

  let dataCallback: ((data: DisplayOutput) => void) | null = null;
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
    if (dataCallback) dataCallback({ type: "plain", text: data.toString() });
  });

  child.on("close", (code) => {
    // Flush any remaining buffer
    if (buffer.trim()) {
      const displayOutput = parseNdjsonLine(buffer);
      if (displayOutput && dataCallback) {
        dataCallback(displayOutput);
      }
    }
    if (exitCallback) exitCallback(code ?? 1);
  });

  child.on("error", (err) => {
    if (dataCallback) dataCallback({ type: "plain", text: `Error: ${err.message}\n` });
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
  let dataCallback: ((data: DisplayOutput) => void) | null = null;
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
    if (dataCallback) dataCallback({ type: "plain", text: data.toString() });
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
    if (dataCallback) dataCallback({ type: "plain", text: `Error: ${err.message}\n` });
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

