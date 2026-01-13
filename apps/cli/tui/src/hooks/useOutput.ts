import { useState, useCallback, useRef } from 'react';
import type { OutputLine } from '../types.js';

let lineIdCounter = 0;

function createLine(text: string, type: OutputLine['type']): OutputLine {
  return {
    id: `line-${++lineIdCounter}`,
    text,
    type,
    timestamp: new Date(),
  };
}

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

  // Batching refs for output updates
  const pendingLinesRef = useRef<OutputLine[]>([]);
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPending = useCallback(() => {
    if (pendingLinesRef.current.length > 0) {
      const linesToAdd = pendingLinesRef.current;
      pendingLinesRef.current = [];
      setLines(prev => [...prev, ...linesToAdd]);
    }
    flushTimeoutRef.current = null;
  }, []);

  const appendOutput = useCallback((text: string, type: OutputLine['type'] = 'stdout') => {
    // Split by newlines and create line objects
    const newLines = text.split('\n')
      .filter(line => line.length > 0)
      .map(line => createLine(
        line,
        line.includes('<promise>') ? 'marker' : type
      ));

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
    appendOutput,
    appendSystemMessage,
    clear,
  };
}
