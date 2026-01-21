/**
 * SetupView Component
 * First-time setup for issue tracker configuration
 * Flow: Tracker Selection -> Configuration -> Save
 */

import { OneDarkPro } from '../styles/theme';
import { IssueTrackerConfig } from '../types/views';

interface SetupViewProps {
  width: number;
  height: number;
  onComplete: (config: IssueTrackerConfig) => void;
  onCancel: () => void;
}

export function SetupView({ width, height, onComplete, onCancel }: SetupViewProps) {
  // For now, show a simple message
  // TODO: Implement full setup flow with forms

  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.primary}
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
    >
      <box flexDirection="column" alignItems="center">
        <text color={OneDarkPro.syntax.blue} bold>
          🚀 Welcome to Clive TUI
        </text>

        <text color={OneDarkPro.foreground.secondary} marginTop={2}>
          First-time setup required
        </text>

        <box marginTop={3} flexDirection="column">
          <text color={OneDarkPro.foreground.primary}>
            Select your issue tracker:
          </text>
          <text color={OneDarkPro.foreground.muted} marginTop={1}>
            1. Linear (requires API key)
          </text>
          <text color={OneDarkPro.foreground.muted}>
            2. GitHub (requires token)
          </text>
          <text color={OneDarkPro.foreground.muted} marginTop={1}>
            3. Skip setup (chat mode only)
          </text>
        </box>

        <box marginTop={4} flexDirection="column" alignItems="center">
          <text color={OneDarkPro.syntax.yellow}>
            ⚠️  Setup UI under construction
          </text>
          <text color={OneDarkPro.foreground.secondary} marginTop={1}>
            For now, manually configure ~/.clive/config.json
          </text>
          <text color={OneDarkPro.foreground.muted} marginTop={2}>
            Press 's' to skip and use chat-only mode
          </text>
          <text color={OneDarkPro.foreground.muted}>
            Press 'q' to quit
          </text>
        </box>

        <box marginTop={4}>
          <text color={OneDarkPro.syntax.magenta}>
            [Coming Soon: Interactive Setup Flow]
          </text>
        </box>
      </box>
    </box>
  );
}
