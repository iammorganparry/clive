import React, { memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme.js';
import type { OutputLine } from '../types.js';

interface TerminalOutputProps {
  lines: OutputLine[];
  maxLines?: number;
}

export const TerminalOutput: React.FC<TerminalOutputProps> = memo(({
  lines,
  maxLines = 50,
}) => {
  const theme = useTheme();

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

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="round"
      borderColor={theme.ui.border}
      paddingX={1}
      overflow="hidden"
    >
      <Box marginBottom={1}>
        <Text bold color={theme.syntax.magenta}>TERMINAL OUTPUT</Text>
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
