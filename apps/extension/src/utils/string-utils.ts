/**
 * String manipulation utilities
 */

/**
 * Normalize escaped characters in a string - converts literal escape sequences to actual characters
 * Handles common escape sequences like \n, \t, \", etc.
 *
 * @param text - The text containing literal escape sequences (e.g., "test\\nline")
 * @returns The text with escape sequences converted to actual characters (e.g., "test\nline")
 *
 * @example
 * ```typescript
 * normalizeEscapedChars("test\\nline") // Returns "test\nline" (with actual newline)
 * normalizeEscapedChars("quote\\"text\\"") // Returns 'quote"text"'
 * normalizeEscapedChars("path\\\\to\\\\file") // Returns "path\\to\\file"
 * ```
 */
export function normalizeEscapedChars(text: string): string {
  return text.replace(/\\(.)/g, (match, char) => {
    const escapeMap: Record<string, string> = {
      n: "\n", // newline
      r: "\r", // carriage return
      t: "\t", // tab
      b: "\b", // backspace
      f: "\f", // form feed
      v: "\v", // vertical tab
      "0": "\0", // null character
      "'": "'", // single quote
      '"': '"', // double quote
      "\\": "\\", // backslash
    };
    return escapeMap[char] ?? match; // Return original if not a known escape
  });
}
