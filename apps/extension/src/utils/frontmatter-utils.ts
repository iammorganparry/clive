/**
 * Frontmatter parsing utilities
 * Consolidates frontmatter parsing logic from knowledge-file-service and plan-file-service
 */

/**
 * Parse frontmatter from markdown content
 * Returns frontmatter object and body content
 */
export const parseFrontmatter = (
  content: string,
): { frontmatter: Record<string, unknown>; body: string } => {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterText = match[1];
  const body = match[2];

  const frontmatter: Record<string, unknown> = {};
  for (const line of frontmatterText.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const valueStr = line.substring(colonIndex + 1).trim();
      let value: unknown = valueStr;

      // Handle array values (YAML-like)
      if (valueStr.startsWith("-")) {
        const items = line
          .substring(colonIndex + 1)
          .split("\n")
          .map((item) => item.replace(/^-\s*/, "").trim())
          .filter((item) => item.length > 0);
        value = items;
      } else if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
        value = valueStr.slice(1, -1);
      } else if (valueStr.startsWith("'") && valueStr.endsWith("'")) {
        value = valueStr.slice(1, -1);
      }

      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
};

/**
 * Generate frontmatter string from metadata object
 */
export const generateFrontmatter = (
  metadata: Record<string, unknown>,
): string => {
  const lines = ["---"];
  for (const [key, value] of Object.entries(metadata)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else if (typeof value === "string") {
      // Escape quotes in string values
      const escapedValue = value.replace(/"/g, '\\"');
      lines.push(`${key}: "${escapedValue}"`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push("---");
  return `${lines.join("\n")}\n`;
};

/**
 * Type guard for plan status values
 */
export const isPlanStatus = (
  s: unknown,
): s is "pending" | "approved" | "rejected" =>
  s === "pending" || s === "approved" || s === "rejected";
