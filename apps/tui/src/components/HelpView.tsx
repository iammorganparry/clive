/**
 * HelpView Component
 * Shows keyboard shortcuts and commands
 */

import { OneDarkPro } from '../styles/theme';

interface HelpViewProps {
  width: number;
  height: number;
  onClose: () => void;
}

export function HelpView({ width, height, onClose }: HelpViewProps) {
  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.primary}
      alignItems="center"
      justifyContent="center"
    >
      <box
        backgroundColor={OneDarkPro.background.secondary}
        padding={2}
        flexDirection="column"
        alignItems="center"
      >
        {/* Title */}
        <text color={OneDarkPro.syntax.blue} bold>
          Keyboard Shortcuts
        </text>

        {/* Shortcuts */}
        <box marginTop={2} flexDirection="column">
          <text color={OneDarkPro.foreground.primary}>
            <text color={OneDarkPro.syntax.yellow} bold>?      </text>
            <text color={OneDarkPro.foreground.secondary}>Toggle help</text>
          </text>

          <text color={OneDarkPro.foreground.primary}>
            <text color={OneDarkPro.syntax.yellow} bold>b      </text>
            <text color={OneDarkPro.foreground.secondary}>Start build</text>
          </text>

          <text color={OneDarkPro.foreground.primary}>
            <text color={OneDarkPro.syntax.yellow} bold>c      </text>
            <text color={OneDarkPro.foreground.secondary}>Cancel build</text>
          </text>

          <text color={OneDarkPro.foreground.primary}>
            <text color={OneDarkPro.syntax.yellow} bold>r      </text>
            <text color={OneDarkPro.foreground.secondary}>Refresh status</text>
          </text>

          <text color={OneDarkPro.foreground.primary}>
            <text color={OneDarkPro.syntax.yellow} bold>n      </text>
            <text color={OneDarkPro.foreground.secondary}>New session</text>
          </text>

          <text color={OneDarkPro.foreground.primary}>
            <text color={OneDarkPro.syntax.yellow} bold>↑/k    </text>
            <text color={OneDarkPro.foreground.secondary}>Scroll up</text>
          </text>

          <text color={OneDarkPro.foreground.primary}>
            <text color={OneDarkPro.syntax.yellow} bold>↓/j    </text>
            <text color={OneDarkPro.foreground.secondary}>Scroll down</text>
          </text>

          <text color={OneDarkPro.foreground.primary}>
            <text color={OneDarkPro.syntax.yellow} bold>Esc    </text>
            <text color={OneDarkPro.foreground.secondary}>Back/unfocus</text>
          </text>

          <text color={OneDarkPro.foreground.primary}>
            <text color={OneDarkPro.syntax.yellow} bold>q      </text>
            <text color={OneDarkPro.foreground.secondary}>Quit</text>
          </text>
        </box>

        {/* Commands */}
        <box marginTop={3} flexDirection="column">
          <text color={OneDarkPro.syntax.green} bold>
            Commands:
          </text>

          <text color={OneDarkPro.foreground.primary}>
            <text color={OneDarkPro.syntax.cyan}>/plan</text>
            <text color={OneDarkPro.foreground.secondary}>   Create a plan</text>
          </text>

          <text color={OneDarkPro.foreground.primary}>
            <text color={OneDarkPro.syntax.cyan}>/build</text>
            <text color={OneDarkPro.foreground.secondary}>  Execute a task</text>
          </text>

          <text color={OneDarkPro.foreground.primary}>
            <text color={OneDarkPro.syntax.cyan}>/clear</text>
            <text color={OneDarkPro.foreground.secondary}>  Clear output</text>
          </text>

          <text color={OneDarkPro.foreground.primary}>
            <text color={OneDarkPro.syntax.cyan}>/cancel</text>
            <text color={OneDarkPro.foreground.secondary}> Stop execution</text>
          </text>

          <text color={OneDarkPro.foreground.primary}>
            <text color={OneDarkPro.syntax.cyan}>/help</text>
            <text color={OneDarkPro.foreground.secondary}>   Show this help</text>
          </text>
        </box>

        {/* Close hint */}
        <box marginTop={3}>
          <text color={OneDarkPro.foreground.muted}>
            Press ? or Esc to close
          </text>
        </box>
      </box>
    </box>
  );
}
