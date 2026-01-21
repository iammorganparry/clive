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
        <text fg={OneDarkPro.syntax.cyan}>{'> '}</text>
        <input
          placeholder={disabled ? 'Waiting for response...' : 'Enter command (or /help)'}
          focused={!disabled}
          onInput={setInput}
          onSubmit={handleSubmit}
          style={{
            width: width - 4,
            fg: OneDarkPro.foreground.primary,
          }}
        />
      </box>
    </box>
  );
}
