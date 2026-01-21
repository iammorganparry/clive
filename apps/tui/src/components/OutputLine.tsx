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
          <box>
            <text fg={OneDarkPro.syntax.yellow}>
              Read 📄 {filename}
            </text>
          </box>
        );
      }

      // Grep tool - show pattern and path
      if (line.toolName === 'Grep' && toolInput.pattern) {
        const path = toolInput.path || '.';
        const filename = path.split('/').pop() || path;
        return (
          <box>
            <text fg={OneDarkPro.syntax.yellow}>
              Grep 🔍 "{toolInput.pattern}" in {filename}
            </text>
          </box>
        );
      }

      // Glob tool - show pattern
      if (line.toolName === 'Glob' && toolInput.pattern) {
        return (
          <box>
            <text fg={OneDarkPro.syntax.yellow}>
              Glob 📁 {toolInput.pattern}
            </text>
          </box>
        );
      }

      // Bash tool - show command
      if (line.toolName === 'Bash' && toolInput.command) {
        return (
          <box>
            <text fg={OneDarkPro.syntax.cyan}>
              Bash $ {toolInput.command}
            </text>
          </box>
        );
      }

      // Edit/Write tools - show file path
      if ((line.toolName === 'Edit' || line.toolName === 'Write') && toolInput.file_path) {
        const filename = toolInput.file_path.split('/').pop() || toolInput.file_path;
        return (
          <box>
            <text fg={OneDarkPro.syntax.yellow}>
              {line.toolName} ✏️  {filename}
            </text>
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
        <box>
          <text fg={OneDarkPro.foreground.muted}>
            ↳ {line.text}
            {metadata.length > 0 ? ` ${metadata.join(' ')}` : ''}
          </text>
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
        <box flexDirection="row" backgroundColor={OneDarkPro.background.highlight}>
          <box paddingLeft={1} paddingRight={1}>
            <text fg={OneDarkPro.syntax.blue}>█</text>
          </box>
          <box padding={1} flexGrow={1}>
            <text fg={OneDarkPro.foreground.primary}>
              {line.text}
            </text>
          </box>
        </box>
      );

    case 'user':
      return (
        <box
          backgroundColor={OneDarkPro.background.secondary}
          padding={1}
        >
          <text fg={OneDarkPro.syntax.green}>
            {line.text}
          </text>
        </box>
      );

    case 'system':
      return (
        <box>
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
