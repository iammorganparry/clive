import { useEffect, useState } from "react";

const MAX_HISTORY = 50;
const STORAGE_KEY = "clive-command-history";

export function useCommandHistory() {
  const [history, setHistory] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setHistory(parsed);
          setIndex(parsed.length);
        }
      }
    } catch (e) {
      console.error("Failed to load command history:", e);
    }
  }, []);

  const add = (command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return;

    // Don't add duplicates of last command
    if (history.length > 0 && history[history.length - 1] === trimmed) {
      setIndex(history.length);
      return;
    }

    const newHistory = [...history, trimmed].slice(-MAX_HISTORY);
    setHistory(newHistory);
    setIndex(newHistory.length);

    // Persist to localStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
    } catch (e) {
      console.error("Failed to save command history:", e);
    }
  };

  const getPrevious = (): string | null => {
    if (history.length === 0) return null;
    if (index <= 0) return history[0] || null;
    const newIndex = index - 1;
    setIndex(newIndex);
    return history[newIndex] || null;
  };

  const getNext = (): string | null => {
    if (history.length === 0) return null;
    if (index >= history.length - 1) {
      setIndex(history.length);
      return null;
    }
    const newIndex = index + 1;
    setIndex(newIndex);
    return newIndex < history.length ? history[newIndex] || null : null;
  };

  const reset = () => {
    setIndex(history.length);
  };

  return {
    history,
    index,
    add,
    getPrevious,
    getNext,
    reset,
  };
}
