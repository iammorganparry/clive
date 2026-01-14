import { Box, Text } from "ink";
import type React from "react";
import { memo, useMemo } from "react";
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

interface TerminalOutputProps {
  maxLines?: number;
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

    // Tool calls - compact box with muted styling
    if (line.type === "tool_call" && line.toolName) {
      const rest = text.replace(/^[●◆⏺▶→]\s*\w+/, "").trim();
      return (
        <Box
          borderStyle="single"
          borderColor={theme.ui.border}
          borderLeft
          borderRight={false}
          borderTop={false}
          borderBottom={false}
          paddingLeft={1}
          marginLeft={1}
        >
          <Text dimColor>
            <Text color={theme.syntax.yellow}>⚡ </Text>
            <Text color={theme.fg.muted}>{line.toolName}</Text>
            {rest && <Text color={theme.fg.comment}> {rest.slice(0, 50)}{rest.length > 50 ? "…" : ""}</Text>}
          </Text>
        </Box>
      );
    }

    // Tool results - compact muted text in indented box
    if (line.type === "tool_result") {
      const content = text.replace(/^[└→┃│]\s*/, "").trim();
      // Truncate long results
      const truncated = content.length > 80 ? content.slice(0, 80) + "…" : content;
      return (
        <Box marginLeft={2} paddingLeft={1}>
          <Text dimColor color={theme.fg.comment}>
            ↳ {truncated}
          </Text>
        </Box>
      );
    }

    // User input - darker background with red left border (like Clive logo)
    if (line.type === "user_input") {
      const content = text.replace(/^[❯>]\s*/, "");
      return (
        <Box flexGrow={1}>
          <Box
            borderStyle="single"
            borderLeft
            borderRight={false}
            borderTop={false}
            borderBottom={false}
            borderColor={theme.syntax.red}
            paddingLeft={1}
            flexGrow={1}
          >
            <Box backgroundColor={theme.bg.tertiary} flexGrow={1} paddingX={1}>
              <Text color={theme.fg.primary}>{content}</Text>
            </Box>
          </Box>
        </Box>
      );
    }

    // Assistant responses - markdown rendered with cyan left border
    if (line.type === "assistant") {
      return (
        <Box flexGrow={1}>
          <Box
            borderStyle="single"
            borderLeft
            borderRight={false}
            borderTop={false}
            borderBottom={false}
            borderColor={theme.syntax.cyan}
            paddingLeft={1}
            flexGrow={1}
          >
            <Box backgroundColor={theme.bg.tertiary} flexGrow={1} paddingX={1}>
              <MarkdownText>{text}</MarkdownText>
            </Box>
          </Box>
        </Box>
      );
    }

    // System messages - cyan bullet
    if (line.type === "system") {
      if (text.trim() === "") return <Text> </Text>;
      return (
        <Text>
          <Text color={theme.syntax.cyan}>● </Text>
          <Text color={theme.syntax.cyan}>{text}</Text>
        </Text>
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
  ({ maxLines = 50, onQuestionAnswer, onApprovalResponse }) => {
    const theme = useTheme();

    // Subscribe to lines from machine - only this component re-renders on line changes
    const lines = useOutputLines();
    const { isRunning, startTime } = useRunningState();
    const pendingInteraction = usePendingInteraction();

    // Memoize visible lines
    const visibleLines = useMemo(
      () => lines.slice(-maxLines),
      [lines, maxLines],
    );

    // Group consecutive tool lines to reduce visual noise
    const shouldAddMargin = (line: OutputLine, prevLine: OutputLine | null) => {
      if (!prevLine) return false;
      // Add margin when switching between major content types
      const majorTypes = ["assistant", "user_input", "system"];
      const isPrevMajor = majorTypes.includes(prevLine.type);
      const isCurrMajor = majorTypes.includes(line.type);
      // Margin when going from tool to major content, or between major content
      if (isCurrMajor && (isPrevMajor || prevLine.type === "tool_result")) return true;
      return false;
    };

    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderColor={theme.ui.border}
        paddingX={2}
        paddingY={1}
        overflow="hidden"
      >
        <Box marginBottom={1}>
          <Text bold color={theme.syntax.magenta}>
            OUTPUT
          </Text>
          {isRunning && <Text color={theme.fg.muted}> · streaming</Text>}
        </Box>

        <Box flexDirection="column" flexGrow={1} gap={0}>
          {visibleLines.length === 0 ? (
            <Text color={theme.fg.muted}>
              No output yet. Use <Text color={theme.syntax.yellow}>/build</Text>{" "}
              or press <Text color={theme.syntax.yellow}>b</Text> to start.
            </Text>
          ) : (
            visibleLines.map((line, index) => (
              <Box
                key={line.id}
                width="100%"
                marginTop={shouldAddMargin(line, visibleLines[index - 1] ?? null) ? 1 : 0}
              >
                <StyledLine line={line} theme={theme} />
              </Box>
            ))
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
