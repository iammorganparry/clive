import React, { useState, useEffect } from 'react';
import { Text } from 'ink';
import { useTheme } from '../theme.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface SpinnerProps {
  label?: string;
  elapsed?: number; // seconds
}

export const Spinner: React.FC<SpinnerProps> = ({ label = 'Working', elapsed }) => {
  const theme = useTheme();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <Text>
      <Text color={theme.syntax.yellow}>{FRAMES[frame]} </Text>
      <Text color={theme.syntax.cyan}>{label}…</Text>
      {elapsed !== undefined && elapsed > 0 && (
        <Text color={theme.fg.muted}> · {formatTime(elapsed)}</Text>
      )}
    </Text>
  );
};
