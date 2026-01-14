import { Box, Text, useInput } from "ink";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useOutputLines,
  usePendingInteraction,
  useRunningState,
} from "../machines/OutputMachineProvider.js";
import { type Theme, useTheme } from "../theme.js";
import type { OutputLine } from "../types.js";
import { ApprovalPrompt } from "./ApprovalPrompt.js";
import { MarkdownText } from "./MarkdownText.js";
import { QuestionPrompt } from "./QuestionPrompt.js";
import { Spinner } from "./Spinner.js";

/**
 * Virtual scrolling hook for terminal output
 * Only renders lines that are visible in the viewport
 */
function useVirtualScroll(
  totalItems: number,
  viewportHeight: number,
  itemHeight: number = 1,
) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const prevTotalItems = useRef(totalItems);

  // Calculate visible range
  const startIndex = Math.floor(scrollOffset / itemHeight);
  const endIndex = Math.min(
    totalItems,
    Math.ceil((scrollOffset + viewportHeight) / itemHeight),
  );

  // Auto-scroll to bottom when new items added
  useEffect(() => {
    if (isAutoScroll && totalItems > prevTotalItems.current) {
      const maxScroll = Math.max(0, totalItems * itemHeight - viewportHeight);
      setScrollOffset(maxScroll);
    }
    prevTotalItems.current = totalItems;
  }, [totalItems, viewportHeight, itemHeight, isAutoScroll]);

  const scrollTo = useCallback(
    (offset: number) => {
      const maxScroll = Math.max(0, totalItems * itemHeight - viewportHeight);
      const newOffset = Math.max(0, Math.min(offset, maxScroll));
      setScrollOffset(newOffset);
      // Disable auto-scroll if user scrolled up
      setIsAutoScroll(newOffset >= maxScroll - itemHeight);
    },
    [totalItems, viewportHeight, itemHeight],
  );

  const scrollBy = useCallback(
    (delta: number) => {
      scrollTo(scrollOffset + delta);
    },
    [scrollOffset, scrollTo],
  );

  const scrollToBottom = useCallback(() => {
    const maxScroll = Math.max(0, totalItems * itemHeight - viewportHeight);
    setScrollOffset(maxScroll);
    setIsAutoScroll(true);
  }, [totalItems, viewportHeight, itemHeight]);

  return {
    startIndex,
    endIndex,
    scrollOffset,
    scrollBy,
    scrollToBottom,
    isAutoScroll,
    totalHeight: totalItems * itemHeight,
  };
}

interface TerminalOutputProps {
  maxLines?: number;
  width?: number;
  onQuestionAnswer?: (id: string, answers: Record<string, string>) => void;
  onApprovalResponse?: (id: string, approved: boolean) => void;
}

// Tool names to highlight
const TOOL_NAMES = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "Task",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "AskUserQuestion",
  "NotebookEdit",
  "Skill",
  "KillShell",
  "TaskOutput",
];

