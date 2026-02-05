/**
 * ModeIndicator Component
 * Inline badge showing current mode (PLAN/BUILD/REVIEW) with color coding.
 * Displayed in the input area before the prompt character.
 */

import { OneDarkPro } from "../styles/theme";

interface ModeIndicatorProps {
  mode: "none" | "plan" | "build" | "review";
}

function getModeConfig(mode: ModeIndicatorProps["mode"]): {
  label: string;
  color: string;
} | null {
  switch (mode) {
    case "plan":
      return { label: "PLAN", color: "#3B82F6" };
    case "build":
      return { label: "BUILD", color: "#F59E0B" };
    case "review":
      return { label: "REVIEW", color: "#10B981" };
    default:
      return null;
  }
}

export function ModeIndicator({ mode }: ModeIndicatorProps) {
  const config = getModeConfig(mode);

  if (!config) {
    return (
      <text fg={OneDarkPro.foreground.comment}>{"⇧Tab:mode "}</text>
    );
  }

  return (
    <text fg={config.color} bold>
      {`[${config.label}] `}
    </text>
  );
}
