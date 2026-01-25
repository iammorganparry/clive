/**
 * Template placeholder resolution utilities
 * Resolves {{PLACEHOLDER}} syntax in prompt templates
 */

/**
 * Resolve {{PLACEHOLDER}} syntax in a template
 * @param template Template string with {{PLACEHOLDER}} markers
 * @param placeholders Record mapping placeholder names to their values
 * @returns Resolved template string
 */
export const resolveTemplate = (
  template: string,
  placeholders: Record<string, string>,
): string => {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    const value = placeholders[key.trim()];
    return value !== undefined ? value : match;
  });
};

/**
 * Extract all placeholder names from a template
 * @param template Template string to analyze
 * @returns Array of unique placeholder names found in the template
 */
export const extractPlaceholders = (template: string): string[] => {
  const matches = template.matchAll(/\{\{([A-Z_]+)\}\}/g);
  return [...new Set([...matches].map((m) => m[1]))];
};
