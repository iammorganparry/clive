/**
 * LoadingSpinner Component
 * Animated loading indicator using OpenTUI timeline
 */

import { useState, useEffect } from 'react';
import { useTimeline } from '@opentui/react';
import { OneDarkPro } from '../styles/theme';

interface LoadingSpinnerProps {
  text?: string;
  color?: string;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function LoadingSpinner({
  text = 'Loading...',
  color = OneDarkPro.syntax.blue,
}: LoadingSpinnerProps) {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80); // 80ms per frame for smooth animation

    return () => clearInterval(interval);
  }, []);

  return (
    <box flexDirection="row" gap={1}>
      <text fg={color}>{SPINNER_FRAMES[frameIndex]}</text>
      <text fg={OneDarkPro.foreground.secondary}>{text}</text>
    </box>
  );
}

/**
 * PulsingDot Component
 * Pulsing dot indicator using timeline animation
 */
interface PulsingDotProps {
  color?: string;
}

export function PulsingDot({ color = OneDarkPro.syntax.blue }: PulsingDotProps) {
  const [opacity, setOpacity] = useState(1);

  const timeline = useTimeline({
    duration: 1000,
    loop: true,
    autoplay: true,
  });

  useEffect(() => {
    timeline.add(
      { opacity: 1 },
      {
        opacity: 0.3,
        duration: 500,
        ease: 'easeInOutSine',
        onUpdate: (animation) => {
          setOpacity(animation.targets[0].opacity);
        },
      },
      0
    );

    timeline.add(
      { opacity: 0.3 },
      {
        opacity: 1,
        duration: 500,
        ease: 'easeInOutSine',
        onUpdate: (animation) => {
          setOpacity(animation.targets[0].opacity);
        },
      },
      500
    );
  }, [timeline]);

  // Convert opacity to color intensity
  const intensityHex = Math.floor(opacity * 255).toString(16).padStart(2, '0');
  const fadedColor = color + intensityHex;

  return <text fg={fadedColor}>●</text>;
}

/**
 * LoadingBar Component
 * Animated progress bar using timeline
 */
interface LoadingBarProps {
  width?: number;
  color?: string;
}

export function LoadingBar({
  width = 20,
  color = OneDarkPro.syntax.blue,
}: LoadingBarProps) {
  const [progress, setProgress] = useState(0);

  const timeline = useTimeline({
    duration: 2000,
    loop: true,
    autoplay: true,
  });

  useEffect(() => {
    timeline.add(
      { progress: 0 },
      {
        progress: width,
        duration: 2000,
        ease: 'linear',
        onUpdate: (animation) => {
          setProgress(animation.targets[0].progress);
        },
      },
      0
    );
  }, [timeline, width]);

  const filledWidth = Math.floor(progress);
  const emptyWidth = width - filledWidth;

  return (
    <box flexDirection="row">
      <box
        width={filledWidth}
        height={1}
        backgroundColor={color}
      />
      <box
        width={emptyWidth}
        height={1}
        backgroundColor={OneDarkPro.background.secondary}
      />
    </box>
  );
}
