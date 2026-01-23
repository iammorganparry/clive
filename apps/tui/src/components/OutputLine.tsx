/**
 * OutputLine Component
 * Renders individual output lines with type-specific styling
 * Ported from apps/tui-go/internal/tui/root.go renderOutputContent
 */

import { OutputLine as OutputLineType } from '../types';
import { OneDarkPro } from '../styles/theme';
import { MetadataCalculator } from '../services/MetadataCalculator';

interface Props {
  line: OutputLineType;
}

export function OutputLine({ line }: Props) {
  switch (line.type) {
    case 'tool_call': {
      const toolInput = line.toolInput || {};

      // Read tool - show file path
      if (line.toolName === 'Read' && toolInput.file_path) {
        const filename = toolInput.file_path.split('/').pop() || toolInput.file_path;
        return (
          <box flexDirection="row">
            <text fg={OneDarkPro.syntax.yellow}>Read 📄 </text>
            <text fg={OneDarkPro.foreground.muted}>{filename}</text>
          </box>
        );
      }

      // Grep tool - show pattern and path
      if (line.toolName === 'Grep' && toolInput.pattern) {
        const path = toolInput.path || '.';
        const filename = path.split('/').pop() || path;
        return (
          <box flexDirection="row">
            <text fg={OneDarkPro.syntax.yellow}>Grep 🔍 "{toolInput.pattern}" in </text>
            <text fg={OneDarkPro.foreground.muted}>{filename}</text>
          </box>
        );
      }

      // Glob tool - show pattern
      if (line.toolName === 'Glob' && toolInput.pattern) {
        return (
          <box flexDirection="row">
            <text fg={OneDarkPro.syntax.yellow}>Glob 📁 </text>
            <text fg={OneDarkPro.foreground.muted}>{toolInput.pattern}</text>
          </box>
        );
      }

      // Bash tool - show command
      if (line.toolName === 'Bash' && toolInput.command) {
        return (
          <box flexDirection="row">
            <text fg={OneDarkPro.syntax.cyan}>Bash $ </text>
            <text fg={OneDarkPro.foreground.muted}>{toolInput.command}</text>
          </box>
        );
      }

      // Edit/Write tools - show file path
      if ((line.toolName === 'Edit' || line.toolName === 'Write') && toolInput.file_path) {
        const filename = toolInput.file_path.split('/').pop() || toolInput.file_path;
        return (
          <box flexDirection="row">
            <text fg={OneDarkPro.syntax.yellow}>{line.toolName} ✏️  </text>
            <text fg={OneDarkPro.foreground.muted}>{filename}</text>
          </box>
        );
      }

      // Default: show tool name
      return (
        <box>
          <text fg={OneDarkPro.syntax.yellow}>
            ● {line.toolName}
          </text>
        </box>
      );
    }

    case 'tool_result': {
      // Skip rendering tool results for Read/Grep/Glob/Bash tools
      const isFileReadTool = line.toolName === 'Read' || line.toolName === 'Grep' || line.toolName === 'Glob';
      const isBashTool = line.toolName === 'Bash';
      if (isFileReadTool || isBashTool) {
        return null;
      }

      // Truncate output for verbose tools
      let displayText = line.text;
      let wasTruncated = false;

      // Truncation limits per tool category
      const TRUNCATION_LIMITS: Record<string, number> = {
        // Web tools
        'WebSearch': 2000,
        'WebFetch': 1500,

        // MCP context tools (very verbose)
        'mcp__context7': 1500,
        'mcp__contextserver': 1500,

        // MCP Linear tools (JSON responses)
        'mcp__linear__create_issue': 800,
        'mcp__linear__update_issue': 800,
        'mcp__linear__create_project': 800,
        'mcp__linear__list_issues': 2000,
        'mcp__linear__get_issue': 1500,

        // MCP Playwright tools (page snapshots are huge)
        'mcp__playwright__browser_snapshot': 2000,
        'mcp__playwright__browser_console_messages': 1500,
        'mcp__playwright__browser_network_requests': 1500,

        // Default for any unspecified tool
        'DEFAULT': 3000,
      };

      if (displayText && displayText.length > 0) {
        // Get tool-specific limit or default
        const toolName = line.toolName || '';
        const maxChars = TRUNCATION_LIMITS[toolName] || TRUNCATION_LIMITS['DEFAULT'];

        // Truncate if exceeds limit
        if (displayText.length > maxChars) {
          displayText = displayText.slice(0, maxChars);
          wasTruncated = true;
        }
      }

      // Build metadata display
      const metadata: string[] = [];

      if (line.duration) {
        metadata.push(`⏱️  ${MetadataCalculator.formatDuration(line.duration)}`);
      }

      if (line.inputTokens || line.outputTokens) {
        const tokens = MetadataCalculator.formatTokens(line.inputTokens, line.outputTokens);
        if (tokens) {
          metadata.push(`🪙 ${tokens}`);
        }
      }

      if (line.costUSD !== undefined) {
        const costColor = MetadataCalculator.getCostColor(line.costUSD);
        const costText = MetadataCalculator.formatCost(line.costUSD);
        metadata.push(`💰 ${costText}`);
      }

      return (
        <box flexDirection="column">
          <text fg={OneDarkPro.foreground.muted}>
            ↳ {displayText}
            {metadata.length > 0 ? ` ${metadata.join(' ')}` : ''}
          </text>
          {wasTruncated && (
            <text fg={OneDarkPro.foreground.comment}>
              ... (output truncated, check logs for full output)
            </text>
          )}
        </box>
      );
    }

    case 'file_diff': {
      // Split diff into lines and color appropriately
      const diffLines = line.text.split('\n');
      return (
        <box flexDirection="column">
          {diffLines.map((diffLine, i) => {
            let color = OneDarkPro.foreground.muted;

            // Color based on diff prefix
            if (diffLine.includes(' + ') || diffLine.startsWith('  + ')) {
              color = OneDarkPro.syntax.green;
            } else if (diffLine.includes(' - ') || diffLine.startsWith('  - ')) {
              color = OneDarkPro.syntax.red;
            } else if (diffLine.startsWith('● ')) {
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

    case 'subagent_spawn':
      return (
        <box>
          <text fg={OneDarkPro.syntax.magenta}>
            ⚡ {line.text}
          </text>
        </box>
      );

    case 'subagent_complete':
      return (
        <box>
          <text fg={OneDarkPro.syntax.cyan}>
            ✓ {line.text}
          </text>
        </box>
      );

    case 'assistant':
      return (
        <box backgroundColor={OneDarkPro.background.highlight} padding={1} marginBottom={1}>
          <text fg={OneDarkPro.foreground.primary}>
            {line.text}
          </text>
        </box>
      );

    case 'user':
      return (
        <box
          backgroundColor={OneDarkPro.background.secondary}
          padding={1}
          marginBottom={1}
        >
          <text fg={OneDarkPro.syntax.green}>
            {line.text}
          </text>
        </box>
      );

    case 'system':
      return (
        <box marginBottom={1}>
          <text fg={OneDarkPro.foreground.comment}>
            💭 {line.text}
          </text>
        </box>
      );

    case 'error':
    case 'stderr':
      return (
        <box>
          <text fg={OneDarkPro.syntax.red}>
            ✗ {line.text}
          </text>
        </box>
      );

    case 'exit':
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

    case 'question':
      // Questions are handled by QuestionPanel, not inline
      return null;

    case 'debug':
      return (
        <box>
          <text fg={OneDarkPro.foreground.comment}>
            [DEBUG] {line.debugInfo || line.text}
          </text>
        </box>
      );

    case 'stdout':
    default:
      return (
        <box>
          <text fg={OneDarkPro.foreground.primary}>
            {line.text}
          </text>
        </box>
      );
  }
}
