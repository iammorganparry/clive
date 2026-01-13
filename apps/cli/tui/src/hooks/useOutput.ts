import { useState, useCallback } from 'react';
import type { OutputLine } from '../types.js';

let lineIdCounter = 0;

export function useOutput() {
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const appendOutput = useCallback((text: string, type: OutputLine['type'] = 'stdout') => {
    // Split by newlines and add each line
    const newLines = text.split('\n').filter(line => line.length > 0);

    setLines(prev => [
      ...prev,
      ...newLines.map(line => ({
        id: `line-${++lineIdCounter}`,
        text: line,
        type: line.includes('<promise>') ? 'marker' as const : type,
        timestamp: new Date(),
      })),
    ]);
  }, []);

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
