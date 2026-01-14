import { Box, Text, useInput } from "ink";
import { type FC, useCallback, useState } from "react";
import { useTheme } from "../theme.js";

export interface ApprovalPromptProps {
  /** Tool that is requesting approval */
  toolName: string;
  /** Tool arguments (for display) */
  args?: unknown;
  /** Called when user approves */
  onApprove: () => void;
  /** Called when user denies */
  onDeny: () => void;
}

export const ApprovalPrompt: FC<ApprovalPromptProps> = ({
  toolName,
  args,
  onApprove,
  onDeny,
}) => {
  const theme = useTheme();
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Format args for display
  const formatArgs = (args: unknown): string => {
    if (!args) return "";
    if (typeof args === "string") return args;
    try {
      const str = JSON.stringify(args, null, 2);
      // Truncate long args
      if (str.length > 200) {
        return `${str.substring(0, 200)}...`;
      }
      return str;
    } catch {
      return String(args);
    }
  };

  const handleSelect = useCallback(() => {
    if (selectedIndex === 0) {
      onApprove();
    } else {
      onDeny();
    }
  }, [selectedIndex, onApprove, onDeny]);

  useInput((input, key) => {
    if (key.leftArrow || key.rightArrow) {
      setSelectedIndex((prev) => (prev === 0 ? 1 : 0));
    }
    if (key.return || input === " ") {
      handleSelect();
    }
    // Quick keys
    if (input === "y" || input === "Y") {
      onApprove();
    }
    if (input === "n" || input === "N") {
      onDeny();
    }
  });

  const argsDisplay = formatArgs(args);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.syntax.yellow}
      paddingX={1}
      paddingY={0}
      marginY={1}
    >
      <Box marginBottom={1}>
        <Text color={theme.syntax.yellow} bold>
          Approval Required
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={theme.fg.primary}>
          Allow{" "}
          <Text color={theme.syntax.magenta} bold>
            {toolName}
          </Text>{" "}
          to execute?
        </Text>
      </Box>

      {argsDisplay && (
        <Box marginBottom={1} flexDirection="column">
          <Text color={theme.fg.muted}>Arguments:</Text>
          <Box paddingLeft={2}>
            <Text color={theme.fg.secondary}>{argsDisplay}</Text>
          </Box>
        </Box>
      )}

      <Box gap={2}>
        <Box>
          <Text
            color={selectedIndex === 0 ? theme.bg.primary : theme.fg.primary}
            backgroundColor={
              selectedIndex === 0 ? theme.syntax.green : undefined
            }
            bold={selectedIndex === 0}
          >
            {selectedIndex === 0 ? " [Y] Yes " : "  Y  Yes "}
          </Text>
        </Box>
        <Box>
          <Text
            color={selectedIndex === 1 ? theme.bg.primary : theme.fg.primary}
            backgroundColor={selectedIndex === 1 ? theme.syntax.red : undefined}
            bold={selectedIndex === 1}
          >
            {selectedIndex === 1 ? " [N] No " : "  N  No "}
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={theme.fg.muted} dimColor>
          Press Y/N or arrow keys + Enter
        </Text>
      </Box>
    </Box>
  );
};
