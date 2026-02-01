/**
 * HelpView Component
 * Shows keyboard shortcuts and commands
 */

import { Logo } from "./Logo";
import { OneDarkPro } from "../styles/theme";

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
        {/* Logo */}
        <Logo />

        {/* Title */}
        <text fg={OneDarkPro.syntax.blue} marginTop={1}>
          Keyboard Shortcuts
        </text>

        {/* Shortcuts */}
        <box marginTop={2} flexDirection="column">
          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow}>
              <b>?{" "}</b>
            </text>
            <text fg={OneDarkPro.foreground.secondary}>Toggle help</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow}>
              <b>b{" "}</b>
            </text>
            <text fg={OneDarkPro.foreground.secondary}>Start build</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow}>
              <b>c{" "}</b>
            </text>
            <text fg={OneDarkPro.foreground.secondary}>Cancel build</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow}>
              <b>r{" "}</b>
            </text>
            <text fg={OneDarkPro.foreground.secondary}>Refresh status</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow}>
              <b>n{" "}</b>
            </text>
            <text fg={OneDarkPro.foreground.secondary}>New session</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow}>
              <b>↑/k{" "}</b>
            </text>
            <text fg={OneDarkPro.foreground.secondary}>Scroll up</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow}>
              <b>↓/j{" "}</b>
            </text>
            <text fg={OneDarkPro.foreground.secondary}>Scroll down</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow}>
              <b>Esc{" "}</b>
            </text>
            <text fg={OneDarkPro.foreground.secondary}>Back/unfocus</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.yellow}>
              <b>q{" "}</b>
            </text>
            <text fg={OneDarkPro.foreground.secondary}>Quit</text>
          </text>
        </box>

        {/* Mode Commands */}
        <box marginTop={3} flexDirection="column">
          <text fg={OneDarkPro.syntax.green}>
            <b>Mode Commands:</b>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.cyan}>/plan</text>
            <text fg={OneDarkPro.foreground.secondary}>
              {" "}
              Enter plan mode (blue border)
            </text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.cyan}>/build</text>
            <text fg={OneDarkPro.foreground.secondary}>
              {" "}
              Enter build mode (orange border)
            </text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.cyan}>/exit</text>
            <text fg={OneDarkPro.foreground.secondary}> Exit current mode</text>
          </text>
        </box>

        {/* Planning Workflow */}
        <box marginTop={3} flexDirection="column">
          <text fg={OneDarkPro.syntax.magenta}>
            <b>Planning Workflow:</b>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.foreground.muted}>1. </text>
            <text fg={OneDarkPro.foreground.secondary}>
              Agent asks clarifying questions
            </text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.foreground.muted}>2. </text>
            <text fg={OneDarkPro.foreground.secondary}>
              Explores codebase patterns
            </text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.foreground.muted}>3. </text>
            <text fg={OneDarkPro.foreground.secondary}>
              Asks technical approach questions
            </text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.foreground.muted}>4. </text>
            <text fg={OneDarkPro.foreground.secondary}>
              Proposes detailed plan
            </text>
          </text>
        </box>

        {/* Mode Behavior */}
        <box marginTop={2} flexDirection="column" paddingLeft={2}>
          <text fg={OneDarkPro.foreground.muted}>
            • In a mode, regular messages go to the agent
          </text>
          <text fg={OneDarkPro.foreground.muted}>
            • Border shows mode: blue=plan, orange=build
          </text>
          <text fg={OneDarkPro.foreground.muted}>
            • Mode persists across messages until /exit
          </text>
          <text fg={OneDarkPro.foreground.muted}>
            • Use multi-choice prompts to answer questions
          </text>
        </box>

        {/* Other Commands */}
        <box marginTop={3} flexDirection="column">
          <text fg={OneDarkPro.syntax.green}>
            <b>Other Commands:</b>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.cyan}>/clear</text>
            <text fg={OneDarkPro.foreground.secondary}> Clear output</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.cyan}>/cancel</text>
            <text fg={OneDarkPro.foreground.secondary}> Stop execution</text>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.cyan}>/help</text>
            <text fg={OneDarkPro.foreground.secondary}> Show this help</text>
          </text>
        </box>

        {/* Debug info */}
        <box marginTop={3} flexDirection="column">
          <text fg={OneDarkPro.syntax.green}>
            <b>Troubleshooting:</b>
          </text>

          <text fg={OneDarkPro.foreground.primary}>
            <text fg={OneDarkPro.syntax.cyan}>clive --debug</text>
            <text fg={OneDarkPro.foreground.secondary}>
              {" "}
              Enable debug logging
            </text>
          </text>

          <text fg={OneDarkPro.foreground.muted}>
            Debug logs: ~/.clive/tui-debug.log
          </text>
        </box>

        {/* Close hint */}
        <box marginTop={2}>
          <text fg={OneDarkPro.foreground.muted}>Press ? or Esc to close</text>
        </box>
      </box>
    </box>
  );
}
