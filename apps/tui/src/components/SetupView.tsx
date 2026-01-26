/**
 * SetupView Component
 * First-time setup for issue tracker configuration
 * Flow: Tracker Selection -> Configuration -> Save
 */

import { Logo } from "./Logo";
import { OneDarkPro } from "../styles/theme";
import type { IssueTrackerConfig } from "../types/views";

interface SetupViewProps {
  width: number;
  height: number;
  onComplete: (config: IssueTrackerConfig) => void;
  onCancel: () => void;
  selectedIndex: number;
  onNavigate: (index: number) => void;
}

export function SetupView({
  width,
  height,
  onComplete,
  onCancel,
  selectedIndex,
  onNavigate,
}: SetupViewProps) {
  const options = [
    {
      id: "linear",
      name: "Linear",
      description: "(Recommended for teams)",
      color: OneDarkPro.syntax.blue,
    },
    {
      id: "beads",
      name: "Beads",
      description: "(Local issue tracking)",
      color: OneDarkPro.syntax.green,
    },
  ];

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
        {/* Logo */}
        <Logo />
        <text fg={OneDarkPro.foreground.muted} marginTop={1}>
          Issue Tracker Setup
        </text>

        <text fg={OneDarkPro.foreground.secondary} marginTop={2}>
          Configure your issue tracker integration
        </text>

        {/* Options */}
        <box marginTop={4} flexDirection="column" width={60}>
          <text fg={OneDarkPro.foreground.primary} marginBottom={2}>
            Select your issue tracker:
          </text>

          {options.map((option, i) => {
            const isSelected = i === selectedIndex;
            return (
              <box
                key={option.id}
                backgroundColor={
                  isSelected
                    ? OneDarkPro.background.highlight
                    : OneDarkPro.background.secondary
                }
                padding={1}
                marginBottom={1}
              >
                <text fg={option.color} bold={isSelected}>
                  {isSelected ? "▸ " : "  "}
                  {option.name}
                </text>
                <text fg={OneDarkPro.foreground.muted}>
                  {"  "}
                  {option.description}
                </text>
              </box>
            );
          })}
        </box>

        {/* Instructions */}
        <box marginTop={4} flexDirection="column" alignItems="center">
          <text fg={OneDarkPro.foreground.muted}>
            Linear: Cloud-based team issue tracking
          </text>
          <text fg={OneDarkPro.foreground.muted} marginTop={1}>
            Beads: Local git-based issue tracking
          </text>
        </box>

        {/* Shortcuts */}
        <box marginTop={4} flexDirection="column" alignItems="center">
          <text fg={OneDarkPro.foreground.secondary}>
            1-{options.length} Select • ↑/↓ Navigate • Enter Confirm • Esc Quit
          </text>
        </box>
      </box>
    </box>
  );
}
