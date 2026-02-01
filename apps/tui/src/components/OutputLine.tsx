/**
 * OutputLine Component
 * Renders individual output lines with type-specific styling
 * Ported from apps/tui-go/internal/tui/root.go renderOutputContent
 */

import { MetadataCalculator } from "../services/MetadataCalculator";
import { OneDarkPro } from "../styles/theme";
import type { OutputLine as OutputLineType } from "../types";
import { DiffView } from "./DiffView";

interface Props {
  line: OutputLineType;
}

export function OutputLine({ line }: Props) {
  switch (line.type) {
    case "tool_call": {
      const toolInput = line.toolInput || {};

      // Read tool - show file path
      if (line.toolName === "Read" && toolInput.file_path) {
        const filename =
          toolInput.file_path.split("/").pop() || toolInput.file_path;
        return (
          <box flexDirection="row" marginTop={1}>
            <text fg={OneDarkPro.syntax.yellow}>Read 📄 </text>
            <text fg={OneDarkPro.foreground.muted}>{filename}</text>
          </box>
        );
      }

      // Grep tool - show pattern and path
      if (line.toolName === "Grep" && toolInput.pattern) {
        const path = toolInput.path || ".";
        const filename = path.split("/").pop() || path;
        return (
          <box flexDirection="row" marginTop={1}>
            <text fg={OneDarkPro.syntax.yellow}>
              Grep 🔍 "{toolInput.pattern}" in{" "}
            </text>
            <text fg={OneDarkPro.foreground.muted}>{filename}</text>
          </box>
        );
      }

      // Glob tool - show pattern
      if (line.toolName === "Glob" && toolInput.pattern) {
        return (
          <box flexDirection="row" marginTop={1}>
            <text fg={OneDarkPro.syntax.yellow}>Glob 📁 </text>
            <text fg={OneDarkPro.foreground.muted}>{toolInput.pattern}</text>
          </box>
        );
      }

      // Bash tool - show command (first line only, truncated)
      if (line.toolName === "Bash" && toolInput.command) {
        const firstLine = toolInput.command.split("\n")[0] || toolInput.command;
        const maxLen = 120;
        const truncated = firstLine.length > maxLen
          ? `${firstLine.substring(0, maxLen)}…`
          : firstLine;
        const isMultiline = toolInput.command.includes("\n");
        return (
          <box flexDirection="row" marginTop={1}>
            <text fg={OneDarkPro.syntax.cyan}>Bash $ </text>
            <text fg={OneDarkPro.foreground.muted}>
              {truncated}{isMultiline && !truncated.endsWith("…") ? " …" : ""}
            </text>
          </box>
        );
      }

      // Edit/Write tools - show file path
      if (
        (line.toolName === "Edit" || line.toolName === "Write") &&
        toolInput.file_path
      ) {
        const filename =
          toolInput.file_path.split("/").pop() || toolInput.file_path;
        return (
          <box flexDirection="row" marginTop={1}>
            <text fg={OneDarkPro.syntax.yellow}>{line.toolName} ✏️ </text>
            <text fg={OneDarkPro.foreground.muted}>{filename}</text>
          </box>
        );
      }

      // Default: show tool name
      return (
        <box marginTop={1}>
          <text fg={OneDarkPro.syntax.yellow}>● {line.toolName}</text>
        </box>
      );
    }

    case "tool_result": {
      // Tools whose results we skip entirely (already represented by other line types)
      const HIDDEN_TOOLS = new Set([
        "Read",
        "Grep",
        "Glob",
        "Bash",
        "Task",          // subagent_spawn/subagent_complete handles display
        "TodoWrite",
        "TodoRead",
      ]);
      if (HIDDEN_TOOLS.has(line.toolName || "")) {
        return null;
      }

      // Truncate output for verbose tools
      let displayText = line.text;
      let wasTruncated = false;

      // Char limits per tool — keep tight for terminal readability
      const TRUNCATION_LIMITS: Record<string, number> = {
        // Web tools
        WebSearch: 300,
        WebFetch: 400,

        // MCP context tools (very verbose)
        mcp__context7: 300,
        mcp__contextserver: 300,

        // MCP Linear tools (JSON responses)
        mcp__linear__create_issue: 200,
        mcp__linear__update_issue: 200,
        mcp__linear__create_project: 200,
        mcp__linear__list_issues: 400,
        mcp__linear__get_issue: 300,

        // MCP Playwright tools (page snapshots are huge)
        mcp__playwright__browser_snapshot: 300,
        mcp__playwright__browser_console_messages: 300,
        mcp__playwright__browser_network_requests: 300,

        // MCP Railway tools
        mcp__railway__get_logs: 400,
        mcp__railway__list_services: 300,
        mcp__railway__list_deployments: 300,

        // Edit/Write — diff view handles the detail
        Edit: 200,
        Write: 200,

        // Default for any unspecified tool
        DEFAULT: 500,
      };

      if (displayText && displayText.length > 0) {
        // Get tool-specific limit or default (also match mcp prefix patterns)
        const toolName = line.toolName || "";
        let maxChars = TRUNCATION_LIMITS[toolName];
        if (maxChars === undefined) {
          // Check prefix matches for MCP tool families
          for (const [key, limit] of Object.entries(TRUNCATION_LIMITS)) {
            if (key !== "DEFAULT" && toolName.startsWith(key)) {
              maxChars = limit;
              break;
            }
          }
        }
        maxChars = maxChars ?? TRUNCATION_LIMITS.DEFAULT ?? 500;

        // Truncate by char count
        if (displayText.length > maxChars) {
          displayText = displayText.slice(0, maxChars);
          wasTruncated = true;
        }

        // Cap line count — collapse multi-line outputs to max 4 lines
        const MAX_LINES = 4;
        const lines = displayText.split("\n");
        if (lines.length > MAX_LINES) {
          displayText = lines.slice(0, MAX_LINES).join("\n");
          wasTruncated = true;
        }
      }

      // Build metadata display
      const metadata: string[] = [];

      if (line.duration) {
        metadata.push(`⏱️  ${MetadataCalculator.formatDuration(line.duration)}`);
      }

      if (line.inputTokens || line.outputTokens) {
        const tokens = MetadataCalculator.formatTokens(
          line.inputTokens,
          line.outputTokens,
        );
        if (tokens) {
          metadata.push(`🪙 ${tokens}`);
        }
      }

      if (line.costUSD !== undefined) {
        const _costColor = MetadataCalculator.getCostColor(line.costUSD);
        const costText = MetadataCalculator.formatCost(line.costUSD);
        metadata.push(`💰 ${costText}`);
      }

      const metaSuffix = metadata.length > 0 ? `  ${metadata.join(" ")}` : "";

      return (
        <box flexDirection="column">
          <text fg={OneDarkPro.foreground.muted}>
            ↳ {displayText}{metaSuffix}
          </text>
          {wasTruncated && (
            <text fg={OneDarkPro.foreground.comment}>
              … (truncated)
            </text>
          )}
        </box>
      );
    }

    case "file_diff": {
      if (line.diffData) {
        return <DiffView diffData={line.diffData} duration={line.duration} />;
      }
      // Fallback for legacy pre-formatted strings
      const diffLines = line.text.split("\n");
      return (
        <box flexDirection="column">
          {diffLines.map((diffLine, i) => {
            let color = OneDarkPro.foreground.muted;
            if (diffLine.includes(" + ") || diffLine.startsWith("  + ")) {
              color = OneDarkPro.syntax.green;
            } else if (
              diffLine.includes(" - ") ||
              diffLine.startsWith("  - ")
            ) {
              color = OneDarkPro.syntax.red;
            } else if (diffLine.startsWith("● ")) {
              color = OneDarkPro.syntax.yellow;
            }
            return (
              <text key={i} fg={color}>
                {diffLine}
              </text>
            );
          })}
        </box>
      );
    }

    case "subagent_spawn":
      return (
        <box>
          <text fg={OneDarkPro.syntax.magenta}>⚡ {line.text}</text>
        </box>
      );

    case "subagent_complete":
      return (
        <box>
          <text fg={OneDarkPro.syntax.cyan}>✓ {line.text}</text>
        </box>
      );

    case "assistant":
      return (
        <box
          backgroundColor={OneDarkPro.background.highlight}
          padding={1}
          marginBottom={1}
        >
          <text fg={OneDarkPro.foreground.primary}>{line.text}</text>
        </box>
      );

    case "user":
      return (
        <box
          backgroundColor={OneDarkPro.background.secondary}
          padding={1}
          marginBottom={1}
        >
          <text fg={OneDarkPro.syntax.green}>{line.text}</text>
        </box>
      );

    case "system":
      return (
        <box marginBottom={1}>
          <text fg={OneDarkPro.foreground.comment}>💭 {line.text}</text>
        </box>
      );

    case "error":
    case "stderr":
      return (
        <box>
          <text fg={OneDarkPro.syntax.red}>✗ {line.text}</text>
        </box>
      );

    case "exit":
      // Only show exit status for non-zero exit codes (errors)
      if (line.exitCode !== 0) {
        return (
          <box>
            <text fg={OneDarkPro.syntax.red}>
              ✗ Exited with code {line.exitCode}
            </text>
          </box>
        );
      }
      // Don't render anything for successful completion
      return null;

    case "question":
      // Questions are handled by QuestionPanel, not inline
      return null;

    case "debug":
      return (
        <box>
          <text fg={OneDarkPro.foreground.comment}>
            [DEBUG] {line.debugInfo || line.text}
          </text>
        </box>
      );
    default:
      return (
        <box>
          <text fg={OneDarkPro.foreground.primary}>{line.text}</text>
        </box>
      );
  }
}
