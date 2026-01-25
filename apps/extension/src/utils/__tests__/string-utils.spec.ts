import { describe, expect, it } from "vitest";
import { normalizeEscapedChars } from "../string-utils.js";

describe("string-utils", () => {
  describe("normalizeEscapedChars", () => {
    it("should convert literal newline to actual newline", () => {
      const input = "test\\nline";
      const result = normalizeEscapedChars(input);
      expect(result).toBe("test\nline");
      expect(result).toContain("\n");
    });

    it("should convert literal carriage return to actual carriage return", () => {
      const input = "test\\rline";
      const result = normalizeEscapedChars(input);
      expect(result).toBe("test\rline");
    });

    it("should convert literal tab to actual tab", () => {
      const input = "test\\tline";
      const result = normalizeEscapedChars(input);
      expect(result).toBe("test\tline");
    });

    it("should convert literal double quote to actual double quote", () => {
      const input = 'quote\\"text\\"';
      const result = normalizeEscapedChars(input);
      expect(result).toBe('quote"text"');
    });

    it("should convert literal single quote to actual single quote", () => {
      const input = "quote\\'text\\'";
      const result = normalizeEscapedChars(input);
      expect(result).toBe("quote'text'");
    });

    it("should convert literal backslash to actual backslash", () => {
      const input = "path\\\\to\\\\file";
      const result = normalizeEscapedChars(input);
      expect(result).toBe("path\\to\\file");
    });

    it("should handle multiple escape sequences in one string", () => {
      const input = 'line1\\nline2\\ttabbed\\"quoted\\"';
      const result = normalizeEscapedChars(input);
      expect(result).toBe('line1\nline2\ttabbed"quoted"');
    });

    it("should handle backspace escape sequence", () => {
      const input = "test\\bbackspace";
      const result = normalizeEscapedChars(input);
      expect(result).toBe("test\bbackspace");
    });

    it("should handle form feed escape sequence", () => {
      const input = "test\\fformfeed";
      const result = normalizeEscapedChars(input);
      expect(result).toBe("test\fformfeed");
    });

    it("should handle vertical tab escape sequence", () => {
      const input = "test\\vvertical";
      const result = normalizeEscapedChars(input);
      expect(result).toBe("test\vvertical");
    });

    it("should handle null character escape sequence", () => {
      const input = "test\\0null";
      const result = normalizeEscapedChars(input);
      expect(result).toBe("test\0null");
    });

    it("should preserve unknown escape sequences", () => {
      const input = "test\\xunknown";
      const result = normalizeEscapedChars(input);
      expect(result).toBe("test\\xunknown");
    });

    it("should handle empty string", () => {
      const result = normalizeEscapedChars("");
      expect(result).toBe("");
    });

    it("should handle string with no escape sequences", () => {
      const input = "plain text";
      const result = normalizeEscapedChars(input);
      expect(result).toBe("plain text");
    });

    it("should handle complex real-world example", () => {
      const input =
        'describe("Test", () => {\\n  it("should work", () => {\\n    cy.get("button").click();\\n  });\\n});';
      const result = normalizeEscapedChars(input);
      expect(result).toContain("\n");
      expect(result).toContain('describe("Test"');
      expect(result).toContain('it("should work"');
    });

    it("should handle escaped backslash followed by other escapes", () => {
      const input = "path\\\\to\\nfile";
      const result = normalizeEscapedChars(input);
      expect(result).toBe("path\\to\nfile");
    });

    it("should handle multiple consecutive escapes", () => {
      const input = "\\n\\t\\r";
      const result = normalizeEscapedChars(input);
      expect(result).toBe("\n\t\r");
    });
  });
});
