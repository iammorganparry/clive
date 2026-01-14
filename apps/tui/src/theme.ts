import React, { createContext, useContext } from "react";

/**
 * One Dark Pro color palette - VS Code's iconic dark theme
 */
export const oneDarkPro = {
  // Backgrounds
  bg: {
    primary: "#282C34", // Main content area
    secondary: "#21252B", // Sidebar, panels
    tertiary: "#181A1F", // Nested containers
    highlight: "#2C313C", // Line highlight, hover
  },

  // Foreground
  fg: {
    primary: "#ABB2BF", // Main text
    secondary: "#9DA5B4", // Secondary text
    muted: "#636B78", // Line numbers, hints
    comment: "#7F848E", // Comments, disabled
  },

  // Syntax colors
  syntax: {
    red: "#E06C75", // Errors, blocked
    green: "#98C379", // Success, complete
    yellow: "#E5C07B", // Warnings, in progress
    blue: "#61AFEF", // Links, accent
    magenta: "#C678DD", // Keywords
    cyan: "#56B6C2", // Strings, info
    orange: "#D19A66", // Numbers, pending
  },

  // Status
  status: {
    error: "#C24038",
    warning: "#D19A66",
    info: "#61AFEF",
    success: "#109868",
  },

  // UI
  ui: {
    border: "#3F4451",
    selection: "#67769660",
    cursor: "#528BFF",
    badge: "#4D78CC",
  },
} as const;

export type Theme = typeof oneDarkPro;

// Theme context
const ThemeContext = createContext<Theme>(oneDarkPro);

// Hook to access theme
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

// Export the context for the provider
export { ThemeContext };
