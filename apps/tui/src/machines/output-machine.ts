import { setup, assign, fromCallback } from 'xstate';
import type { OutputLine } from '../types.js';

let lineIdCounter = 0;

interface LineOptions {
  toolName?: string;
  indent?: number;
}

function createLine(
  text: string,
  type: OutputLine['type'],
  options: LineOptions = {}
): OutputLine {
  return {
    id: `line-${++lineIdCounter}`,
    text,
    type,
    timestamp: new Date(),
    ...options,
  };
}

// Tool names to detect
const TOOL_NAMES = [
  'Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Task', 'WebFetch',
  'WebSearch', 'TodoWrite', 'AskUserQuestion', 'NotebookEdit', 'Skill',
];

const TOOL_CALL_PATTERN = new RegExp(
  `^[●◆⏺▶→]\\s*(${TOOL_NAMES.join('|')})\\b`,
  'i'
);
const TOOL_RESULT_PATTERN = /^[└→┃│]\s/;
const USER_INPUT_PATTERN = /^[❯>]\s/;

// Parse text into typed OutputLines
function parseLines(text: string, type: OutputLine['type'] = 'stdout'): OutputLine[] {
  return text.split('\n')
    .filter(line => line.length > 0)
    .map(line => {
      if (line.includes('<promise>')) {
        return createLine(line, 'marker');
      }

      const toolMatch = line.match(TOOL_CALL_PATTERN);
      if (toolMatch) {
        return createLine(line, 'tool_call', { toolName: toolMatch[1] });
      }

      if (TOOL_RESULT_PATTERN.test(line)) {
        return createLine(line, 'tool_result', { indent: 1 });
      }

      if (USER_INPUT_PATTERN.test(line)) {
        return createLine(line, 'user_input');
      }

      return createLine(line, type);
    });
}

// Initial welcome messages
const WELCOME_LINES: OutputLine[] = [
  createLine('Welcome to CLIVE - AI-Powered Work Execution', 'system'),
  createLine('Press ? for keyboard shortcuts, n for new plan', 'system'),
  createLine('', 'system'),
];

// Machine context
export interface OutputContext {
  lines: OutputLine[];
  pendingLines: OutputLine[];
  isRunning: boolean;
  startTime: number | null;
}

// Machine events
export type OutputEvent =
  | { type: 'APPEND_OUTPUT'; text: string; outputType?: OutputLine['type'] }
  | { type: 'APPEND_SYSTEM'; text: string }
  | { type: 'FLUSH_PENDING' }
  | { type: 'START_RUNNING' }
  | { type: 'STOP_RUNNING' }
  | { type: 'CLEAR' };

// Batching actor - flushes pending lines every 50ms
const batchingActor = fromCallback<{ type: 'FLUSH' }, void>(({ sendBack }) => {
  const timer = setInterval(() => {
    sendBack({ type: 'FLUSH' });
  }, 50);

  return () => clearInterval(timer);
});

export const outputMachine = setup({
  types: {
    context: {} as OutputContext,
    events: {} as OutputEvent,
  },
  actors: {
    batching: batchingActor,
  },
  actions: {
    appendLines: assign(({ context, event }) => {
      if (event.type !== 'APPEND_OUTPUT') return {};
      const newLines = parseLines(event.text, event.outputType ?? 'stdout');
      return {
        pendingLines: [...context.pendingLines, ...newLines],
      };
    }),
    appendSystemLines: assign(({ context, event }) => {
      if (event.type !== 'APPEND_SYSTEM') return {};
      const newLines = parseLines(event.text, 'system');
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
  },
}).createMachine({
  id: 'output',
  initial: 'idle',
  context: {
    lines: [...WELCOME_LINES],
    pendingLines: [],
    isRunning: false,
    startTime: null,
  },
  // Always invoke batching actor for flushing pending lines
  invoke: {
    id: 'batching',
    src: 'batching',
  },
  on: {
    // These events are handled globally regardless of state
    APPEND_OUTPUT: {
      actions: 'appendLines',
    },
    APPEND_SYSTEM: {
      actions: 'appendSystemLines',
    },
    FLUSH: {
      actions: 'flushPending',
    },
    CLEAR: {
      actions: 'clearLines',
    },
  },
  states: {
    idle: {
      on: {
        START_RUNNING: {
          target: 'running',
          actions: 'startRunning',
        },
      },
    },
    running: {
      on: {
        STOP_RUNNING: {
          target: 'idle',
          actions: 'stopRunning',
        },
      },
    },
  },
});

export type OutputMachine = typeof outputMachine;
