import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme.js';

export const Header: React.FC = () => {
  const theme = useTheme();

  return (
    <Box paddingX={1} gap={2}>
      <Text bold>
        <Text color={theme.syntax.cyan}>C</Text>
        <Text color={theme.syntax.blue}>L</Text>
        <Text color={theme.syntax.magenta}>I</Text>
        <Text color={theme.syntax.green}>V</Text>
        <Text color={theme.syntax.yellow}>E</Text>
      </Text>
      <Text color={theme.fg.muted}>AI-Powered Work Execution</Text>
    </Box>
  );
};
