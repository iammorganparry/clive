/**
 * Path manipulation utilities for webview components
 */

/**
 * Truncate a file path in the middle, keeping the filename visible
 * @param path - The file path to truncate
 * @param maxLength - Maximum length of the truncated path (default: 50)
 * @returns Truncated path with filename preserved
 *
 * @example
 * ```typescript
 * truncateMiddle("/very/long/path/to/file.tsx") // Returns "/very...file.tsx"
 * ```
 */
export function truncateMiddle(path: string, maxLength: number = 50): string {
  if (path.length <= maxLength) return path;

  const filename = path.split("/").pop() || "";
  const remaining = maxLength - filename.length - 3; // 3 for "..."

  if (remaining <= 0) return `...${filename.slice(-maxLength + 3)}`;

  const startLength = Math.ceil(remaining / 2);
  const start = path.slice(0, startLength);

  return `${start}...${filename}`;
}

/**
 * Extract and truncate file paths from log messages
 * Finds file paths in log text and truncates them if they're too long
 * @param log - The log message that may contain file paths
 * @returns Log message with truncated file paths
 *
 * @example
 * ```typescript
 * truncateLogMessage("Reading /very/long/path/to/file.tsx")
 * // Returns "Reading /very...file.tsx"
 * ```
 */
export function truncateLogMessage(log: string): string {
  // Match file paths (absolute or relative)
  const pathRegex = /([/\w-]+\.(ts|tsx|js|jsx|cy\.ts|spec\.ts))/g;
  return log.replace(pathRegex, (match) => {
    // If the path is long, truncate it
    if (match.length > 60) {
      return truncateMiddle(match, 60);
    }
    return match;
  });
}
