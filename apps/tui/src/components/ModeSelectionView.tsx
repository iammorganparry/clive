/**
 * ModeSelectionView Component
 * Allows users to choose between Worker Mode and Interactive Mode
 * Worker Mode: Receives and processes Slack interview requests
 * Interactive Mode: Full TUI experience with issue tracking
 */

import { Logo } from "./Logo";
import { OneDarkPro } from "../styles/theme";

interface ModeSelectionViewProps {
  width: number;
  height: number;
  selectedIndex: number;
  onNavigate: (index: number) => void;
  onSelectWorker: () => void;
  onSelectInteractive: () => void;
  onSelectLinearSettings?: () => void;
  /** Whether worker config exists and is enabled */
  workerConfigured?: boolean;
  /** Whether Linear is configured (show settings option) */
  linearConfigured?: boolean;
}

export function ModeSelectionView({
  width,
  height,
  selectedIndex,
  onNavigate,
  onSelectWorker,
  onSelectInteractive,
  onSelectLinearSettings,
  workerConfigured = false,
  linearConfigured = false,
}: ModeSelectionViewProps) {
  const baseOptions = [
    {
      id: "interactive",
      name: "Interactive Mode",
      description: "Full TUI with issue tracking and planning",
      detail: "Browse issues, resume conversations, plan features locally",
      icon: "> ",
      color: OneDarkPro.syntax.blue,
    },
    {
      id: "worker",
      name: "Worker Mode",
      description: workerConfigured
        ? "Connect to Slack as a worker"
        : "Set up Slack worker connection",
      detail: workerConfigured
        ? "Receive @clive mentions and process requests from Slack"
        : "Configure connection to central Slack service",
      icon: "< ",
      color: OneDarkPro.syntax.green,
    },
  ];

  // Add Linear Settings option if Linear is configured
  const options = linearConfigured
    ? [
        ...baseOptions,
        {
          id: "linear_settings",
          name: "Linear Settings",
          description: "Edit Linear API key and team",
          detail: "Update your Linear integration configuration",
          icon: "* ",
          color: OneDarkPro.syntax.yellow,
        },
      ]
    : baseOptions;

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
          Select Mode
        </text>

        <text fg={OneDarkPro.foreground.secondary} marginTop={2}>
          How would you like to use Clive?
        </text>

        {/* Options */}
        <box marginTop={4} flexDirection="column" width={70}>
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
                padding={2}
                marginBottom={2}
                borderStyle={isSelected ? "rounded" : undefined}
                borderColor={isSelected ? option.color : undefined}
              >
                <box flexDirection="row" alignItems="center">
                  <text fg={option.color}>
                    {isSelected ? (
                      <b>{option.icon}{option.name}</b>
                    ) : (
                      <>{"  "}{option.name}</>
                    )}
                  </text>
                </box>
                <text fg={OneDarkPro.foreground.primary} marginTop={1}>
                  {option.description}
                </text>
                <text fg={OneDarkPro.foreground.muted} marginTop={1}>
                  {option.detail}
                </text>
              </box>
            );
          })}
        </box>

        {/* Worker status indicator */}
        {workerConfigured && (
          <box
            marginTop={2}
            padding={1}
            backgroundColor={OneDarkPro.background.secondary}
          >
            <text fg={OneDarkPro.syntax.green}>
              Worker connection configured
            </text>
          </box>
        )}

        {/* Shortcuts */}
        <box marginTop={4} flexDirection="column" alignItems="center">
          <text fg={OneDarkPro.foreground.secondary}>
            1-{options.length} Select | Up/Down Navigate | Enter Confirm | Esc
            Back
          </text>
        </box>
      </box>
    </box>
  );
}
