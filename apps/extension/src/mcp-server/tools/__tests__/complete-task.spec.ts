/**
 * completeTask MCP Tool Tests
 * Tests for task completion signaling with validation
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock MCP server
const mockTool = vi.fn();
const mockServer = {
  tool: mockTool,
};

describe("completeTask MCP Tool", () => {
  let toolHandler: (input: {
    summary: string;
    testsWritten: number;
    testsPassed: number;
    confirmation: boolean;
  }) => Promise<{ content: Array<{ type: string; text: string }> }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Import and register the tool
    const { registerCompleteTask } = await import("../complete-task.js");
    registerCompleteTask(mockServer as never);

    // Capture the tool handler
    toolHandler = mockTool.mock.calls[0][3];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("validation rules", () => {
    it("rejects when confirmation=false", async () => {
      const result = await toolHandler({
        summary: "Wrote 5 tests",
        testsWritten: 5,
        testsPassed: 5,
        confirmation: false,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.completed).toBe(false);
      expect(parsed.message).toContain("confirmation");
    });

    it("rejects when testsWritten=0", async () => {
      const result = await toolHandler({
        summary: "No tests written",
        testsWritten: 0,
        testsPassed: 0,
        confirmation: true,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.completed).toBe(false);
      expect(parsed.message).toContain("No tests were written");
    });

    it("rejects when testsPassed < testsWritten", async () => {
      const result = await toolHandler({
        summary: "Some tests failed",
        testsWritten: 5,
        testsPassed: 3,
        confirmation: true,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.completed).toBe(false);
      expect(parsed.message).toContain("5 tests written but only 3 passed");
    });

    it("accepts when all conditions met", async () => {
      const result = await toolHandler({
        summary: "All tests written and passing",
        testsWritten: 5,
        testsPassed: 5,
        confirmation: true,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.completed).toBe(true);
    });
  });

  describe("success cases", () => {
    it("returns success with summary message", async () => {
      const result = await toolHandler({
        summary: "All 10 test files written and verified passing",
        testsWritten: 10,
        testsPassed: 10,
        confirmation: true,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.message).toContain(
        "All 10 test files written and verified passing",
      );
    });

    it("handles single test scenario", async () => {
      const result = await toolHandler({
        summary: "Single test file written",
        testsWritten: 1,
        testsPassed: 1,
        confirmation: true,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.completed).toBe(true);
    });

    it("handles multiple tests scenario", async () => {
      const result = await toolHandler({
        summary: "Multiple test files completed",
        testsWritten: 100,
        testsPassed: 100,
        confirmation: true,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.completed).toBe(true);
    });
  });

  describe("error messages", () => {
    it("provides clear message for confirmation failure", async () => {
      const result = await toolHandler({
        summary: "Test",
        testsWritten: 5,
        testsPassed: 5,
        confirmation: false,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.message).toBe(
        "Cannot complete task without confirmation that all tests pass. Set confirmation=true.",
      );
    });

    it("provides clear message for no tests", async () => {
      const result = await toolHandler({
        summary: "No work done",
        testsWritten: 0,
        testsPassed: 0,
        confirmation: true,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.message).toBe(
        "Cannot complete task: No tests were written. Complete the task by writing at least one test file.",
      );
    });

    it("provides clear message for failing tests", async () => {
      const result = await toolHandler({
        summary: "Tests failing",
        testsWritten: 10,
        testsPassed: 7,
        confirmation: true,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.message).toBe(
        "Cannot complete task: 10 tests written but only 7 passed. All tests must pass before completion.",
      );
    });
  });

  describe("validation priority", () => {
    it("checks confirmation first", async () => {
      // Even with tests mismatch, confirmation should fail first
      const result = await toolHandler({
        summary: "Test",
        testsWritten: 5,
        testsPassed: 3,
        confirmation: false,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.message).toContain("confirmation");
    });

    it("checks test count before pass count when confirmed", async () => {
      // With confirmation true but testsWritten=0
      const result = await toolHandler({
        summary: "Test",
        testsWritten: 0,
        testsPassed: 0,
        confirmation: true,
      });

      const parsed = JSON.parse(result.content[0].text);
      // Should fail on tests mismatch (0 !== 0 passes, but 0 tests is checked after)
      // Actually, looking at the code, it checks testsWritten === testsPassed first
      // then testsWritten === 0, so the order is mismatch then zero check
      expect(parsed.message).toContain("No tests were written");
    });
  });

  describe("tool registration", () => {
    it("registers tool with correct name and description", () => {
      expect(mockTool).toHaveBeenCalled();
      const [name, description] = mockTool.mock.calls[0];

      expect(name).toBe("completeTask");
      expect(description).toContain("testing task is complete");
      expect(description).toContain("ALL tests have passed");
    });
  });
});
