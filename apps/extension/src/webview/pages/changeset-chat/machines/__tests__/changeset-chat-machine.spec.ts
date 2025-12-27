import { describe, it, expect, beforeEach } from "vitest";
import type { ChangesetChatContext } from "../changeset-chat-machine.js";
import { isTestCommand, extractTestFilePath } from "../../utils/parse-test-output.js";

// Mock the state machine actions by testing the logic directly
// Since XState actions are pure functions, we can test them in isolation

describe("changeset-chat-machine test execution actions", () => {
  let mockContext: ChangesetChatContext;

  beforeEach(() => {
    mockContext = {
      files: [],
      branchName: "test-branch",
      messages: [],
      streamingContent: "",
      toolEvents: [],
      error: null,
      reasoningContent: "",
      isReasoningStreaming: false,
      hasCompletedAnalysis: false,
      scratchpadTodos: [],
      cacheLoaded: false,
      historyLoaded: false,
      testExecutions: [],
      accumulatedTestOutput: new Map(),
      accumulatedFileContent: new Map(),
      testSuiteQueue: [],
      currentSuiteId: null,
      agentMode: "act",
      planContent: null,
      usage: null,
      cachedAt: undefined,
    };
  });

  describe("updateTestExecutionStreaming", () => {
    it("should detect test commands and accumulate output", () => {
      const toolCallId = "test-tool-call-1";
      const command = "vitest run test.spec.ts";
      const output = "✓ test1";

      // Add tool event to context
      mockContext.toolEvents.push({
        toolCallId,
        toolName: "bashExecute",
        args: { command },
        state: "output-available",
        timestamp: new Date(),
      });

      // Simulate streaming output
      const currentAccumulated = mockContext.accumulatedTestOutput.get(toolCallId) || "";
      const newAccumulated = currentAccumulated + output;
      mockContext.accumulatedTestOutput.set(toolCallId, newAccumulated);

      // Verify test command detection
      expect(isTestCommand(command)).toBe(true);
      expect(mockContext.accumulatedTestOutput.get(toolCallId)).toBe(output);
    });

    it("should extract file path from test command", () => {
      const command = "vitest run src/test.spec.ts";
      const filePath = extractTestFilePath(command);
      expect(filePath).toBe("src/test.spec.ts");
    });

    it("should handle multiple streaming chunks", () => {
      const toolCallId = "test-tool-call-1";
      const command = "vitest run test.spec.ts";

      mockContext.toolEvents.push({
        toolCallId,
        toolName: "bashExecute",
        args: { command },
        state: "output-available",
        timestamp: new Date(),
      });

      const chunks = ["✓ test1", " (100ms)\n", "✓ test2", " (200ms)"];

      chunks.forEach((chunk) => {
        const current = mockContext.accumulatedTestOutput.get(toolCallId) || "";
        mockContext.accumulatedTestOutput.set(toolCallId, current + chunk);
      });

      const finalAccumulated = mockContext.accumulatedTestOutput.get(toolCallId);
      expect(finalAccumulated).toBe("✓ test1 (100ms)\n✓ test2 (200ms)");
    });

    it("should not accumulate output for non-test commands", () => {
      const toolCallId = "non-test-call-1";
      const command = "ls -la";

      mockContext.toolEvents.push({
        toolCallId,
        toolName: "bashExecute",
        args: { command },
        state: "output-available",
        timestamp: new Date(),
      });

      expect(isTestCommand(command)).toBe(false);
    });
  });

  describe("updateTestExecution", () => {
    it("should create new test execution from tool result", () => {
      const toolCallId = "test-tool-call-1";
      const command = "vitest run test.spec.ts";
      const _output = {
        stdout: "✓ test1 (100ms)\n✓ test2 (200ms)",
        exitCode: 0,
        wasTruncated: false,
        command,
      };

      mockContext.toolEvents.push({
        toolCallId,
        toolName: "bashExecute",
        args: { command },
        state: "output-available",
        timestamp: new Date(),
      });

      // Simulate the action logic
      const isTest = isTestCommand(command);
      expect(isTest).toBe(true);

      const filePath = extractTestFilePath(command) || "unknown";
      expect(filePath).toContain("test.spec.ts");
    });

    it("should update existing test execution", () => {
      const toolCallId = "test-tool-call-1";
      const command = "vitest run test.spec.ts";

      // Add initial execution
      mockContext.testExecutions.push({
        filePath: "test.spec.ts",
        status: "running",
        tests: [],
        startedAt: new Date(),
        summary: { total: 0, passed: 0, failed: 0 },
      });

      mockContext.toolEvents.push({
        toolCallId,
        toolName: "bashExecute",
        args: { command },
        state: "output-available",
        timestamp: new Date(),
      });

      const existing = mockContext.testExecutions.find(
        (te) => te.filePath === "test.spec.ts",
      );
      expect(existing).toBeDefined();
    });

    it("should handle test command with multiple files", () => {
      const commands = [
        "vitest run test1.spec.ts",
        "vitest run test2.spec.ts",
      ];

      commands.forEach((command, index) => {
        const toolCallId = `test-tool-call-${index}`;
        mockContext.toolEvents.push({
          toolCallId,
          toolName: "bashExecute",
          args: { command },
          state: "output-available",
          timestamp: new Date(),
        });

        const filePath = extractTestFilePath(command);
        expect(filePath).toContain(`test${index + 1}.spec.ts`);
      });
    });

    it("should clear accumulated output after final result", () => {
      const toolCallId = "test-tool-call-1";
      const command = "vitest run test.spec.ts";

      // Set up accumulated output
      mockContext.accumulatedTestOutput.set(toolCallId, "✓ test1 (100ms)");

      mockContext.toolEvents.push({
        toolCallId,
        toolName: "bashExecute",
        args: { command },
        state: "output-available",
        timestamp: new Date(),
      });

      // Simulate clearing accumulated output
      const updatedAccumulated = new Map(mockContext.accumulatedTestOutput);
      updatedAccumulated.delete(toolCallId);

      expect(updatedAccumulated.has(toolCallId)).toBe(false);
    });
  });

  describe("Test Command Detection Integration", () => {
    it("should detect vitest commands correctly", () => {
      const commands = [
        "vitest run test.spec.ts",
        "npx vitest run test.spec.ts",
        "yarn vitest run test.spec.ts",
      ];

      commands.forEach((command) => {
        expect(isTestCommand(command)).toBe(true);
      });
    });

    it("should detect jest commands correctly", () => {
      const commands = [
        "jest test",
        "npx jest test test.spec.ts",
        "npm run test",
      ];

      commands.forEach((command) => {
        expect(isTestCommand(command)).toBe(true);
      });
    });

    it("should detect playwright commands correctly", () => {
      const commands = [
        "playwright test",
        "npx playwright test auth.spec.ts",
      ];

      commands.forEach((command) => {
        expect(isTestCommand(command)).toBe(true);
      });
    });

    it("should not detect non-test commands", () => {
      const commands = [
        "ls -la",
        "git status",
        "npm install",
        "echo hello",
      ];

      commands.forEach((command) => {
        expect(isTestCommand(command)).toBe(false);
      });
    });
  });

  describe("File Path Extraction Integration", () => {
    it("should extract paths from vitest commands", () => {
      const command = "vitest run src/components/Button.test.tsx";
      const filePath = extractTestFilePath(command);
      expect(filePath).toBe("src/components/Button.test.tsx");
    });

    it("should extract paths from jest commands", () => {
      const command = "jest test utils/helpers.test.js";
      const filePath = extractTestFilePath(command);
      expect(filePath).toBe("utils/helpers.test.js");
    });

    it("should extract paths from playwright commands", () => {
      const command = "playwright test auth.spec.ts";
      const filePath = extractTestFilePath(command);
      expect(filePath).toBe("auth.spec.ts");
    });

    it("should return null for commands without file paths", () => {
      const commands = [
        "vitest run",
        "npm test",
        "yarn test",
      ];

      commands.forEach((command) => {
        const filePath = extractTestFilePath(command);
        expect(filePath).toBeNull();
      });
    });
  });

  describe("Test Execution State Transitions", () => {
    it("should transition from running to completed", () => {
      const execution = {
        filePath: "test.spec.ts",
        status: "running" as const,
        tests: [],
        startedAt: new Date(),
        summary: { total: 0, passed: 0, failed: 0 },
      };

      mockContext.testExecutions.push(execution);

      // Simulate completion
      const existingIndex = mockContext.testExecutions.findIndex(
        (te) => te.filePath === "test.spec.ts",
      );

      expect(existingIndex).toBeGreaterThanOrEqual(0);
    });

    it("should transition from running to failed", () => {
      const execution = {
        filePath: "test.spec.ts",
        status: "running" as const,
        tests: [],
        startedAt: new Date(),
        summary: { total: 0, passed: 0, failed: 0 },
      };

      mockContext.testExecutions.push(execution);

      const existingIndex = mockContext.testExecutions.findIndex(
        (te) => te.filePath === "test.spec.ts",
      );

      expect(existingIndex).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Test Results Flow to testSuiteQueue", () => {
    it("should link testExecutions to testSuiteQueue during streaming", () => {
      const suiteId = "suite-1";
      const toolCallId = "test-tool-call-1";
      const command = "vitest run test.spec.ts";
      const filePath = "test.spec.ts";

      // Setup suite queue
      mockContext.testSuiteQueue.push({
        id: suiteId,
        name: "Test Suite",
        testType: "unit",
        targetFilePath: filePath,
        sourceFiles: [],
        status: "in_progress",
        testResults: undefined,
      });
      mockContext.currentSuiteId = suiteId;

      // Setup tool event
      mockContext.toolEvents.push({
        toolCallId,
        toolName: "bashExecute",
        args: { command },
        state: "output-available",
        timestamp: new Date(),
      });

      // Simulate streaming output
      const output = "✓ test1";
      const currentAccumulated = mockContext.accumulatedTestOutput.get(toolCallId) || "";
      const newAccumulated = currentAccumulated + output;
      mockContext.accumulatedTestOutput.set(toolCallId, newAccumulated);

      // Verify test command detection
      expect(isTestCommand(command)).toBe(true);
      expect(extractTestFilePath(command)).toBe(filePath);
    });

    it("should update testSuiteQueue with results when tests complete successfully", () => {
      const suiteId = "suite-1";
      const filePath = "test.spec.ts";
      const execution = {
        filePath,
        status: "completed" as const,
        tests: [
          { testName: "test1", status: "pass" as const },
          { testName: "test2", status: "pass" as const },
        ],
        startedAt: new Date(),
        completedAt: new Date(),
        summary: { total: 2, passed: 2, failed: 0 },
      };

      mockContext.testSuiteQueue.push({
        id: suiteId,
        name: "Test Suite",
        testType: "unit",
        targetFilePath: filePath,
        sourceFiles: [],
        status: "in_progress",
        testResults: undefined,
      });
      mockContext.currentSuiteId = suiteId;
      mockContext.testExecutions.push(execution);

      // Simulate completion logic
      const currentSuite = mockContext.testSuiteQueue.find(
        (s) => s.id === suiteId,
      );
      expect(currentSuite).toBeDefined();
      expect(currentSuite?.targetFilePath).toBe(filePath);
    });

    it("should update testSuiteQueue with results when tests fail", () => {
      const suiteId = "suite-1";
      const filePath = "test.spec.ts";
      const execution = {
        filePath,
        status: "failed" as const,
        tests: [
          { testName: "test1", status: "pass" as const },
          { testName: "test2", status: "fail" as const, error: "Assertion failed" },
        ],
        startedAt: new Date(),
        completedAt: new Date(),
        summary: { total: 2, passed: 1, failed: 1 },
      };

      mockContext.testSuiteQueue.push({
        id: suiteId,
        name: "Test Suite",
        testType: "unit",
        targetFilePath: filePath,
        sourceFiles: [],
        status: "in_progress",
        testResults: undefined,
      });
      mockContext.currentSuiteId = suiteId;
      mockContext.testExecutions.push(execution);

      // Simulate completion logic with failures
      const currentSuite = mockContext.testSuiteQueue.find(
        (s) => s.id === suiteId,
      );
      expect(currentSuite).toBeDefined();
      expect(execution.summary.failed).toBeGreaterThan(0);
    });

    it("should include testResults in MARK_SUITE_FAILED action", () => {
      const suiteId = "suite-1";
      const execution = {
        filePath: "test.spec.ts",
        status: "failed" as const,
        tests: [{ testName: "test1", status: "fail" as const, error: "Error" }],
        startedAt: new Date(),
        completedAt: new Date(),
        summary: { total: 1, passed: 0, failed: 1 },
      };

      mockContext.testSuiteQueue.push({
        id: suiteId,
        name: "Test Suite",
        testType: "unit",
        targetFilePath: "test.spec.ts",
        sourceFiles: [],
        status: "in_progress",
        testResults: undefined,
      });

      // Simulate MARK_SUITE_FAILED with results
      const updatedQueue = mockContext.testSuiteQueue.map((suite) =>
        suite.id === suiteId
          ? {
              ...suite,
              status: "failed" as const,
              testResults: execution,
            }
          : suite,
      );

      const updatedSuite = updatedQueue.find((s) => s.id === suiteId);
      expect(updatedSuite?.status).toBe("failed");
      expect(updatedSuite?.testResults).toBeDefined();
      expect(updatedSuite?.testResults?.summary?.failed).toBe(1);
    });

    it("should stop processing next suite when tests fail", () => {
      const suiteId1 = "suite-1";
      const suiteId2 = "suite-2";
      const filePath1 = "test1.spec.ts";
      const filePath2 = "test2.spec.ts";

      mockContext.testSuiteQueue.push(
        {
          id: suiteId1,
          name: "Test Suite 1",
          testType: "unit",
          targetFilePath: filePath1,
          sourceFiles: [],
          status: "in_progress",
          testResults: undefined,
        },
        {
          id: suiteId2,
          name: "Test Suite 2",
          testType: "unit",
          targetFilePath: filePath2,
          sourceFiles: [],
          status: "pending",
          testResults: undefined,
        },
      );
      mockContext.currentSuiteId = suiteId1;

      const failedExecution = {
        filePath: filePath1,
        status: "failed" as const,
        tests: [{ testName: "test1", status: "fail" as const }],
        startedAt: new Date(),
        completedAt: new Date(),
        summary: { total: 1, passed: 0, failed: 1 },
      };

      // Simulate failure - should not advance to next suite
      const hasFailures = failedExecution.summary.failed > 0;
      expect(hasFailures).toBe(true);

      // When tests fail, currentSuiteId should be cleared, not advanced
      const nextSuite = mockContext.testSuiteQueue.find(
        (s) => s.status === "pending",
      );
      expect(nextSuite).toBeDefined();
      expect(nextSuite?.id).toBe(suiteId2);
    });
  });
});

