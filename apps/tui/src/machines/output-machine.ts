import { assign, fromCallback, setup } from "xstate";
import type { OutputLine } from "../types.js";
import type { AgentQuestion } from "../utils/claude-events.js";

let lineIdCounter = 0;

interface LineOptions {
  toolName?: string;
  indent?: number;
}

function createLine(
  text: string,
  type: OutputLine["type"],
  options: LineOptions = {},
): OutputLine {
  return {
    id: `line-${++lineIdCounter}`,
    text,
    type,
    timestamp: new Date(),
    ...options,
  };
}

// Pending interaction types
export interface PendingQuestion {
  type: "question";
  id: string;
  questions: AgentQuestion[];
}

export interface PendingApproval {
  type: "approval";
  id: string;
  toolName: string;
  args: unknown;
}

export type PendingInteraction = PendingQuestion | PendingApproval;

// Tool names to detect
const TOOL_NAMES = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "Task",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "AskUserQuestion",
  "NotebookEdit",
  "Skill",
];

const TOOL_CALL_PATTERN = new RegExp(
  `^[●◆⏺▶→]\\s*(${TOOL_NAMES.join("|")})\\b`,
  "i",
);
const TOOL_RESULT_PATTERN = /^[└→┃│]\s/;
const USER_INPUT_PATTERN = /^[❯>]\s/;

// Parsed event for display
interface ParsedEvent {
  type: "assistant" | "tool_use" | "tool_result";
  text?: string;
  name?: string;
  id?: string;
  content?: string;
  input?: Record<string, unknown>;
}

// Format tool input for display
function formatToolInput(name: string, input?: Record<string, unknown>): string {
  if (!input) return name;

  // Extract key metadata based on tool type
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
      if (input.file_path) return `${name} ${input.file_path}`;
      break;
    case "Glob":
      if (input.pattern) return `${name} ${input.pattern}`;
      break;
    case "Grep":
      if (input.pattern) return `${name} "${input.pattern}"`;
      break;
    case "Bash":
      if (input.command) {
        const cmd = String(input.command).slice(0, 60);
        return `${name} ${cmd}${String(input.command).length > 60 ? "..." : ""}`;
      }
      break;
    case "Task":
      if (input.description) return `${name} ${input.description}`;
      break;
    case "WebFetch":
    case "WebSearch":
      if (input.url) return `${name} ${input.url}`;
      if (input.query) return `${name} "${input.query}"`;
      break;
  }

  return name;
}

// Try to parse a line as raw Claude NDJSON event
// Returns ParsedEvent if it should be displayed, null if it should be filtered
function parseStreamEvent(line: string): ParsedEvent | null {
  try {
    const raw = JSON.parse(line);

    // Handle pre-processed events (backwards compatibility)
    if (raw.type === "assistant" && typeof raw.text === "string") {
      return raw as ParsedEvent;
    }
    if (raw.type === "tool_use" && raw.name) {
      return raw as ParsedEvent;
    }
    if (raw.type === "tool_result" && raw.id) {
      return raw as ParsedEvent;
    }

    // Handle raw Claude NDJSON events
    if (raw.type === "content_block_delta" && raw.delta?.type === "text_delta") {
      return { type: "assistant", text: raw.delta.text };
    }

    if (raw.type === "content_block_start" && raw.content_block?.type === "text") {
      return { type: "assistant", text: raw.content_block.text || "" };
    }

    if (raw.type === "content_block_start" && raw.content_block?.type === "tool_use") {
      return {
        type: "tool_use",
        name: raw.content_block.name,
        id: raw.content_block.id,
        input: raw.content_block.input,
      };
    }

    // Handle message-level events
    if (raw.type === "assistant" && raw.message?.content) {
      for (const block of raw.message.content) {
        if (block.type === "text") {
          return { type: "assistant", text: block.text };
        }
        if (block.type === "tool_use") {
          return {
            type: "tool_use",
            name: block.name,
            id: block.id,
            input: block.input,
          };
        }
      }
      // Handled but no displayable content
      return null;
    }

    // User messages with tool results - filter these out (internal event)
    // These are echoed back from Claude and shouldn't be displayed
    if (raw.type === "user") {
      return null;
    }

    // System events - filter out
    if (raw.type === "system") {
      return null;
    }

    // Message lifecycle events - filter out
    if (raw.type === "message_start" || raw.type === "message_delta" ||
        raw.type === "message_stop" || raw.type === "content_block_stop" ||
        raw.type === "result" || raw.type === "error") {
      return null;
    }

    // Any other JSON event - filter out (don't display raw JSON)
    return null;
  } catch {
    // Not JSON, return null to let pattern matching handle it
    return null;
  }
}

// Check if a line looks like JSON (starts with { and ends with })
function isJsonLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}");
}

