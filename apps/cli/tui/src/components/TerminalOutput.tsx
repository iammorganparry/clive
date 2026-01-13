import React, { memo } from 'react';
import { Box, Text, useInput, useFocus } from 'ink';
import { useTheme } from '../theme.js';
import type { OutputLine } from '../types.js';
import type { PtyProcessHandle } from '../utils/process.js';

interface TerminalOutputProps {
  lines: OutputLine[];
  maxLines?: number;
  ptyHandle?: PtyProcessHandle | null;
}

export const TerminalOutput: React.FC<TerminalOutputProps> = memo(({
  lines,
  maxLines = 50,
  ptyHandle,
}) => {
  const theme = useTheme();
  const { isFocused } = useFocus({ id: 'terminal-output' });

  // Forward all keyboard input to PTY when focused and PTY is active
  useInput((input, key) => {
    if (!isFocused || !ptyHandle) return;

    // Handle special keys
    if (key.return) {
      ptyHandle.write('\r');
    } else if (key.backspace || key.delete) {
      ptyHandle.write('\x7f'); // DEL character
    } else if (key.escape) {
      ptyHandle.write('\x1b'); // ESC character
    } else if (key.upArrow) {
      ptyHandle.write('\x1b[A');
    } else if (key.downArrow) {
      ptyHandle.write('\x1b[B');
    } else if (key.rightArrow) {
      ptyHandle.write('\x1b[C');
    } else if (key.leftArrow) {
      ptyHandle.write('\x1b[D');
    } else if (key.tab) {
      ptyHandle.write('\t');
    } else if (key.ctrl && input) {
      // Ctrl+C, Ctrl+D, etc.
      const charCode = input.charCodeAt(0) - 96; // 'a' = 1, 'b' = 2, etc.
      if (charCode > 0 && charCode < 27) {
        ptyHandle.write(String.fromCharCode(charCode));
      }
    } else if (input) {
      // Regular characters
      ptyHandle.write(input);
    }
  }, { isActive: isFocused && !!ptyHandle });

  // Show only the last N lines
  const visibleLines = lines.slice(-maxLines);

  const getLineColor = (line: OutputLine): string => {
    if (line.type === 'stderr') return theme.syntax.red;
    if (line.type === 'system') return theme.syntax.cyan;
    if (line.type === 'marker') return theme.syntax.magenta;

    // Highlight specific patterns
    if (line.text.includes('PASS')) return theme.syntax.green;
    if (line.text.includes('FAIL')) return theme.syntax.red;
    if (line.text.includes('<promise>')) return theme.syntax.magenta;
    if (line.text.includes('✓')) return theme.syntax.green;
    if (line.text.includes('✗')) return theme.syntax.red;
    if (line.text.startsWith('>')) return theme.syntax.yellow;

    return theme.fg.primary;
  };

  const isInteractive = isFocused && !!ptyHandle;

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="round"
      borderColor={isInteractive ? theme.syntax.green : isFocused ? theme.syntax.blue : theme.ui.border}
      paddingX={1}
      overflow="hidden"
    >
      <Box marginBottom={1}>
        <Text bold color={theme.syntax.magenta}>TERMINAL OUTPUT</Text>
        {isInteractive && <Text color={theme.syntax.green}> [INTERACTIVE]</Text>}
        {isFocused && !ptyHandle && <Text color={theme.fg.muted}> (focused)</Text>}
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {visibleLines.length === 0 ? (
          <Text color={theme.fg.muted}>No output yet. Use /build or press <Text color={theme.syntax.yellow}>b</Text> to start.</Text>
        ) : (
          visibleLines.map(line => (
            <Text
              key={line.id}
              color={getLineColor(line)}
              backgroundColor={line.type === 'marker' ? theme.bg.highlight : undefined}
              wrap="truncate"
            >
              {line.text}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
});

TerminalOutput.displayName = 'TerminalOutput';
