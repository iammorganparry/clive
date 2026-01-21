/**
 * InputBar Component
 * Command input field at bottom of screen
 */

import { useState } from 'react';
import { OneDarkPro } from '../styles/theme';

interface InputBarProps {
  width: number;
  height: number;
  y: number;
  onSubmit: (command: string) => void;
  disabled?: boolean;
}

export function InputBar({ width, height, y, onSubmit, disabled = false }: InputBarProps) {
  const [input, setInput] = useState('');

  const handleSubmit = () => {
    if (input.trim() && !disabled) {
      onSubmit(input);
      setInput('');
    }
  };

  return (
    <box
      y={y}
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.secondary}
      // borderStyle causes Bun FFI crash - removed
      // borderColor={OneDarkPro.ui.border}
      padding={1}
    >
      <box flexDirection="row">
        <text color={OneDarkPro.syntax.cyan}>{'> '}</text>
        <input
          value={input}
          onChange={(value: string) => setInput(value)}
          onSubmit={handleSubmit}
          placeholder={disabled ? 'Waiting for response...' : 'Enter command (or /help)'}
          focus={!disabled}
          width={width - 4}
          color={OneDarkPro.foreground.primary}
        />
      </box>
    </box>
  );
}
