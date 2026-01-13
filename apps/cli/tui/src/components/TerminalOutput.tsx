import React from 'react';
import { Box, Text } from 'ink';
import type { OutputLine } from '../types.js';

interface TerminalOutputProps {
  lines: OutputLine[];
  maxLines?: number;
}

export const TerminalOutput: React.FC<TerminalOutputProps> = ({
  lines,
  maxLines = 50,
}) => {
  // Show only the last N lines
  const visibleLines = lines.slice(-maxLines);

  const getLineColor = (line: OutputLine): string => {
    if (line.type === 'stderr') return 'red';
    if (line.type === 'system') return 'cyan';
    if (line.type === 'marker') return 'green';

    // Highlight specific patterns
    if (line.text.includes('PASS')) return 'green';
    if (line.text.includes('FAIL')) return 'red';
    if (line.text.includes('<promise>')) return 'magenta';
    if (line.text.includes('✓')) return 'green';
    if (line.text.includes('✗')) return 'red';
    if (line.text.startsWith('>')) return 'yellow';

    return 'white';
  };

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="single"
      paddingX={1}
      overflow="hidden"
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">TERMINAL OUTPUT</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {visibleLines.length === 0 ? (
          <Text color="gray">No output yet. Use /build to start.</Text>
        ) : (
          visibleLines.map(line => (
            <Text key={line.id} color={getLineColor(line) as Parameters<typeof Text>[0]['color']} wrap="truncate">
              {line.text}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
};
