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
    case 'tool_call':
      return (
        <box>
          <text fg={OneDarkPro.syntax.yellow}>
            ● {line.toolName}
          </text>
        </box>
      );

    case 'tool_result': {
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
            {metadata.length > 0 && ` ${metadata.join(' ')}`}
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
              <text key={i} color={color}>
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
        <box
          backgroundColor={OneDarkPro.background.highlight}
          // borderStyle causes Bun FFI crash - removed
          // borderColor={OneDarkPro.syntax.blue}
          padding={1}
        >
          <text fg={OneDarkPro.syntax.blue}>
            {line.text}
          </text>
        </box>
      );

    case 'system':
      return (
        <box>
          <text fg={OneDarkPro.foreground.comment} dimColor>
            💭 {line.text}
          </text>
        </box>
      );

    case 'error':
    case 'stderr':
      return (
        <box>
          <text fg={OneDarkPro.syntax.red} bold>
            ✗ {line.text}
          </text>
        </box>
      );

    case 'exit':
      return (
        <box>
          <text fg={OneDarkPro.syntax.green}>
            {line.exitCode === 0 ? '✓ Completed' : `✗ Exited with code ${line.exitCode}`}
          </text>
        </box>
      );

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
