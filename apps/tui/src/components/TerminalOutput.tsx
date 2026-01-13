import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { useTheme, type Theme } from '../theme.js';
import type { OutputLine } from '../types.js';
import { Spinner } from './Spinner.js';

interface TerminalOutputProps {
  lines: OutputLine[];
  maxLines?: number;
  isRunning?: boolean;
  elapsedSeconds?: number;
}

// Tool names to highlight
const TOOL_NAMES = [
  'Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Task', 'WebFetch', 'WebSearch',
  'TodoWrite', 'AskUserQuestion', 'NotebookEdit', 'Skill', 'KillShell', 'TaskOutput',
];

// Patterns for different output types
const patterns = {
  toolUse: /^(⏺|●|◆|▶|→)\s*(Read|Write|Edit|Bash|Grep|Glob|Task|WebFetch|WebSearch|TodoWrite|AskUserQuestion|NotebookEdit|Skill)\b/i,
  toolResult: /^(✓|✔|✅|─+\s*Result|Output:)/,
  thinking: /^(🤔|💭|Thinking|<thinking>)/i,
  error: /^(✗|✘|❌|Error:|ERROR:|Failed:|FAIL|error\[)/i,
  success: /^(✓|✔|✅|Success:|PASS|Done|Complete)/i,
  warning: /^(⚠|Warning:|WARN)/i,
  filePath: /([\/\\][\w\-\.\/\\]+\.(ts|tsx|js|jsx|json|md|py|go|rs|sh|yml|yaml|toml))/g,
  lineNumber: /^(\s*\d+[→│|:])/,
  header: /^(#{1,3}\s|─{3,}|═{3,}|▸|▹)/,
  prompt: /^(>|\$|❯|λ)\s/,
  codeBlock: /^```/,
  bullet: /^(\s*[-*•]\s)/,
};

// Render a single line with syntax highlighting
const StyledLine: React.FC<{ line: OutputLine; theme: Theme }> = memo(({ line, theme }) => {
  const text = line.text;
  const indent = line.indent ? '  '.repeat(line.indent) : '';

  // Tool calls - yellow bullet with bold tool name
  if (line.type === 'tool_call' && line.toolName) {
    const rest = text.replace(/^[●◆⏺▶→]\s*\w+/, '');
    return (
      <Text>
        <Text color={theme.syntax.yellow}>● </Text>
        <Text bold color={theme.syntax.yellow}>{line.toolName}</Text>
        <Text color={theme.fg.primary}>{rest}</Text>
      </Text>
    );
  }

  // Tool results - indented with tree character
  if (line.type === 'tool_result') {
    const content = text.replace(/^[└→┃│]\s*/, '');
    return (
      <Text>
        <Text color={theme.fg.muted}>{indent}  └ </Text>
        <Text color={theme.fg.secondary}>{content}</Text>
      </Text>
    );
  }

  // User input - highlighted with green prompt
  if (line.type === 'user_input') {
    const content = text.replace(/^[❯>]\s*/, '');
    return (
      <Text>
        <Text bold color={theme.syntax.green}>❯ </Text>
        <Text bold color={theme.fg.primary}>{content}</Text>
      </Text>
    );
  }

  // System messages - cyan bullet
  if (line.type === 'system') {
    if (text.trim() === '') return <Text> </Text>; // Blank line for spacing
    return (
      <Text>
        <Text color={theme.syntax.cyan}>● </Text>
        <Text color={theme.syntax.cyan}>{text}</Text>
      </Text>
    );
  }

  // Stderr - red bullet
  if (line.type === 'stderr') {
    return (
      <Text>
        <Text color={theme.syntax.red}>● </Text>
        <Text color={theme.syntax.red}>{text}</Text>
      </Text>
    );
  }

  // Markers - section dividers
  if (line.type === 'marker') {
    return (
      <Text>
        <Text color={theme.syntax.magenta}>◆ </Text>
        <Text backgroundColor={theme.bg.highlight} color={theme.syntax.magenta} bold>
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
          <Text color={theme.syntax.yellow} bold>{toolName}</Text>
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
        <Text color={theme.fg.comment} italic>{text}</Text>
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
        <Text color={theme.syntax.blue} bold>{text}</Text>
      </Text>
    );
  }

  // Line numbers (code output) - no bullet, preserve formatting
  if (patterns.lineNumber.test(text)) {
    const match = text.match(patterns.lineNumber);
    if (match) {
      const lineNum = match[1];
      const rest = text.slice(lineNum.length);
      return (
        <Text>
          <Text color={theme.fg.muted}>  {lineNum}</Text>
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
          <Text color={theme.syntax.green} bold>{prompt}</Text>
          <Text color={theme.syntax.yellow}>{rest}</Text>
        </Text>
      );
    }
  }

  // Code blocks
  if (patterns.codeBlock.test(text)) {
    return (
      <Text>
        <Text color={theme.syntax.orange}>  {text}</Text>
      </Text>
    );
  }

  // Bullets - preserve original bullets
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
  if (text.includes('PASS')) {
    return (
      <Text>
        <Text color={theme.syntax.green}>✓ </Text>
        <Text color={theme.syntax.green}>{text}</Text>
      </Text>
    );
  }
  if (text.includes('FAIL')) {
    return (
      <Text>
        <Text color={theme.syntax.red}>✗ </Text>
        <Text color={theme.syntax.red}>{text}</Text>
      </Text>
    );
  }

  // Check marks and X marks
  if (text.includes('✓') || text.includes('✔')) {
    return <Text color={theme.syntax.green}>  {text}</Text>;
  }
  if (text.includes('✗') || text.includes('✘')) {
    return <Text color={theme.syntax.red}>  {text}</Text>;
  }

  // Tool names in text
  for (const tool of TOOL_NAMES) {
    if (text.includes(tool)) {
      const parts = text.split(new RegExp(`(${tool})`, 'g'));
      return (
        <Text>
          <Text color={theme.fg.primary}>  </Text>
          {parts.map((part, i) => (
            part === tool
              ? <Text key={i} color={theme.syntax.magenta}>{part}</Text>
              : <Text key={i} color={theme.fg.primary}>{part}</Text>
          ))}
        </Text>
      );
    }
  }

  // File paths - highlight them
  if (patterns.filePath.test(text)) {
    const parts = text.split(patterns.filePath);
    return (
      <Text>
        <Text color={theme.fg.primary}>  </Text>
        {parts.map((part, i) => {
          if (patterns.filePath.test(part)) {
            patterns.filePath.lastIndex = 0;
            return <Text key={i} color={theme.syntax.cyan} underline>{part}</Text>;
          }
          return <Text key={i} color={theme.fg.primary}>{part}</Text>;
        })}
      </Text>
    );
  }

  // Default styling - plain text with small indent
  return <Text color={theme.fg.primary}>  {text}</Text>;
});

StyledLine.displayName = 'StyledLine';

export const TerminalOutput: React.FC<TerminalOutputProps> = memo(({
  lines,
  maxLines = 50,
  isRunning = false,
  elapsedSeconds = 0,
}) => {
  const theme = useTheme();

  // Show only the last N lines
  const visibleLines = lines.slice(-maxLines);

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
        {isRunning && (
          <Text color={theme.fg.muted}> · streaming</Text>
        )}
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {visibleLines.length === 0 ? (
          <Text color={theme.fg.muted}>
            No output yet. Use <Text color={theme.syntax.yellow}>/build</Text> or press <Text color={theme.syntax.yellow}>b</Text> to start.
          </Text>
        ) : (
          visibleLines.map(line => (
            <Box key={line.id} width="100%">
              <StyledLine line={line} theme={theme} />
            </Box>
          ))
        )}
      </Box>

      {/* Activity spinner when running */}
      {isRunning && (
        <Box marginTop={1} paddingLeft={0}>
          <Spinner label="Working" elapsed={elapsedSeconds} />
        </Box>
      )}
    </Box>
  );
});

TerminalOutput.displayName = 'TerminalOutput';
