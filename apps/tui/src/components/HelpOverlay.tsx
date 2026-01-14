import { Box, Text, useInput } from "ink";
import type React from "react";
import { useTheme } from "../theme.js";

interface HelpOverlayProps {
  isVisible: boolean;
  onClose: () => void;
}

export const HelpOverlay: React.FC<HelpOverlayProps> = ({
  isVisible,
  onClose,
}) => {
  const theme = useTheme();

  useInput(
    (input, key) => {
      if (!isVisible) return;
      if (input === "?" || key.escape || input === "q") {
        onClose();
      }
    },
    { isActive: isVisible },
  );

  if (!isVisible) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={theme.syntax.blue}
      paddingX={2}
      paddingY={1}
    >
      <Box marginBottom={1}>
        <Text bold color={theme.syntax.magenta}>
          KEYBOARD SHORTCUTS
        </Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text bold color={theme.syntax.cyan}>
          Navigation
        </Text>
        <Text color={theme.fg.primary}>
          {" "}
          <Text color={theme.syntax.yellow}>←</Text>{" "}
          <Text color={theme.syntax.yellow}>→</Text> Switch session tabs
        </Text>
        <Text color={theme.fg.primary}>
          {" "}
          <Text color={theme.syntax.yellow}>Tab</Text> Cycle focus (sidebar →
          output → input)
        </Text>
        <Text color={theme.fg.primary}>
          {" "}
          <Text color={theme.syntax.yellow}>Shift+Tab</Text> Cycle focus
          backwards
        </Text>
        <Text color={theme.fg.primary}>
          {" "}
          <Text color={theme.syntax.yellow}>j</Text>{" "}
          <Text color={theme.syntax.yellow}>k</Text> Move up/down in lists
        </Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text bold color={theme.syntax.cyan}>
          Commands
        </Text>
        <Text color={theme.fg.primary}>
          {" "}
          <Text color={theme.syntax.yellow}>/</Text> Focus command input
        </Text>
        <Text color={theme.fg.primary}>
          {" "}
          <Text color={theme.syntax.yellow}>Enter</Text> Execute command /
          Select
        </Text>
        <Text color={theme.fg.primary}>
          {" "}
          <Text color={theme.syntax.yellow}>Esc</Text> Clear input / Unfocus
        </Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text bold color={theme.syntax.cyan}>
          Actions
        </Text>
        <Text color={theme.fg.primary}>
          {" "}
          <Text color={theme.syntax.yellow}>n</Text> New session (/plan)
        </Text>
        <Text color={theme.fg.primary}>
          {" "}
          <Text color={theme.syntax.yellow}>b</Text> Start build (/build)
        </Text>
        <Text color={theme.fg.primary}>
          {" "}
          <Text color={theme.syntax.yellow}>c</Text> Cancel build (/cancel)
        </Text>
        <Text color={theme.fg.primary}>
          {" "}
          <Text color={theme.syntax.yellow}>r</Text> Refresh status
        </Text>
      </Box>

      <Box flexDirection="column">
        <Text bold color={theme.syntax.cyan}>
          Help
        </Text>
        <Text color={theme.fg.primary}>
          {" "}
          <Text color={theme.syntax.yellow}>?</Text> Toggle this help
        </Text>
        <Text color={theme.fg.primary}>
          {" "}
          <Text color={theme.syntax.yellow}>Ctrl+C</Text> Quit
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={theme.fg.muted}>Press ? or Esc to close</Text>
      </Box>
    </Box>
  );
};
