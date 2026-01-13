import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface CommandInputProps {
  onSubmit: (command: string) => void;
  isFocused?: boolean;
}

export const CommandInput: React.FC<CommandInputProps> = ({
  onSubmit,
  isFocused = true,
}) => {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  useInput((input, key) => {
    if (!isFocused) return;

    // Navigate history with up/down
    if (key.upArrow && history.length > 0) {
      const newIndex = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(newIndex);
      setValue(history[history.length - 1 - newIndex] || '');
    }
    if (key.downArrow && historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setValue(history[history.length - 1 - newIndex] || '');
    }
    if (key.downArrow && historyIndex === 0) {
      setHistoryIndex(-1);
      setValue('');
    }

    // Clear on escape
    if (key.escape) {
      setValue('');
      setHistoryIndex(-1);
    }
  });

  const handleSubmit = (submittedValue: string) => {
    const trimmed = submittedValue.trim();
    if (trimmed) {
      // Add to history
      setHistory(prev => [...prev, trimmed]);
      setHistoryIndex(-1);

      // Auto-add slash if missing
      const command = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
      onSubmit(command);
      setValue('');
    }
  };

  return (
    <Box borderStyle="single" borderTop={false} borderBottom={false} paddingX={1}>
      <Text color="cyan" bold>&gt; </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        placeholder="Type /help for commands..."
      />
    </Box>
  );
};
