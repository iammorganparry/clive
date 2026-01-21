/**
 * LoadingIndicator Component
 * Shows an animated loading indicator when the agent is processing
 */

import { useState, useEffect } from 'react';
import { OneDarkPro } from '../styles/theme';

interface LoadingIndicatorProps {
  text?: string;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function LoadingIndicator({ text = 'Agent is thinking' }: LoadingIndicatorProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);

    return () => clearInterval(interval);
  }, []);

  return (
    <box paddingLeft={2} paddingY={1}>
      <text fg={OneDarkPro.syntax.cyan}>
        {SPINNER_FRAMES[frame]} {text}...
      </text>
    </box>
  );
}