// Patterns for different output types
const patterns = {
  toolUse:
    /^(⏺|●|◆|▶|→)\s*(Read|Write|Edit|Bash|Grep|Glob|Task|WebFetch|WebSearch|TodoWrite|AskUserQuestion|NotebookEdit|Skill)\b/i,
  toolResult: /^(✓|✔|✅|─+\s*Result|Output:)/,
  thinking: /^(🤔|💭|Thinking|<thinking>)/i,
  error: /^(✗|✘|❌|Error:|ERROR:|Failed:|FAIL|error\[)/i,
  success: /^(✓|✔|✅|Success:|PASS|Done|Complete)/i,
  warning: /^(⚠|Warning:|WARN)/i,
  filePath:
    /([\\/][\w\-\\.\\/]+\.(ts|tsx|js|jsx|json|md|py|go|rs|sh|yml|yaml|toml))/g,
  lineNumber: /^(\s*\d+[→│|:])/,
  header: /^(#{1,3}\s|─{3,}|═{3,}|▸|▹)/,
  prompt: /^(>|\$|❯|λ)\s/,
  codeBlock: /^```/,
  bullet: /^(\s*[-*•]\s)/,
  numberedList: /^(\d+)\.\s+(.+)$/,
  inlineCode: /`([^`]+)`/g,
  bold: /\*\*([^*]+)\*\*/g,
  arrow: /→/g,
};

// Render a single line with syntax highlighting
const StyledLine: React.FC<{ line: OutputLine; theme: Theme }> = memo(
  ({ line, theme }) => {
    const text = line.text;
    const indent = line.indent ? "  ".repeat(line.indent) : "";

    // Tool calls - compact box with muted styling and left border
    if (line.type === "tool_call" && line.toolName) {
      const rest = text.replace(/^[●◆⏺▶→]\s*\w+/, "").trim();
      const truncatedRest = rest.length > 60 ? rest.slice(0, 60) + "…" : rest;
      return (
        <Box
          borderStyle="single"
          borderColor={theme.syntax.yellow}
          borderLeft
          borderRight={false}
          borderTop={false}
          borderBottom={false}
          paddingLeft={1}
          marginLeft={1}
        >
          <Text>
            <Text color={theme.syntax.yellow}>⚡ {line.toolName}</Text>
            {truncatedRest && <Text color={theme.fg.muted}> {truncatedRest}</Text>}
          </Text>
        </Box>
      );
    }

    // Tool results - compact muted text in indented box
    if (line.type === "tool_result") {
      const content = text.replace(/^[└→┃│]\s*/, "").trim();
      const truncated = content.length > 60 ? content.slice(0, 60) + "…" : content;
      return (
        <Box marginLeft={3}>
          <Text dimColor color={theme.fg.comment}>
            ↳ {truncated}
          </Text>
        </Box>
      );
    }

    // User input - box with red left border
    if (line.type === "user_input") {
      const content = text.replace(/^[❯>]\s*/, "");
      return (
        <Box
          borderStyle="single"
          borderLeft
          borderRight={false}
          borderTop={false}
          borderBottom={false}
          borderColor={theme.syntax.red}
          paddingLeft={1}
        >
          <Text color={theme.fg.primary}>{content}</Text>
        </Box>
      );
    }

    // Assistant responses - block with blue left border
    if (line.type === "assistant") {
      return (
        <Box
          borderStyle="single"
          borderLeft
          borderRight={false}
          borderTop={false}
          borderBottom={false}
          borderColor={theme.syntax.blue}
          paddingLeft={1}
          paddingRight={1}
          marginY={1}
        >
          <Box flexDirection="column">
            <MarkdownText>{text}</MarkdownText>
          </Box>
        </Box>
      );
    }

    // System messages - block with magenta left border
    if (line.type === "system") {
      if (text.trim() === "") return <Text> </Text>;
      return (
        <Box
          borderStyle="single"
          borderLeft
          borderRight={false}
          borderTop={false}
          borderBottom={false}
          borderColor={theme.syntax.magenta}
          paddingLeft={1}
          marginY={1}
        >
          <Text color={theme.syntax.cyan}>{text}</Text>
        </Box>
      );
    }

    // Stderr - red bullet
    if (line.type === "stderr") {
      return (
        <Text>
          <Text color={theme.syntax.red}>● </Text>
          <Text color={theme.syntax.red}>{text}</Text>
        </Text>
      );
    }

    // Markers - section dividers
    if (line.type === "marker") {
      return (
        <Text>
          <Text color={theme.syntax.magenta}>◆ </Text>
          <Text
            backgroundColor={theme.bg.highlight}
            color={theme.syntax.magenta}
            bold
          >
            {text}
          </Text>
        </Text>
      );
    }

    // Tool use indicators (legacy pattern matching)
    if (patterns.toolUse.test(text)) {
      const match = text.match(patterns.toolUse);
      if (match) {
        const [, , toolName] = match;
        const rest = text.slice(match[0].length);
        return (
          <Text>
            <Text color={theme.syntax.yellow}>● </Text>
            <Text color={theme.syntax.yellow} bold>
              {toolName}
            </Text>
            <Text color={theme.fg.primary}>{rest}</Text>
          </Text>
        );
      }
    }

    // Tool results / success
    if (patterns.toolResult.test(text) || patterns.success.test(text)) {
      return (
        <Text>
          <Text color={theme.syntax.green}>✓ </Text>
          <Text color={theme.syntax.green}>{text}</Text>
        </Text>
      );
    }

    // Thinking blocks
    if (patterns.thinking.test(text)) {
      return (
        <Text>
          <Text color={theme.fg.comment}>○ </Text>
          <Text color={theme.fg.comment} italic>
            {text}
          </Text>
        </Text>
      );
    }

    // Errors
    if (patterns.error.test(text)) {
      return (
        <Text>
          <Text color={theme.syntax.red}>✗ </Text>
          <Text color={theme.syntax.red}>{text}</Text>
        </Text>
      );
    }

    // Warnings
    if (patterns.warning.test(text)) {
      return (
        <Text>
          <Text color={theme.syntax.yellow}>⚠ </Text>
          <Text color={theme.syntax.yellow}>{text}</Text>
        </Text>
      );
    }

    // Headers / section titles
    if (patterns.header.test(text)) {
      return (
        <Text>
          <Text color={theme.syntax.blue}>▸ </Text>
          <Text color={theme.syntax.blue} bold>
            {text}
          </Text>
        </Text>
      );
    }

    // Line numbers (code output)
    if (patterns.lineNumber.test(text)) {
      const match = text.match(patterns.lineNumber);
      if (match) {
        const lineNum = match[1];
        const rest = text.slice(lineNum.length);
        return (
          <Text>
            <Text color={theme.fg.muted}> {lineNum}</Text>
            <Text color={theme.fg.primary}>{rest}</Text>
          </Text>
        );
      }
    }

    // Command prompts
    if (patterns.prompt.test(text)) {
      const match = text.match(patterns.prompt);
      if (match) {
        const prompt = match[0];
        const rest = text.slice(prompt.length);
        return (
          <Text>
            <Text color={theme.syntax.green} bold>
              {prompt}
            </Text>
            <Text color={theme.syntax.yellow}>{rest}</Text>
          </Text>
        );
      }
    }

    // Code blocks
    if (patterns.codeBlock.test(text)) {
      return (
        <Text>
          <Text color={theme.syntax.orange}> {text}</Text>
        </Text>
      );
    }

    // Bullets
    if (patterns.bullet.test(text)) {
      const match = text.match(patterns.bullet);
      if (match) {
        const bullet = match[1];
        const rest = text.slice(bullet.length);
        return (
          <Text>
            <Text color={theme.syntax.blue}>{bullet}</Text>
            <Text color={theme.fg.primary}>{rest}</Text>
          </Text>
        );
      }
    }

    // Test results
    if (text.includes("PASS")) {
      return (
        <Text>
          <Text color={theme.syntax.green}>✓ </Text>
          <Text color={theme.syntax.green}>{text}</Text>
        </Text>
      );
    }
    if (text.includes("FAIL")) {
      return (
        <Text>
          <Text color={theme.syntax.red}>✗ </Text>
          <Text color={theme.syntax.red}>{text}</Text>
        </Text>
      );
    }

    // Check marks and X marks
    if (text.includes("✓") || text.includes("✔")) {
      return <Text color={theme.syntax.green}> {text}</Text>;
    }
    if (text.includes("✗") || text.includes("✘")) {
      return <Text color={theme.syntax.red}> {text}</Text>;
    }

    // Tool names in text
    for (const tool of TOOL_NAMES) {
      if (text.includes(tool)) {
        const parts = text.split(new RegExp(`(${tool})`, "g"));
        return (
          <Text>
            <Text color={theme.fg.primary}> </Text>
            {parts.map((part, i) =>
              part === tool ? (
                <Text key={i} color={theme.syntax.magenta}>
                  {part}
                </Text>
              ) : (
                <Text key={i} color={theme.fg.primary}>
                  {part}
                </Text>
              ),
            )}
          </Text>
        );
      }
    }

    // File paths
    if (patterns.filePath.test(text)) {
      const parts = text.split(patterns.filePath);
      return (
        <Text>
          <Text color={theme.fg.primary}> </Text>
          {parts.map((part, i) => {
            if (patterns.filePath.test(part)) {
              patterns.filePath.lastIndex = 0;
              return (
                <Text key={i} color={theme.syntax.cyan} underline>
                  {part}
                </Text>
              );
            }
            return (
              <Text key={i} color={theme.fg.primary}>
                {part}
              </Text>
            );
          })}
        </Text>
      );
    }

    // Numbered lists
    const numberedMatch = text.match(patterns.numberedList);
    if (numberedMatch) {
      const [, num, content] = numberedMatch;
      return (
        <Text>
          <Text color={theme.syntax.blue}> {num}. </Text>
          {renderInlineMarkdown(content, theme)}
        </Text>
      );
    }

    // Default styling
    return (
      <Text color={theme.fg.primary}> {renderInlineMarkdown(text, theme)}</Text>
    );
  },
);

// Helper to render inline markdown
function renderInlineMarkdown(text: string, theme: Theme): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let key = 0;
  const codeRegex = /`([^`]+)`/g;
  let lastIndex = 0;
  let match;

  while ((match = codeRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <Text key={key++} color={theme.fg.primary}>
          {text.slice(lastIndex, match.index)}
        </Text>,
      );
    }
    parts.push(
      <Text key={key++} color={theme.syntax.orange} bold>
        {match[1]}
      </Text>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex);
    if (rest.includes("**")) {
      const boldParts = rest.split(/\*\*([^*]+)\*\*/g);
      boldParts.forEach((part, i) => {
        if (i % 2 === 1) {
          parts.push(
            <Text key={key++} color={theme.fg.primary} bold>
              {part}
            </Text>,
          );
        } else if (part) {
          parts.push(
            <Text key={key++} color={theme.fg.primary}>
              {part}
            </Text>,
          );
        }
      });
    } else {
      parts.push(
        <Text key={key++} color={theme.fg.primary}>
          {rest}
        </Text>,
      );
    }
  }

  return parts.length > 0 ? (
    <>{parts}</>
  ) : (
    <Text color={theme.fg.primary}>{text}</Text>
  );
}

StyledLine.displayName = "StyledLine";

// Main component - subscribes to lines from machine
export const TerminalOutput: React.FC<TerminalOutputProps> = memo(
  ({ maxLines = 50, width, onQuestionAnswer, onApprovalResponse }) => {
    const theme = useTheme();

    // Subscribe to lines from machine - only this component re-renders on line changes
    const lines = useOutputLines();
    const { isRunning, startTime } = useRunningState();
    const pendingInteraction = usePendingInteraction();

    // Calculate available height for lines
    // Account for: header (2), spinner (2 when running), prompts (~8 when active), border (2)
    const headerOverhead = 2; // OUTPUT header + margin
    const spinnerOverhead = isRunning ? 2 : 0;
    const promptOverhead = pendingInteraction ? 8 : 0;
    const borderOverhead = 2; // top + bottom border
    const viewportHeight = Math.max(5, maxLines - headerOverhead - spinnerOverhead - promptOverhead - borderOverhead);

    // Virtual scrolling - only render visible lines
    const { startIndex, endIndex, scrollBy, scrollToBottom, isAutoScroll } =
      useVirtualScroll(lines.length, viewportHeight);

    // Get only the visible slice of lines
    const visibleLines = useMemo(
      () => lines.slice(startIndex, endIndex),
      [lines, startIndex, endIndex],
    );

    // Handle scroll input
    useInput(
      (input, key) => {
        // Don't handle scroll when interaction is pending
        if (pendingInteraction) return;

        if (key.upArrow || input === "k") {
          scrollBy(-3);
        } else if (key.downArrow || input === "j") {
          scrollBy(3);
        } else if (key.pageUp) {
          scrollBy(-viewportHeight);
        } else if (key.pageDown) {
          scrollBy(viewportHeight);
        } else if (input === "G") {
          scrollToBottom();
        }
      },
      { isActive: !pendingInteraction },
    );

    // Add spacing between different content types for visual clarity
    const shouldAddMargin = (line: OutputLine, prevLine: OutputLine | null) => {
      if (!prevLine) return false;

      // Always add margin between different major content types
      const majorTypes = ["assistant", "user_input", "system", "marker"];
      const toolTypes = ["tool_call", "tool_result"];

      // Margin when switching between major content types
      if (majorTypes.includes(line.type) && majorTypes.includes(prevLine.type)) {
        return line.type !== prevLine.type;
      }

      // Margin when going from tools to major content
      if (majorTypes.includes(line.type) && toolTypes.includes(prevLine.type)) {
        return true;
      }

      // Margin when going from major content to tools
      if (toolTypes.includes(line.type) && majorTypes.includes(prevLine.type)) {
        return true;
      }

      return false;
    };

    return (
      <Box
        flexDirection="column"
        width={width}
        flexGrow={width ? 0 : 1}
        borderStyle="round"
        borderColor={theme.ui.border}
        paddingX={2}
        paddingY={1}
        overflow="hidden"
      >
        {/* Header with scroll indicator */}
        <Box marginBottom={1} justifyContent="space-between">
          <Box>
            <Text bold color={theme.syntax.magenta}>
              OUTPUT
            </Text>
            {isRunning && <Text color={theme.fg.muted}> · streaming</Text>}
          </Box>
          {/* Scroll indicator */}
          {lines.length > viewportHeight && (
            <Text color={theme.fg.muted} dimColor>
              {isAutoScroll ? "↓ auto" : `${startIndex + 1}-${endIndex}/${lines.length}`}
            </Text>
          )}
        </Box>

        {/* Virtualized content container */}
        <Box
          flexDirection="column"
          height={viewportHeight}
          overflow="hidden"
        >
          {visibleLines.length === 0 && !isRunning ? (
            <Text color={theme.fg.muted}>
              No output yet. Use <Text color={theme.syntax.yellow}>/build</Text>{" "}
              or press <Text color={theme.syntax.yellow}>b</Text> to start.
            </Text>
          ) : (
            visibleLines.map((line, index) => {
              const globalIndex = startIndex + index;
              const prevLine = globalIndex > 0 ? lines[globalIndex - 1] : null;
              return (
                <Box
                  key={line.id}
                  width="100%"
                  marginTop={shouldAddMargin(line, prevLine) ? 1 : 0}
                >
                  <StyledLine line={line} theme={theme} />
                </Box>
              );
            })
          )}
        </Box>

        {/* Render pending interaction prompts */}
        {pendingInteraction?.type === "question" && onQuestionAnswer && (
          <QuestionPrompt
            questions={pendingInteraction.questions}
            onSubmit={(answers) =>
              onQuestionAnswer(pendingInteraction.id, answers)
            }
          />
        )}

        {pendingInteraction?.type === "approval" && onApprovalResponse && (
          <ApprovalPrompt
            toolName={pendingInteraction.toolName}
            args={pendingInteraction.args}
            onApprove={() => onApprovalResponse(pendingInteraction.id, true)}
            onDeny={() => onApprovalResponse(pendingInteraction.id, false)}
          />
        )}

        {/* Activity spinner when running */}
        {isRunning && (
          <Box marginTop={1} paddingLeft={0}>
            <Spinner label="Working" startTime={startTime} />
          </Box>
        )}
      </Box>
    );
  },
);

TerminalOutput.displayName = "TerminalOutput";
