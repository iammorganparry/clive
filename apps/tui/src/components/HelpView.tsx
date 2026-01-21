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
        <text fg={OneDarkPro.syntax.blue} bold>
          Keyboard Shortcuts
        </text>

        {/* Shortcuts */}
        <box marginTop={2} flexDirection="column">
          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow} bold>?      </text>
            <text fg={OneDarkPro.foreground.secondary}>Toggle help</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow} bold>b      </text>
            <text fg={OneDarkPro.foreground.secondary}>Start build</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow} bold>c      </text>
            <text fg={OneDarkPro.foreground.secondary}>Cancel build</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow} bold>r      </text>
            <text fg={OneDarkPro.foreground.secondary}>Refresh status</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow} bold>n      </text>
            <text fg={OneDarkPro.foreground.secondary}>New session</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow} bold>↑/k    </text>
            <text fg={OneDarkPro.foreground.secondary}>Scroll up</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow} bold>↓/j    </text>
            <text fg={OneDarkPro.foreground.secondary}>Scroll down</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow} bold>Esc    </text>
            <text fg={OneDarkPro.foreground.secondary}>Back/unfocus</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow} bold>q      </text>
            <text fg={OneDarkPro.foreground.secondary}>Quit</text>
          </text>
        </box>

        {/* Commands */}
        <box marginTop={3} flexDirection="column">
          <text fg={OneDarkPro.syntax.green} bold>
            Commands:
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.cyan}>/plan</text>
            <text fg={OneDarkPro.foreground.secondary}>   Create a plan</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.cyan}>/build</text>
            <text fg={OneDarkPro.foreground.secondary}>  Execute a task</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.cyan}>/clear</text>
            <text fg={OneDarkPro.foreground.secondary}>  Clear output</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.cyan}>/cancel</text>
            <text fg={OneDarkPro.foreground.secondary}> Stop execution</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.cyan}>/help</text>
            <text fg={OneDarkPro.foreground.secondary}>   Show this help</text>
          </text>
        </box>

        {/* Close hint */}
        <box marginTop={3}>
          <text fg={OneDarkPro.foreground.muted}>
            Press ? or Esc to close
          </text>
        </box>
      </box>
    </box>
  );
}
