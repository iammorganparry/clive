/**
 * InputBar Component
 * Command input field at bottom of screen
 */

import { useState, useEffect } from 'react';
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

  // Enable bracketed paste mode for copy/paste support
  useEffect(() => {
    if (!process.stdout.isTTY) return;

    // Enable bracketed paste mode
    process.stdout.write('\x1b[?2004h');

    return () => {
      if (process.stdout.isTTY) {
        process.stdout.write('\x1b[?2004l');
      }
    };
  }, []);

  // Handle paste events
  useEffect(() => {
    if (disabled) return;

    let pasteBuffer = '';
    let inPasteMode = false;

    const handleData = (data: Buffer) => {
      const str = data.toString();

      // Detect bracketed paste start
      if (str.includes('\x1b[200~')) {
        inPasteMode = true;
        pasteBuffer = '';
        return;
      }

      // Detect bracketed paste end
      if (str.includes('\x1b[201~')) {
        inPasteMode = false;
        if (pasteBuffer) {
          setInput((prev) => prev + pasteBuffer);
        }
        pasteBuffer = '';
        return;
      }

      // Accumulate paste buffer
      if (inPasteMode) {
        pasteBuffer += str;
      }
    };

    process.stdin.on('data', handleData);

    return () => {
      process.stdin.removeListener('data', handleData);
    };
  }, [disabled]);

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
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
    >
      <box flexDirection="row">
        <text fg={OneDarkPro.syntax.cyan}>{'> '}</text>
        <input
          placeholder={disabled ? 'Waiting for response...' : 'Enter command (or /help)'}
          focused={!disabled}
          onInput={setInput}
          onSubmit={handleSubmit}
          value={input}
          style={{
            width: width - 4,
            fg: OneDarkPro.foreground.primary,
            backgroundColor: OneDarkPro.background.secondary,
            focusedBackgroundColor: OneDarkPro.background.secondary,
          }}
        />
      </box>
    </box>
  );
}
