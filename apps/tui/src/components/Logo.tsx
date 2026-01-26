/**
 * CLIVE ASCII Art Logo Component
 * Displays the brand logo in red
 */

import { CLIVE_LOGO_LINES, OneDarkPro } from "../styles/theme";

interface LogoProps {
  /** Center the logo horizontally within this width */
  width?: number;
}

export function Logo({ width }: LogoProps) {
  return (
    <box flexDirection="column" alignItems={width ? "center" : "flex-start"} width={width}>
      {CLIVE_LOGO_LINES.map((line, index) => (
        <text key={index} fg={OneDarkPro.syntax.red}>
          {line}
        </text>
      ))}
    </box>
  );
}
