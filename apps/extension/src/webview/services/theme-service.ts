/**
 * Theme service for detecting and applying VS Code theme to webview
 */

export interface ThemeInfo {
  colorScheme: "light" | "dark";
}

/**
 * Detects VS Code theme color scheme from CSS variables
 */
function detectColorScheme(): "light" | "dark" {
  // VS Code provides --vscode-editor-background which we can use to detect theme
  // Dark themes typically have darker backgrounds
  const bgColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--vscode-editor-background")
    .trim();

  if (!bgColor) {
    // Fallback: check if body has dark background
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    if (bodyBg) {
      // Parse RGB and check if it's dark (sum < 382.5 for RGB 0-255)
      const rgb = bodyBg.match(/\d+/g);
      if (rgb && rgb.length >= 3) {
        const sum =
          parseInt(rgb[0], 10) + parseInt(rgb[1], 10) + parseInt(rgb[2], 10);
        return sum < 382.5 ? "dark" : "light";
      }
    }
    return "light"; // Default to light
  }

  // Check if background color is dark by parsing RGB values
  // VS Code CSS variables are typically in hex or rgb format
  // For simplicity, we'll use a heuristic: if the color string contains low values, it's dark
  const lowerBg = bgColor.toLowerCase();
  if (
    lowerBg.includes("rgb") ||
    lowerBg.includes("hsl") ||
    lowerBg.includes("#")
  ) {
    // Try to extract numeric values
    const matches = bgColor.match(/\d+/g);
    if (matches && matches.length >= 3) {
      const r = parseInt(matches[0], 10);
      const g = parseInt(matches[1], 10);
      const b = parseInt(matches[2], 10);
      // Calculate luminance approximation
      const luminance = (r * 299 + g * 587 + b * 114) / 1000;
      return luminance < 128 ? "dark" : "light";
    }
  }

  // Fallback: check if VS Code has set a specific variable
  const themeKind = getComputedStyle(document.documentElement)
    .getPropertyValue("--vscode-color-theme-kind")
    .trim();
  if (themeKind === "dark" || themeKind === "light") {
    return themeKind;
  }

  return "light"; // Default fallback
}

/**
 * Maps VS Code CSS variables to shadcn CSS variables
 */
function mapVSCodeToShadcnVariables(): void {
  const root = document.documentElement;

  // Get VS Code CSS variables
  const vscodeBg = getComputedStyle(root)
    .getPropertyValue("--vscode-editor-background")
    .trim();
  const vscodeFg = getComputedStyle(root)
    .getPropertyValue("--vscode-foreground")
    .trim();
  const vscodeButtonBg = getComputedStyle(root)
    .getPropertyValue("--vscode-button-background")
    .trim();
  const vscodeButtonFg = getComputedStyle(root)
    .getPropertyValue("--vscode-button-foreground")
    .trim();
  const vscodeInputBg = getComputedStyle(root)
    .getPropertyValue("--vscode-input-background")
    .trim();
  const vscodeInputBorder = getComputedStyle(root)
    .getPropertyValue("--vscode-input-border")
    .trim();
  const vscodePanelBorder = getComputedStyle(root)
    .getPropertyValue("--vscode-panel-border")
    .trim();
  const vscodeDescFg = getComputedStyle(root)
    .getPropertyValue("--vscode-descriptionForeground")
    .trim();
  const vscodeErrorFg = getComputedStyle(root)
    .getPropertyValue("--vscode-errorForeground")
    .trim();
  const vscodeSidebarBg = getComputedStyle(root)
    .getPropertyValue("--vscode-sideBar-background")
    .trim();

  // Map to shadcn variables dynamically
  if (vscodeBg) {
    root.style.setProperty("--background", vscodeBg);
    root.style.setProperty("--card", vscodeBg);
    root.style.setProperty("--popover", vscodeBg);
  }
  if (vscodeFg) {
    root.style.setProperty("--foreground", vscodeFg);
    root.style.setProperty("--card-foreground", vscodeFg);
    root.style.setProperty("--popover-foreground", vscodeFg);
  }
  if (vscodeButtonBg) {
    root.style.setProperty("--primary", vscodeButtonBg);
  }
  if (vscodeButtonFg) {
    root.style.setProperty("--primary-foreground", vscodeButtonFg);
  }
  if (vscodeInputBg) {
    root.style.setProperty("--input", vscodeInputBg);
  }
  if (vscodeInputBorder || vscodePanelBorder) {
    const border = vscodeInputBorder || vscodePanelBorder;
    root.style.setProperty("--border", border);
    root.style.setProperty("--ring", border);
  }
  if (vscodeDescFg) {
    root.style.setProperty("--muted-foreground", vscodeDescFg);
    root.style.setProperty("--secondary-foreground", vscodeDescFg);
  }
  if (vscodeErrorFg) {
    root.style.setProperty("--destructive", vscodeErrorFg);
  }
  if (vscodeSidebarBg) {
    root.style.setProperty("--muted", vscodeSidebarBg);
    root.style.setProperty("--secondary", vscodeSidebarBg);
    root.style.setProperty("--accent", vscodeSidebarBg);
  }

  // Set accent foreground
  if (vscodeFg) {
    root.style.setProperty("--accent-foreground", vscodeFg);
  }
}

/**
 * Applies theme to document
 */
function applyTheme(colorScheme: "light" | "dark"): void {
  const root = document.documentElement;

  // Apply dark mode class
  if (colorScheme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  // Map VS Code variables to shadcn variables
  mapVSCodeToShadcnVariables();
}

/**
 * Initializes theme service
 */
export function initializeTheme(themeInfo?: ThemeInfo): void {
  const colorScheme = themeInfo?.colorScheme || detectColorScheme();
  applyTheme(colorScheme);
}

/**
 * Updates theme when VS Code theme changes
 */
export function updateTheme(themeInfo: ThemeInfo): void {
  applyTheme(themeInfo.colorScheme);
}

/**
 * Gets current theme info
 */
export function getCurrentTheme(): ThemeInfo {
  return {
    colorScheme: detectColorScheme(),
  };
}
