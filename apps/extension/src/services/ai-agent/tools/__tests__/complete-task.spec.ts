import { describe, expect, it } from "vitest";
import type { CompleteTaskInput, CompleteTaskOutput } from "../complete-task";
import { createCompleteTaskTool } from "../complete-task";
import { executeTool } from "./test-helpers";

describe("completeTaskTool", () => {
  describe("Validation", () => {
    it("should reject when confirmation is false", async () => {
      const tool = createCompleteTaskTool();

      const input: CompleteTaskInput = {
        summary: "All tests passed",
        testsWritten: 5,
        testsPassed: 5,
        confirmation: false,
      };

      const result = await executeTool(tool, input, {} as CompleteTaskOutput);

      expect(result.success).toBe(false);
      expect(result.completed).toBe(false);
      expect(result.message).toContain("confirmation");
    });

    it("should reject when testsWritten does not match testsPassed", async () => {
      const tool = createCompleteTaskTool();

      const input: CompleteTaskInput = {
        summary: "Some tests passed",
        testsWritten: 5,
        testsPassed: 3,
        confirmation: true,
      };

      const result = await executeTool(tool, input, {} as CompleteTaskOutput);

      expect(result.success).toBe(false);
      expect(result.completed).toBe(false);
      expect(result.message).toContain("tests written but only");
    });

    it("should reject when no tests were written", async () => {
      const tool = createCompleteTaskTool();

      const input: CompleteTaskInput = {
        summary: "No tests",
        testsWritten: 0,
        testsPassed: 0,
        confirmation: true,
      };

      const result = await executeTool(tool, input, {} as CompleteTaskOutput);

      expect(result.success).toBe(false);
      expect(result.completed).toBe(false);
      expect(result.message).toContain("No tests were written");
    });
  });

  describe("Success Cases", () => {
    it("should complete successfully when all validations pass", async () => {
      const tool = createCompleteTaskTool();

      const input: CompleteTaskInput = {
        summary: "All 5 test files written and verified passing",
        testsWritten: 5,
        testsPassed: 5,
        confirmation: true,
      };

      const result = await executeTool(tool, input, {} as CompleteTaskOutput);

      expect(result.success).toBe(true);
      expect(result.completed).toBe(true);
      expect(result.message).toContain("Task completed successfully");
      expect(result.message).toContain(
        "All 5 test files written and verified passing",
      );
    });

    it("should handle single test file", async () => {
      const tool = createCompleteTaskTool();

      const input: CompleteTaskInput = {
        summary: "Single test file written",
        testsWritten: 1,
        testsPassed: 1,
        confirmation: true,
      };

      const result = await executeTool(tool, input, {} as CompleteTaskOutput);

      expect(result.success).toBe(true);
      expect(result.completed).toBe(true);
    });

    it("should handle multiple test files", async () => {
      const tool = createCompleteTaskTool();

      const input: CompleteTaskInput = {
        summary: "Multiple test files written",
        testsWritten: 10,
        testsPassed: 10,
        confirmation: true,
      };

      const result = await executeTool(tool, input, {} as CompleteTaskOutput);

      expect(result.success).toBe(true);
      expect(result.completed).toBe(true);
    });
  });
});
