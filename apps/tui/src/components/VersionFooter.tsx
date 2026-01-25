/**
 * VersionFooter Component
 * Shows version info at the bottom of the screen
 */

import { OneDarkPro } from "../styles/theme";

interface VersionFooterProps {
  width: number;
  height: number;
}

export function VersionFooter({ width, height }: VersionFooterProps) {
  // Load version from package.json
  let version = "v1.0.0";
  try {
    const pkg = require("../../package.json");
    version = `v${pkg.version}`;
  } catch {
    // Fallback to default if package.json not found
  }

  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.primary}
      paddingLeft={1}
      alignItems="center"
    >
      <text fg={OneDarkPro.foreground.comment}>
        Clive TUI {version} • Built with OpenTUI/React
      </text>
    </box>
  );
}
