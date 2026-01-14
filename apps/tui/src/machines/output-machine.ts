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

// Structured event from build.sh streaming output
interface StreamEvent {
  type: "assistant" | "tool_use" | "tool_result";
  text?: string;
  name?: string;
  id?: string;
  content?: string;
}

// Try to parse a line as a structured JSON event from Claude CLI
function parseStreamEvent(line: string): StreamEvent | null {
  try {
    const event = JSON.parse(line) as StreamEvent;
    if (event.type && (event.type === "assistant" || event.type === "tool_use" || event.type === "tool_result")) {
      return event;
    }
  } catch {
    // Not JSON, ignore
  }
  return null;
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
          return createLine(`● ${streamEvent.name}`, "tool_call", { toolName: streamEvent.name });
        }
        if (streamEvent.type === "tool_result") {
          // Show truncated content if available
          const content = streamEvent.content
            ? streamEvent.content.slice(0, 100).replace(/\n/g, " ") + (streamEvent.content.length > 100 ? "..." : "")
            : "Done";
          return createLine(`└ ${content}`, "tool_result", { indent: 1 });
        }
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
    });
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
