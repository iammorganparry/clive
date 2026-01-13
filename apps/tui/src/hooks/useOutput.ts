import { useState, useCallback, useRef, useEffect } from 'react';
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

// Patterns for detecting message types
const TOOL_CALL_PATTERN = new RegExp(
  `^[●◆⏺▶→]\\s*(${TOOL_NAMES.join('|')})\\b`,
  'i'
);
const TOOL_RESULT_PATTERN = /^[└→┃│]\s/;
const USER_INPUT_PATTERN = /^[❯>]\s/;

// Initial welcome messages (shown once on startup)
const WELCOME_LINES: OutputLine[] = [
  createLine('Welcome to CLIVE - AI-Powered Work Execution', 'system'),
  createLine('Press ? for keyboard shortcuts, n for new plan', 'system'),
  createLine('', 'system'),
];

export function useOutput() {
  // Initialize with welcome messages (lazy initial state - runs once)
  const [lines, setLines] = useState<OutputLine[]>(() => [...WELCOME_LINES]);
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Batching refs for output updates
  const pendingLinesRef = useRef<OutputLine[]>([]);
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // Timer for elapsed time while streaming
  useEffect(() => {
    if (!isRunning) {
      startTimeRef.current = null;
      setElapsedSeconds(0);
      return;
    }

    startTimeRef.current = Date.now();
    const timer = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [isRunning]);

  const flushPending = useCallback(() => {
    if (pendingLinesRef.current.length > 0) {
      const linesToAdd = pendingLinesRef.current;
      pendingLinesRef.current = [];
      setLines(prev => [...prev, ...linesToAdd]);
    }
    flushTimeoutRef.current = null;
  }, []);

  const appendOutput = useCallback((text: string, type: OutputLine['type'] = 'stdout') => {
    // Split by newlines and create line objects with enhanced type detection
    const newLines = text.split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        // Check for promise markers
        if (line.includes('<promise>')) {
          return createLine(line, 'marker');
        }

        // Detect tool calls (● Read, ● Bash, etc.)
        const toolMatch = line.match(TOOL_CALL_PATTERN);
        if (toolMatch) {
          return createLine(line, 'tool_call', { toolName: toolMatch[1] });
        }

        // Detect tool results (└ result text, → result text)
        if (TOOL_RESULT_PATTERN.test(line)) {
          return createLine(line, 'tool_result', { indent: 1 });
        }

        // Detect user input (❯ command)
        if (USER_INPUT_PATTERN.test(line)) {
          return createLine(line, 'user_input');
        }

        return createLine(line, type);
      });

    // Add to pending batch
    pendingLinesRef.current.push(...newLines);

    // Batch updates: flush after 50ms of quiet to reduce render frequency
    if (!flushTimeoutRef.current) {
      flushTimeoutRef.current = setTimeout(flushPending, 50);
    }
  }, [flushPending]);

  const appendSystemMessage = useCallback((text: string) => {
    appendOutput(text, 'system');
  }, [appendOutput]);

  const clear = useCallback(() => {
    setLines([]);
  }, []);

  return {
    lines,
    isRunning,
    setIsRunning,
    elapsedSeconds,
    appendOutput,
    appendSystemMessage,
    clear,
  };
}
