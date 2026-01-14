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

// Check if a line looks like JSON (starts with { and ends with })
// Used to filter any raw JSON that slips through from process.ts
function isJsonLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}");
}

// Parse text into typed OutputLines
// Note: JSON parsing is handled by process.ts - this receives pre-formatted text
function parseLines(
  text: string,
  type: OutputLine["type"] = "stdout",
): OutputLine[] {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      // Filter any raw JSON that slips through (internal Claude events)
      if (isJsonLine(line)) {
        return null;
      }

      // Pattern matching for formatted output from process.ts
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

      // Detect agent text responses (natural language from Claude)
      // These come through as stdout but should be styled as assistant messages
      if (type === "stdout") {
        const trimmed = line.trim();
        // Agent text typically:
        // - Starts with capital letter or "I'll" / "Let me"
        // - Is not a path, separator, or code output
        // - Has meaningful length
        const looksLikeAgentText =
          ((/^[A-Z]/.test(trimmed) && trimmed.length > 15) || // Sentence starting with capital
            /^(I'll|Let me|I'm |I am |I will |Now |First|Next|Here|This|The |Looking|Reading|Checking)/.test(trimmed)) &&
          !trimmed.startsWith("/") && // Not a path
          !trimmed.startsWith("●") && // Not a tool indicator
          !trimmed.startsWith("⚡") && // Not a tool indicator
          !trimmed.includes("===") && // Not a separator
          !trimmed.includes("---") && // Not a separator
          !/^\d+[→│|:]/.test(trimmed) && // Not line numbers
          !/^(PASS|FAIL|Error|Warning)/.test(trimmed); // Not test output

        if (looksLikeAgentText) {
          return createLine(line, "assistant");
        }
      }

      // Default to the provided type (stdout/stderr/system)
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