// Parse text into typed OutputLines
function parseLines(
  text: string,
  type: OutputLine["type"] = "stdout",
): OutputLine[] {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      // First, try to parse as structured JSON event from Claude CLI
      const streamEvent = parseStreamEvent(line);
      if (streamEvent) {
        if (streamEvent.type === "assistant" && streamEvent.text) {
          return createLine(streamEvent.text, "assistant");
        }
        if (streamEvent.type === "tool_use" && streamEvent.name) {
          const displayText = formatToolInput(streamEvent.name, streamEvent.input);
          return createLine(`● ${displayText}`, "tool_call", { toolName: streamEvent.name });
        }
        if (streamEvent.type === "tool_result") {
          // Show truncated content if available
          const content = streamEvent.content
            ? streamEvent.content.slice(0, 100).replace(/\n/g, " ") + (streamEvent.content.length > 100 ? "..." : "")
            : "Done";
          return createLine(`└ ${content}`, "tool_result", { indent: 1 });
        }
      }

      // If it looks like JSON but wasn't handled, skip it (internal Claude events)
      if (isJsonLine(line)) {
        return null;
      }

      // Fall back to pattern matching for non-JSON output
      if (line.includes("<promise>")) {
        return createLine(line, "marker");
      }

      const toolMatch = line.match(TOOL_CALL_PATTERN);
      if (toolMatch) {
        return createLine(line, "tool_call", { toolName: toolMatch[1] });
      }

      if (TOOL_RESULT_PATTERN.test(line)) {
        return createLine(line, "tool_result", { indent: 1 });
      }

      if (USER_INPUT_PATTERN.test(line)) {
        return createLine(line, "user_input");
      }

      return createLine(line, type);
    })
    .filter((line): line is OutputLine => line !== null);
}

// Initial welcome messages
const WELCOME_LINES: OutputLine[] = [
  createLine("Welcome to CLIVE - AI-Powered Work Execution", "system"),
  createLine("Press ? for keyboard shortcuts, n for new plan", "system"),
  createLine("", "system"),
];

// Machine context
export interface OutputContext {
  lines: OutputLine[];
  pendingLines: OutputLine[];
  isRunning: boolean;
  startTime: number | null;
  pendingInteraction: PendingInteraction | null;
}

// Machine events (external)
export type OutputEvent =
  | { type: "APPEND_OUTPUT"; text: string; outputType?: OutputLine["type"] }
  | { type: "APPEND_SYSTEM"; text: string }
  | { type: "FLUSH_PENDING" }
  | { type: "START_RUNNING" }
  | { type: "STOP_RUNNING" }
  | { type: "CLEAR" }
  | { type: "QUESTION_RECEIVED"; id: string; questions: AgentQuestion[] }
  | { type: "APPROVAL_REQUESTED"; id: string; toolName: string; args: unknown }
  | { type: "INTERACTION_RESOLVED" };

// Internal events (from actors)
type InternalEvent = { type: "FLUSH" };

// Combined events for machine
type AllEvents = OutputEvent | InternalEvent;

// Batching actor - flushes pending lines every 50ms
const batchingActor = fromCallback<InternalEvent, void>(({ sendBack }) => {
  const timer = setInterval(() => {
    sendBack({ type: "FLUSH" });
  }, 50);

  return () => clearInterval(timer);
});

export const outputMachine = setup({
  types: {
    context: {} as OutputContext,
    events: {} as AllEvents,
  },
  actors: {
    batching: batchingActor,
  },
  actions: {
    appendLines: assign(({ context, event }) => {
      if (event.type !== "APPEND_OUTPUT") return {};
      const newLines = parseLines(event.text, event.outputType ?? "stdout");
      return {
        pendingLines: [...context.pendingLines, ...newLines],
      };
    }),
    appendSystemLines: assign(({ context, event }) => {
      if (event.type !== "APPEND_SYSTEM") return {};
      const newLines = parseLines(event.text, "system");
      return {
        pendingLines: [...context.pendingLines, ...newLines],
      };
    }),
    flushPending: assign(({ context }) => {
      if (context.pendingLines.length === 0) return {};
      return {
        lines: [...context.lines, ...context.pendingLines],
        pendingLines: [],
      };
    }),
    startRunning: assign({
      isRunning: true,
      startTime: () => Date.now(),
    }),
    stopRunning: assign({
      isRunning: false,
      startTime: null,
    }),
    clearLines: assign({
      lines: [],
      pendingLines: [],
    }),
    setQuestion: assign(({ event }) => {
      if (event.type !== "QUESTION_RECEIVED") return {};
      return {
        pendingInteraction: {
          type: "question" as const,
          id: event.id,
          questions: event.questions,
        },
      };
    }),
    setApproval: assign(({ event }) => {
      if (event.type !== "APPROVAL_REQUESTED") return {};
      return {
        pendingInteraction: {
          type: "approval" as const,
          id: event.id,
          toolName: event.toolName,
          args: event.args,
        },
      };
    }),
    clearInteraction: assign({
      pendingInteraction: null,
    }),
  },
}).createMachine({
  id: "output",
  initial: "idle",
  context: {
    lines: [...WELCOME_LINES],
    pendingLines: [],
    isRunning: false,
    startTime: null,
    pendingInteraction: null,
  },
  // Always invoke batching actor for flushing pending lines
  invoke: {
    id: "batching",
    src: "batching",
  },
  on: {
    // These events are handled globally regardless of state
    APPEND_OUTPUT: {
      actions: "appendLines",
    },
    APPEND_SYSTEM: {
      actions: "appendSystemLines",
    },
    FLUSH: {
      actions: "flushPending",
    },
    CLEAR: {
      actions: "clearLines",
    },
    QUESTION_RECEIVED: {
      actions: "setQuestion",
    },
    APPROVAL_REQUESTED: {
      actions: "setApproval",
    },
    INTERACTION_RESOLVED: {
      actions: "clearInteraction",
    },
  },
  states: {
    idle: {
      on: {
        START_RUNNING: {
          target: "running",
          actions: "startRunning",
        },
      },
    },
    running: {
      on: {
        STOP_RUNNING: {
          target: "idle",
          actions: "stopRunning",
        },
      },
    },
  },
});

export type OutputMachine = typeof outputMachine;
