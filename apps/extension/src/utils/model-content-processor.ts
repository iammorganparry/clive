/**
 * Model-specific content processing utilities
 * Handles quirks from different AI models (HTML escaping, code fences, etc.)
 */

/**
 * Check if a file extension should be exempt from HTML unescaping
 * XML/SVG files legitimately use HTML entities
 */
const EXEMPT_EXTENSIONS = [".xml", ".svg", ".xsd", ".xslt"];

/**
 * Fix HTML entity escaping that some models (e.g., DeepSeek) output
 * Converts &lt; &gt; &amp; back to < > &
 * Exempts certain file types that legitimately use escaped characters
 */
export function fixModelHtmlEscaping(
  content: string,
  filePath: string,
): string {
  // Check if file should be exempt
  const extension = filePath.toLowerCase().slice(filePath.lastIndexOf("."));
  if (EXEMPT_EXTENSIONS.includes(extension)) {
    return content;
  }

  // Unescape HTML entities
  return content
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Strip markdown code fences if present
 * Some models wrap file content in ```language blocks
 */
export function stripMarkdownCodeFences(content: string): string {
  let processed = content;

  // Remove opening fence (```language or ```)
  if (processed.startsWith("```")) {
    const lines = processed.split("\n");
    // Skip first line if it's a code fence
    if (lines[0]?.trim().startsWith("```")) {
      processed = lines.slice(1).join("\n");
    }
  }

  // Remove closing fence
  if (processed.endsWith("```")) {
    const lines = processed.split("\n");
    // Remove last line if it's a code fence
    if (lines[lines.length - 1]?.trim() === "```") {
      processed = lines.slice(0, -1).join("\n");
    }
  }

  return processed.trim();
}

/**
 * Remove invalid Unicode characters that some models may output
 */
export function removeInvalidCharacters(content: string): string {
  // Remove control characters except newlines, tabs, carriage returns
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally matching control characters to remove invalid Unicode
  return content.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");
}

/**
 * Process content for a specific model
 * @param content Raw content from model
 * @param filePath File path for context (affects HTML unescaping)
 * @param modelName Model name to determine processing rules
 */
export function processModelContent(
  content: string,
  filePath: string,
  modelName?: string,
): string {
  let processed = content;

  // Claude models typically don't need these fixes
  const isClaude = modelName?.toLowerCase().includes("claude") ?? false;

  if (!isClaude) {
    // Apply model-specific fixes for non-Claude models
    processed = fixModelHtmlEscaping(processed, filePath);
  }

  // Always strip code fences (can appear from any model)
  processed = stripMarkdownCodeFences(processed);

  // Always remove invalid characters
  processed = removeInvalidCharacters(processed);

  return processed;
}
