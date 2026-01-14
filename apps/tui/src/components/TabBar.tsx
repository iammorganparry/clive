import { Box, Text } from "ink";
import type React from "react";
import { memo } from "react";
import { useTheme } from "../theme.js";
import type { Session } from "../types.js";

interface TabBarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNewSession?: () => void;
}

export const TabBar: React.FC<TabBarProps> = memo(
  ({ sessions, activeSessionId, onSelect, onNewSession }) => {
    const theme = useTheme();

    if (sessions.length === 0) {
      return (
        <Box borderStyle="round" borderColor={theme.ui.border} paddingX={1}>
          <Text color={theme.fg.muted}>No sessions - use /plan or press </Text>
          <Text color={theme.syntax.yellow}>n</Text>
          <Text color={theme.fg.muted}> to create one</Text>
          <Box marginLeft={2}>
            <Text color={theme.syntax.cyan} bold>
              [+ New]
            </Text>
          </Box>
        </Box>
      );
    }

    return (
      <Box
        borderStyle="round"
        borderColor={theme.ui.border}
        paddingX={1}
        gap={1}
      >
        {sessions.map((session, index) => {
          const isActive = session.id === activeSessionId;
          const isRunning = session.isActive && session.iteration !== undefined;

          // Status indicator: ▸ for selected, ● for running, ○ for idle
          const statusIcon = isActive ? "▸" : isRunning ? "●" : "○";

          // Color logic: selected gets white on blue, running gets green, others are muted
          const textColor = isActive
            ? "#FFFFFF"
            : isRunning
              ? theme.syntax.green
              : theme.fg.muted;

          return (
            <Box key={session.id}>
              <Text
                backgroundColor={isActive ? theme.syntax.blue : undefined}
                color={textColor}
                bold={isActive}
                dimColor={!isActive && !isRunning}
              >
                {" "}
                {statusIcon} {session.name}
                {isRunning &&
                  ` (${session.iteration}/${session.maxIterations})`}{" "}
              </Text>
              {index < sessions.length - 1 && (
                <Text color={theme.ui.border}>│</Text>
              )}
            </Box>
          );
        })}
        <Box marginLeft={1}>
          <Text color={theme.syntax.cyan} bold>
            [+ New]
          </Text>
        </Box>
        <Box flexGrow={1} justifyContent="flex-end">
          <Text color={theme.fg.muted} dimColor>
            [/] to switch
          </Text>
        </Box>
      </Box>
    );
  },
);

TabBar.displayName = "TabBar";
