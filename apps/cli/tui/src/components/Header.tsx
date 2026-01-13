import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme.js';

export const Header: React.FC = () => {
  const theme = useTheme();

  return (
    <Box paddingX={1} gap={2}>
      <Text bold color={theme.syntax.red}>CLIVE</Text>
      <Text color={theme.fg.muted}>AI-Powered Work Execution</Text>
    </Box>
  );
};
