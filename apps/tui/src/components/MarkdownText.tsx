/**
 * MarkdownText component - renders markdown using glow if available
 * Falls back to styled text rendering otherwise
 */

import { Box, Text } from "ink";
import type React from "react";
import { memo, useMemo } from "react";
import { useTheme } from "../theme.js";
import { isGlowAvailable, renderMarkdown } from "../utils/markdown.js";

interface MarkdownTextProps {
  children: string;
  /** Width for glow rendering (default: 80) */
  width?: number;
}

/**
 * Simple inline markdown patterns for fallback rendering
 */
function renderInlineMarkdown(
  text: string,
  theme: ReturnType<typeof useTheme>,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  // Process inline code
  const codeRegex = /`([^`]+)`/g;
  let lastIndex = 0;
  let match;

  while ((match = codeRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <Text key={key++}>{text.slice(lastIndex, match.index)}</Text>,
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
    remaining = text.slice(lastIndex);

    // Process bold
    if (remaining.includes("**")) {
      const boldParts = remaining.split(/\*\*([^*]+)\*\*/g);
      boldParts.forEach((part, i) => {
        if (i % 2 === 1) {
          parts.push(
            <Text key={key++} bold>
              {part}
            </Text>,
          );
        } else if (part) {
          parts.push(<Text key={key++}>{part}</Text>);
        }
      });
    } else {
      parts.push(<Text key={key++}>{remaining}</Text>);
    }
  }

  return parts.length > 0 ? parts : [<Text key={0}>{text}</Text>];
}

/**
 * Render a line with markdown-aware styling (fallback when glow not available)
 */
function FallbackMarkdownLine({
  line,
  theme,
}: {
  line: string;
  theme: ReturnType<typeof useTheme>;
}): React.ReactElement {
  // Headers
  if (line.startsWith("# ")) {
    return (
      <Text bold color={theme.syntax.blue}>
        {line.slice(2)}
      </Text>
    );
  }
  if (line.startsWith("## ")) {
    return (
      <Text bold color={theme.syntax.cyan}>
        {line.slice(3)}
      </Text>
    );
  }
  if (line.startsWith("### ")) {
    return (
      <Text bold color={theme.syntax.green}>
        {line.slice(4)}
      </Text>
    );
  }

  // Code blocks
  if (line.startsWith("```")) {
    return <Text color={theme.fg.muted}>{line}</Text>;
  }

  // Bullet points
  if (line.match(/^\s*[-*]\s/)) {
    const indent = line.match(/^(\s*)/)?.[1] || "";
    const content = line.replace(/^\s*[-*]\s/, "");
    return (
      <Text>
        <Text color={theme.fg.muted}>{indent}</Text>
        <Text color={theme.syntax.blue}>• </Text>
        {renderInlineMarkdown(content, theme)}
      </Text>
    );
  }

  // Numbered lists
  if (line.match(/^\s*\d+\.\s/)) {
    const match = line.match(/^(\s*)(\d+)\.\s(.*)$/);
    if (match) {
      const [, indent, num, content] = match;
      return (
        <Text>
          <Text color={theme.fg.muted}>{indent}</Text>
          <Text color={theme.syntax.blue}>{num}. </Text>
          {renderInlineMarkdown(content, theme)}
        </Text>
      );
    }
  }

  // Blockquotes
  if (line.startsWith("> ")) {
    return (
      <Text>
        <Text color={theme.syntax.yellow}>│ </Text>
        <Text italic color={theme.fg.secondary}>
          {line.slice(2)}
        </Text>
      </Text>
    );
  }

  // Horizontal rules
  if (line.match(/^[-*_]{3,}$/)) {
    return <Text color={theme.fg.muted}>────────────────────</Text>;
  }

  // Regular text with inline formatting
  return <Text>{renderInlineMarkdown(line, theme)}</Text>;
}

export const MarkdownText: React.FC<MarkdownTextProps> = memo(
  ({ children, width = 80 }) => {
    const theme = useTheme();
    const text = children;

    // Try glow rendering
    const glowOutput = useMemo(() => {
      if (!isGlowAvailable()) return null;
      return renderMarkdown(text);
    }, [text]);

    // If glow rendered successfully, display its output
    if (glowOutput) {
      return (
        <Box flexDirection="column">
          {glowOutput.split("\n").map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
        </Box>
      );
    }

    // Fallback: render with our own styling
    const lines = text.split("\n");

    return (
      <Box flexDirection="column">
        {lines.map((line, i) => (
          <FallbackMarkdownLine key={i} line={line} theme={theme} />
        ))}
      </Box>
    );
  },
);

MarkdownText.displayName = "MarkdownText";
