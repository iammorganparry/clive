/**
 * One Dark Pro Theme
 * Ported from apps/tui-go/internal/tui/styles.go
 */

/**
 * ASCII Art CLIVE Logo
 * Display with OneDarkPro.syntax.red for brand consistency
 */
export const CLIVE_LOGO = `░█████╗░██╗░░░░░██╗██╗░░░██╗███████╗
██╔══██╗██║░░░░░██║██║░░░██║██╔════╝
██║░░╚═╝██║░░░░░██║╚██╗░██╔╝█████╗░░
██║░░██╗██║░░░░░██║░╚████╔╝░██╔══╝░░
╚█████╔╝███████╗██║░░╚██╔╝░░███████╗
░╚════╝░╚══════╝╚═╝░░░╚═╝░░░╚══════╝`;

export const CLIVE_LOGO_LINES = CLIVE_LOGO.split('\n');
export const CLIVE_LOGO_WIDTH = 36;
export const CLIVE_LOGO_HEIGHT = 6;

export const OneDarkPro = {
  background: {
    primary: "#282C34",
    secondary: "#21252B",
    highlight: "#2C313C",
  },
  foreground: {
    primary: "#ABB2BF",
    secondary: "#828997",
    muted: "#5C6370",
    comment: "#4B5263",
  },
  syntax: {
    red: "#E06C75",
    green: "#98C379",
    yellow: "#E5C07B",
    blue: "#61AFEF",
    magenta: "#C678DD",
    cyan: "#56B6C2",
    orange: "#D19A66",
  },
  ui: {
    border: "#3F4451",
  },
};

export const ComponentStyles = {
  header: {
    backgroundColor: OneDarkPro.background.secondary,
    color: OneDarkPro.syntax.blue,
    padding: 1,
  },

  sidebar: {
    backgroundColor: OneDarkPro.background.secondary,
    color: OneDarkPro.foreground.primary,
    borderColor: OneDarkPro.ui.border,
  },

  toolCall: {
    color: OneDarkPro.syntax.yellow,
    padding: 0,
  },

  toolResult: {
    color: OneDarkPro.foreground.muted,
    padding: 0,
  },

  assistant: {
    backgroundColor: OneDarkPro.background.highlight,
    color: OneDarkPro.syntax.blue,
    borderColor: OneDarkPro.syntax.blue,
    padding: 1,
  },

  error: {
    color: OneDarkPro.syntax.red,
  },

  success: {
    color: OneDarkPro.syntax.green,
  },

  output: {
    backgroundColor: OneDarkPro.background.primary,
    color: OneDarkPro.foreground.primary,
  },
};
