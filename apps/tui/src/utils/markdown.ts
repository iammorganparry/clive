/**
 * Markdown rendering utility using Glow (charmbracelet/glow)
 * Falls back to plain text if glow is not available
 */

import { execSync, spawnSync } from "node:child_process";

// Cache glow availability check
let glowAvailable: boolean | null = null;

/**
 * Check if glow CLI is installed and available
 */
export function isGlowAvailable(): boolean {
  if (glowAvailable !== null) return glowAvailable;

  try {
    const result = spawnSync("which", ["glow"], {
      encoding: "utf-8",
      timeout: 1000,
    });
    glowAvailable = result.status === 0;
  } catch {
    glowAvailable = false;
  }

  return glowAvailable;
}

/**
 * Render markdown using glow CLI
 * Returns the rendered terminal output or null if glow is not available
 */
export function renderMarkdown(markdown: string): string | null {
  if (!isGlowAvailable()) return null;
  if (!markdown.trim()) return null;

  try {
    // Use glow with pager disabled and specific style
    // -s auto uses automatic style based on terminal
    const result = execSync("glow -s auto -w 80", {
      input: markdown,
      encoding: "utf-8",
      timeout: 5000,
      maxBuffer: 1024 * 1024, // 1MB
    });

    return result;
  } catch {
    // If glow fails, return null to use fallback
    return null;
  }
}

/**
 * Split rendered glow output into lines for display
 */
export function renderMarkdownLines(markdown: string): string[] | null {
  const rendered = renderMarkdown(markdown);
  if (!rendered) return null;

  // Split by newlines but preserve empty lines for formatting
  return rendered.split("\n");
}
