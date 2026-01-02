import { expect, describe, it } from "vitest";
import {
  sanitizePlanName,
  unescapeJsonString,
  extractJsonField,
  generateCorrelationId,
  generatePlanFilename,
  extractSuitesInfo,
} from "../testing-agent-helpers";

describe("JSON Parsing Utilities", () => {
  describe("sanitizePlanName", () => {
    it("should convert to lowercase", () => {
      const result = sanitizePlanName("MY TEST PLAN");
      expect(result).toBe("my-test-plan");
    });

    it("should replace special characters with hyphens", () => {
      const result = sanitizePlanName("Test@Plan#With$Special%Chars");
      expect(result).toBe("test-plan-with-special-chars");
    });

    it("should remove leading and trailing hyphens", () => {
      const result = sanitizePlanName("---test-plan---");
      expect(result).toBe("test-plan");
    });

    it("should truncate to 50 characters", () => {
      const longName = "a".repeat(100);
      const result = sanitizePlanName(longName);
      expect(result.length).toBe(50);
    });

    it("should collapse multiple special characters into single hyphen", () => {
      const result = sanitizePlanName("test   plan---with...many   separators");
      expect(result).toBe("test-plan-with-many-separators");
    });

    it("should handle empty string", () => {
      const result = sanitizePlanName("");
      expect(result).toBe("");
    });

    it("should handle string with only special characters", () => {
      const result = sanitizePlanName("@#$%^&*()");
      expect(result).toBe("");
    });

    it("should preserve alphanumeric characters", () => {
      const result = sanitizePlanName("Test123Plan456");
      expect(result).toBe("test123plan456");
    });
  });

  describe("unescapeJsonString", () => {
    it("should convert \\n to newline", () => {
      const result = unescapeJsonString("line1\\nline2");
      expect(result).toBe("line1\nline2");
    });

    it("should convert \\t to tab", () => {
      const result = unescapeJsonString("col1\\tcol2");
      expect(result).toBe("col1\tcol2");
    });

    it("should convert \\\\ to quote", () => {
      const result = unescapeJsonString('He said \\"hello\\"');
      expect(result).toBe('He said "hello"');
    });

    it("should convert \\\\\\\\ to backslash", () => {
      const result = unescapeJsonString("path\\\\to\\\\file");
      expect(result).toBe("path\\to\\file");
    });

    it("should handle multiple escape sequences", () => {
      const result = unescapeJsonString('line1\\nline2\\tvalue\\"quoted\\"\\\\end');
      expect(result).toBe('line1\nline2\tvalue"quoted"\\end');
    });

    it("should handle empty string", () => {
      const result = unescapeJsonString("");
      expect(result).toBe("");
    });

    it("should handle string with no escapes", () => {
      const result = unescapeJsonString("plain text without escapes");
      expect(result).toBe("plain text without escapes");
    });
  });

  describe("extractJsonField", () => {
    it("should extract complete field value", () => {
      const json = '{"name": "test-plan", "value": 123}';
      const result = extractJsonField(json, "name");
      expect(result).toBe("test-plan");
    });

    it("should extract field with escaped characters", () => {
      const json = '{"content": "line1\\nline2\\ttab"}';
      const result = extractJsonField(json, "content");
      expect(result).toBe("line1\\nline2\\ttab");
    });

    it("should return null for missing field", () => {
      const json = '{"name": "test-plan"}';
      const result = extractJsonField(json, "nonexistent");
      expect(result).toBe(null);
    });

    it("should return partial content for incomplete JSON (streaming)", () => {
      // Simulate streaming JSON where string is not yet closed
      const incompleteJson = '{"content": "partial content';
      const result = extractJsonField(incompleteJson, "content");
      expect(result).toBe("partial content");
    });

    it("should handle nested quotes correctly", () => {
      const json = '{"message": "He said \\"hello\\" to me"}';
      const result = extractJsonField(json, "message");
      expect(result).toBe('He said \\"hello\\" to me');
    });

    it("should handle field at start of JSON", () => {
      const json = '{"first": "value1", "second": "value2"}';
      const result = extractJsonField(json, "first");
      expect(result).toBe("value1");
    });

    it("should handle field at end of JSON", () => {
      const json = '{"first": "value1", "last": "value2"}';
      const result = extractJsonField(json, "last");
      expect(result).toBe("value2");
    });

    it("should handle whitespace around colon", () => {
      const json = '{"name"  :  "value-with-spaces"}';
      const result = extractJsonField(json, "name");
      expect(result).toBe("value-with-spaces");
    });

    it("should return null for empty JSON", () => {
      const result = extractJsonField("{}", "name");
      expect(result).toBe(null);
    });

    it("should handle multiline content with newlines", () => {
      const json = '{"planContent": "# Header\\n\\nParagraph 1\\n\\nParagraph 2"}';
      const result = extractJsonField(json, "planContent");
      expect(result).toBe("# Header\\n\\nParagraph 1\\n\\nParagraph 2");
    });

    it("should handle backslash sequences in content", () => {
      const json = '{"path": "C:\\\\Users\\\\test\\\\file.ts"}';
      const result = extractJsonField(json, "path");
      expect(result).toBe("C:\\\\Users\\\\test\\\\file.ts");
    });
  });

  describe("generateCorrelationId", () => {
    it("should generate ID with given prefix", () => {
      const id = generateCorrelationId("test");
      expect(id.startsWith("test-")).toBe(true);
    });

    it("should generate unique IDs", () => {
      const id1 = generateCorrelationId("test");
      const id2 = generateCorrelationId("test");
      expect(id1).not.toBe(id2);
    });

    it("should include timestamp component", () => {
      const before = Date.now();
      const id = generateCorrelationId("test");
      const after = Date.now();

      // ID format: prefix-timestamp-random
      const parts = id.split("-");
      expect(parts.length).toBeGreaterThanOrEqual(3);

      // The timestamp should be within range
      const timestampPart = parseInt(parts[1], 10);
      expect(timestampPart).toBeGreaterThanOrEqual(before);
      expect(timestampPart).toBeLessThanOrEqual(after);
    });
  });

  describe("generatePlanFilename", () => {
    it("should generate filename with unit test type and single suite", () => {
      const result = generatePlanFilename("Test Plan for Auth", {
        count: 1,
        primaryTestType: "unit",
      });
      expect(result).toBe(".clive/plans/test-plan-for-auth-unit-1-suite.md");
    });

    it("should generate filename with multiple suites (plural)", () => {
      const result = generatePlanFilename("Test Plan for Auth", {
        count: 3,
        primaryTestType: "unit",
      });
      expect(result).toBe(".clive/plans/test-plan-for-auth-unit-3-suites.md");
    });

    it("should generate filename with integration test type", () => {
      const result = generatePlanFilename("API Tests", {
        count: 2,
        primaryTestType: "integration",
      });
      expect(result).toBe(".clive/plans/api-tests-integration-2-suites.md");
    });

    it("should generate filename with e2e test type", () => {
      const result = generatePlanFilename("User Journey Tests", {
        count: 1,
        primaryTestType: "e2e",
      });
      expect(result).toBe(".clive/plans/user-journey-tests-e2e-1-suite.md");
    });

    it("should generate filename with mixed test type", () => {
      const result = generatePlanFilename("Comprehensive Tests", {
        count: 5,
        primaryTestType: "mixed",
      });
      expect(result).toBe(".clive/plans/comprehensive-tests-mixed-5-suites.md");
    });

    it("should sanitize special characters in plan name", () => {
      const result = generatePlanFilename("Test@Plan#With$Special%Chars!", {
        count: 1,
        primaryTestType: "unit",
      });
      expect(result).toBe(".clive/plans/test-plan-with-special-chars-unit-1-suite.md");
    });

    it("should truncate long plan names to 50 characters", () => {
      const longName = "a".repeat(100);
      const result = generatePlanFilename(longName, {
        count: 1,
        primaryTestType: "unit",
      });
      const filename = result.replace(".clive/plans/", "").replace("-unit-1-suite.md", "");
      expect(filename.length).toBe(50);
    });
  });

  describe("extractSuitesInfo", () => {
    it("should extract single unit suite", () => {
      const json = `{"suites": [{"id": "suite-1", "testType": "unit"}]}`;
      const result = extractSuitesInfo(json);
      expect(result).toEqual({
        count: 1,
        primaryTestType: "unit",
      });
    });

    it("should extract multiple suites with same type", () => {
      const json = `{"suites": [{"id": "suite-1", "testType": "unit"}, {"id": "suite-2", "testType": "unit"}, {"id": "suite-3", "testType": "unit"}]}`;
      const result = extractSuitesInfo(json);
      expect(result).toEqual({
        count: 3,
        primaryTestType: "unit",
      });
    });

    it("should identify integration as primary test type", () => {
      const json = `{"suites": [{"id": "suite-1", "testType": "integration"}]}`;
      const result = extractSuitesInfo(json);
      expect(result).toEqual({
        count: 1,
        primaryTestType: "integration",
      });
    });

    it("should identify e2e as primary test type", () => {
      const json = `{"suites": [{"id": "suite-1", "testType": "e2e"}]}`;
      const result = extractSuitesInfo(json);
      expect(result).toEqual({
        count: 1,
        primaryTestType: "e2e",
      });
    });

    it("should identify mixed type for different test types", () => {
      const json = `{"suites": [{"id": "suite-1", "testType": "unit"}, {"id": "suite-2", "testType": "integration"}]}`;
      const result = extractSuitesInfo(json);
      expect(result).toEqual({
        count: 2,
        primaryTestType: "mixed",
      });
    });

    it("should return mixed when multiple different types present", () => {
      const json = `{"suites": [{"id": "suite-1", "testType": "unit"}, {"id": "suite-2", "testType": "unit"}, {"id": "suite-3", "testType": "integration"}]}`;
      const result = extractSuitesInfo(json);
      expect(result).toEqual({
        count: 3,
        primaryTestType: "mixed",
      });
    });

    it("should return null for missing suites field", () => {
      const json = `{"name": "Test Plan", "overview": "description"}`;
      const result = extractSuitesInfo(json);
      expect(result).toBe(null);
    });

    it("should return null for incomplete suites array (streaming)", () => {
      const json = `{"suites": [{"id": "suite-1", "testType": "unit"`;
      const result = extractSuitesInfo(json);
      expect(result).toBe(null);
    });

    it("should return null for empty suites array", () => {
      const json = `{"suites": []}`;
      const result = extractSuitesInfo(json);
      expect(result).toBe(null);
    });

    it("should handle nested objects with brackets in strings", () => {
      const json = `{"suites": [{"id": "suite-1", "testType": "unit", "description": "test [brackets] in string"}]}`;
      const result = extractSuitesInfo(json);
      expect(result).toEqual({
        count: 1,
        primaryTestType: "unit",
      });
    });

    it("should handle escaped quotes in suite objects", () => {
      const json = `{"suites": [{"id": "suite-1", "testType": "unit", "name": "Test \\"quoted\\" name"}]}`;
      const result = extractSuitesInfo(json);
      expect(result).toEqual({
        count: 1,
        primaryTestType: "unit",
      });
    });

    it("should handle complex nested arrays and objects", () => {
      const json = `{"suites": [{"id": "suite-1", "testType": "unit", "sourceFiles": ["file1.ts", "file2.ts"]}, {"id": "suite-2", "testType": "unit"}]}`;
      const result = extractSuitesInfo(json);
      expect(result).toEqual({
        count: 2,
        primaryTestType: "unit",
      });
    });

    it("should handle streaming JSON with partial second suite", () => {
      const json = `{"suites": [{"id": "suite-1", "testType": "unit"}, {"id": "suite-2", "testT`;
      const result = extractSuitesInfo(json);
      expect(result).toBe(null);
    });

    it("should handle all three test types mixed", () => {
      const json = `{"suites": [{"id": "suite-1", "testType": "unit"}, {"id": "suite-2", "testType": "integration"}, {"id": "suite-3", "testType": "e2e"}]}`;
      const result = extractSuitesInfo(json);
      expect(result).toEqual({
        count: 3,
        primaryTestType: "mixed",
      });
    });

    it("should handle whitespace in JSON", () => {
      const json = `{
        "suites": [
          {
            "id": "suite-1",
            "testType": "unit"
          },
          {
            "id": "suite-2",
            "testType": "unit"
          }
        ]
      }`;
      const result = extractSuitesInfo(json);
      expect(result).toEqual({
        count: 2,
        primaryTestType: "unit",
      });
    });
  });
});