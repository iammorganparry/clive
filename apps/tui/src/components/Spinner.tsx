import { Text } from "ink";
import type React from "react";
import { memo, useEffect, useState } from "react";
import { useTheme } from "../theme.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface SpinnerProps {
  label?: string;
  startTime?: number | null; // Timestamp when started - Spinner manages its own elapsed time
}

export const Spinner: React.FC<SpinnerProps> = memo(
  ({ label = "Working", startTime }) => {
    const theme = useTheme();
    const [frame, setFrame] = useState(0);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);

    // Animation timer
    useEffect(() => {
      const timer = setInterval(() => {
        setFrame((f) => (f + 1) % FRAMES.length);
      }, 80);
      return () => clearInterval(timer);
    }, []);

    // Elapsed time timer - ISOLATED here, no parent re-renders
    useEffect(() => {
      if (!startTime) {
        setElapsedSeconds(0);
        return;
      }

      const updateElapsed = () => {
        setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
      };

      updateElapsed(); // Initial sync
      const timer = setInterval(updateElapsed, 1000);
      return () => clearInterval(timer);
    }, [startTime]);

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
        {elapsedSeconds > 0 && (
          <Text color={theme.fg.muted}> · {formatTime(elapsedSeconds)}</Text>
        )}
      </Text>
    );
  },
);

Spinner.displayName = "Spinner";
