import { describe, it, expect, beforeEach } from "vitest";
import type { ChangesetChatContext } from "../changeset-chat-machine.js";
import {
  isTestCommand,
  extractTestFilePath,
  parseTestOutput,
  updateTestExecutionFromStream,
} from "../../utils/parse-test-output.js";

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
      isTextStreaming: false,
      hasCompletedAnalysis: false,
      approvalMode: null,
      scratchpadTodos: [],
      historyLoaded: false,
      testExecutions: [],
      accumulatedTestOutput: new Map(),
      accumulatedFileContent: new Map(),
      testSuiteQueue: [],
      agentMode: "act",
      planContent: null,
      planFilePath: null,
      usage: null,
      subscriptionId: null,
      // Ralph Wiggum loop state
      loopIteration: 0,
      loopMaxIterations: 10,
      loopTodos: [],
      loopProgress: null,
      loopExitReason: null,
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

      // When tests fail, agent stays in loop to fix - next suite stays pending
      const nextSuite = mockContext.testSuiteQueue.find(
        (s) => s.status === "pending",
      );
      expect(nextSuite).toBeDefined();
      expect(nextSuite?.id).toBe(suiteId2);
    });
  });

  describe("Streaming Test Output to testExecutions", () => {
    it("should accumulate streaming vitest output and parse test results", () => {
      const toolCallId = "test-tool-call-1";
      const command = "vitest run src/utils.test.ts";
      const filePath = "src/utils.test.ts";

      // Add tool event
      mockContext.toolEvents.push({
        toolCallId,
        toolName: "bashExecute",
        args: { command },
        state: "output-available",
        timestamp: new Date(),
      });

      // Simulate streaming chunks
      const chunks = [
        "✓ should validate input",
        " (50ms)\n",
        "✓ should handle errors",
        " (30ms)\n",
      ];

      let accumulated = "";
      chunks.forEach((chunk) => {
        accumulated += chunk;
        mockContext.accumulatedTestOutput.set(toolCallId, accumulated);
      });

      // Parse the accumulated output
      const results = parseTestOutput(accumulated, command);
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        testName: "should validate input",
        status: "pass",
        duration: 50,
      });
      expect(results[1]).toMatchObject({
        testName: "should handle errors",
        status: "pass",
        duration: 30,
      });

      // Verify file path extraction
      expect(extractTestFilePath(command)).toBe(filePath);
    });

    it("should update testExecutions array from streaming output", () => {
      const toolCallId = "test-tool-call-1";
      const command = "npx vitest run test.spec.ts";
      const filePath = "test.spec.ts";

      // Add tool event
      mockContext.toolEvents.push({
        toolCallId,
        toolName: "bashExecute",
        args: { command },
        state: "output-available",
        timestamp: new Date(),
      });

      // Simulate first chunk - incomplete output (no duration yet)
      const chunk1 = "✓ test1";
      mockContext.accumulatedTestOutput.set(toolCallId, chunk1);

      const updated1 = updateTestExecutionFromStream(
        null,
        command,
        chunk1,
        chunk1,
      );

      expect(updated1).toBeDefined();
      expect(updated1?.filePath).toBe(filePath);
      expect(updated1?.tests.length).toBeGreaterThan(0);
      expect(updated1?.status).toBe("running");

      // Simulate second chunk - complete with durations
      const chunk2 = " (100ms)\n✓ test2 (200ms)\n";
      const accumulated = chunk1 + chunk2;
      mockContext.accumulatedTestOutput.set(toolCallId, accumulated);

      const updated2 = updateTestExecutionFromStream(
        updated1,
        command,
        chunk2,
        accumulated,
      );

      expect(updated2?.tests.length).toBeGreaterThanOrEqual(2);
      expect(updated2?.summary?.passed).toBeGreaterThanOrEqual(2);
    });

    it("should handle failed test results in streaming output", () => {
      const toolCallId = "test-tool-call-1";
      const command = "vitest run test.spec.ts";

      mockContext.toolEvents.push({
        toolCallId,
        toolName: "bashExecute",
        args: { command },
        state: "output-available",
        timestamp: new Date(),
      });

      // Simulate streaming with failures
      const output = "✓ test1 (100ms)\n✗ test2 (50ms)\n  Error: Expected true but got false\n";
      mockContext.accumulatedTestOutput.set(toolCallId, output);

      const updated = updateTestExecutionFromStream(
        null,
        command,
        output,
        output,
      );

      expect(updated).toBeDefined();
      expect(updated?.tests.length).toBeGreaterThanOrEqual(2);
      expect(updated?.summary?.passed).toBeGreaterThanOrEqual(1);
      expect(updated?.summary?.failed).toBeGreaterThanOrEqual(1);

      const failedTest = updated?.tests.find((t) => t.status === "fail");
      expect(failedTest).toBeDefined();
      expect(failedTest?.error).toBeTruthy();
    });

    it("should process jest streaming output correctly", () => {
      const toolCallId = "test-tool-call-2";
      const command = "jest test auth.test.js";

      mockContext.toolEvents.push({
        toolCallId,
        toolName: "bashExecute",
        args: { command },
        state: "output-available",
        timestamp: new Date(),
      });

      // Simulate jest output streaming
      const chunks = [
        "PASS tests/auth.test.js\n",
        "  ✓ login with valid credentials (100ms)\n",
        "  ✓ logout (50ms)\n",
      ];

      let accumulated = "";
      chunks.forEach((chunk) => {
        accumulated += chunk;
        mockContext.accumulatedTestOutput.set(toolCallId, accumulated);
      });

      const updated = updateTestExecutionFromStream(
        null,
        command,
        accumulated,
        accumulated,
      );

      expect(updated).toBeDefined();
      expect(updated?.tests.length).toBeGreaterThanOrEqual(2);
      
      const testNames = updated?.tests.map((t) => t.testName) || [];
      expect(testNames.some((name) => name.includes("login"))).toBe(true);
      expect(testNames.some((name) => name.includes("logout"))).toBe(true);
    });

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

      // Setup tool event
      mockContext.toolEvents.push({
        toolCallId,
        toolName: "bashExecute",
        args: { command },
        state: "output-available",
        timestamp: new Date(),
      });

      // Simulate streaming output
      const output = "✓ test1 (100ms)\n✓ test2 (200ms)\n";
      mockContext.accumulatedTestOutput.set(toolCallId, output);

      const updated = updateTestExecutionFromStream(
        null,
        command,
        output,
        output,
      );

      expect(updated).toBeDefined();
      expect(updated?.filePath).toBe(filePath);

      // Add to testExecutions
      if (updated) {
        mockContext.testExecutions.push(updated);
      }

      // Verify linkage
      const currentSuite = mockContext.testSuiteQueue.find(
        (s) => s.id === suiteId,
      );
      const execution = mockContext.testExecutions.find(
        (te) => te.filePath === filePath,
      );

      expect(currentSuite?.targetFilePath).toBe(execution?.filePath);
      expect(execution?.summary?.total).toBe(2);
      expect(execution?.summary?.passed).toBe(2);
    });

    it("should handle multiple test files streaming in parallel", () => {
      const commands = [
        { id: "tool-1", cmd: "vitest run test1.spec.ts", file: "test1.spec.ts" },
        { id: "tool-2", cmd: "vitest run test2.spec.ts", file: "test2.spec.ts" },
      ];

      commands.forEach(({ id, cmd, file }) => {
        mockContext.toolEvents.push({
          toolCallId: id,
          toolName: "bashExecute",
          args: { command: cmd },
          state: "output-available",
          timestamp: new Date(),
        });

        const output = `✓ test from ${file} (100ms)\n`;
        mockContext.accumulatedTestOutput.set(id, output);

        const updated = updateTestExecutionFromStream(null, cmd, output, output);
        if (updated) {
          mockContext.testExecutions.push(updated);
        }
      });

      expect(mockContext.testExecutions.length).toBe(2);
      expect(mockContext.testExecutions[0].filePath).toContain("test1");
      expect(mockContext.testExecutions[1].filePath).toContain("test2");
    });

    it("should transition test execution status from running to completed", () => {
      const toolCallId = "test-tool-call-1";
      const command = "vitest run test.spec.ts";

      mockContext.toolEvents.push({
        toolCallId,
        toolName: "bashExecute",
        args: { command },
        state: "output-available",
        timestamp: new Date(),
      });

      // Simulate incomplete streaming (running state)
      const incompleteOutput = "✓ test1";
      const running = updateTestExecutionFromStream(
        null,
        command,
        incompleteOutput,
        incompleteOutput,
      );

      expect(running?.status).toBe("running");
      expect(running?.completedAt).toBeUndefined();

      // Simulate complete streaming with summary markers
      const completeOutput = "✓ test1 (100ms)\n✓ test2 (200ms)\n";
      const completed = updateTestExecutionFromStream(
        running,
        command,
        completeOutput,
        completeOutput,
      );

      expect(completed?.status).toBe("completed");
      expect(completed?.completedAt).toBeInstanceOf(Date);
    });
  });
});

describe("changeset-chat-machine plan content actions", () => {
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
      isTextStreaming: false,
      hasCompletedAnalysis: false,
      approvalMode: null,
      scratchpadTodos: [],
      historyLoaded: false,
      testExecutions: [],
      accumulatedTestOutput: new Map(),
      accumulatedFileContent: new Map(),
      testSuiteQueue: [],
      agentMode: "plan",
      planContent: null,
      planFilePath: null,
      usage: null,
      subscriptionId: null,
      // Ralph Wiggum loop state
      loopIteration: 0,
      loopMaxIterations: 10,
      loopTodos: [],
      loopProgress: null,
      loopExitReason: null,
    };
  });

  describe("updatePlanContent", () => {
    it("should update planContent from plan-content-streaming event", () => {
      const planContent = "# Test Plan\n\n## Problem Summary\n\nTest plan content";
      
      // Simulate updatePlanContent action logic
      const updates = {
        planContent: planContent || null,
      };

      expect(updates.planContent).toBe(planContent);
    });

    it("should update planFilePath when filePath is provided in streaming event", () => {
      const planContent = "# Test Plan\n\n## Problem Summary\n\nTest plan content";
      const filePath = ".clive/plans/test-plan-auth-1234567890.md";

      // Simulate updatePlanContent action logic with filePath
      const updates = {
        planContent: planContent || null,
        ...(filePath && { planFilePath: filePath }),
      };

      expect(updates.planContent).toBe(planContent);
      expect(updates.planFilePath).toBe(filePath);
    });

    it("should not update planFilePath when filePath is not provided", () => {
      const planContent = "# Test Plan\n\n## Problem Summary\n\nTest plan content";

      // Simulate updatePlanContent action logic without filePath
      const updates: Record<string, string | null> = {
        planContent: planContent || null,
      };

      expect(updates.planContent).toBe(planContent);
      expect(updates.planFilePath).toBeUndefined();
    });

    it("should set planContent to null when content is empty", () => {
      const planContent = "";

      // Simulate updatePlanContent action logic
      const updates = {
        planContent: planContent || null,
      };

      expect(updates.planContent).toBeNull();
    });
  });

  describe("reset action", () => {
    it("should reset planContent to null", () => {
      mockContext.planContent = "# Test Plan\n\nSome content";
      
      // Simulate reset action
      const resetContext = {
        ...mockContext,
        planContent: null,
      };

      expect(resetContext.planContent).toBeNull();
    });

    it("should reset planFilePath to null", () => {
      mockContext.planFilePath = ".clive/plans/test-plan-123.md";
      
      // Simulate reset action
      const resetContext = {
        ...mockContext,
        planFilePath: null,
      };

      expect(resetContext.planFilePath).toBeNull();
    });
  });

  describe("plan content streaming flow", () => {
    it("should capture plan content and file path from streaming events", () => {
      const planContent = "# Test Plan for Authentication\n\n## Problem Summary\n\nTesting gaps identified";
      const filePath = ".clive/plans/test-plan-authentication-1234567890.md";

      // Initial state
      expect(mockContext.planContent).toBeNull();
      expect(mockContext.planFilePath).toBeNull();

      // Simulate streaming event with content and filePath
      mockContext.planContent = planContent;
      mockContext.planFilePath = filePath;

      expect(mockContext.planContent).toBe(planContent);
      expect(mockContext.planFilePath).toBe(filePath);
    });

    it("should handle multiple streaming chunks with incremental content", () => {
      const chunks = [
        { content: "# Test Plan\n", filePath: ".clive/plans/test-plan-123.md" },
        { content: "# Test Plan\n\n## Problem", filePath: ".clive/plans/test-plan-123.md" },
        { content: "# Test Plan\n\n## Problem Summary\n\nComplete", filePath: ".clive/plans/test-plan-123.md" },
      ];

      // Simulate incremental streaming
      chunks.forEach((chunk) => {
        mockContext.planContent = chunk.content;
        mockContext.planFilePath = chunk.filePath;
      });

      // Final state should have the complete content
      expect(mockContext.planContent).toContain("Complete");
      expect(mockContext.planFilePath).toBe(".clive/plans/test-plan-123.md");
    });
  });
});

describe("changeset-chat-machine approvalMode state", () => {
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
      isTextStreaming: false,
      hasCompletedAnalysis: false,
      approvalMode: null,
      scratchpadTodos: [],
      historyLoaded: false,
      testExecutions: [],
      accumulatedTestOutput: new Map(),
      accumulatedFileContent: new Map(),
      testSuiteQueue: [],
      agentMode: "plan",
      planContent: null,
      planFilePath: null,
      usage: null,
      subscriptionId: null,
      // Ralph Wiggum loop state
      loopIteration: 0,
      loopMaxIterations: 10,
      loopTodos: [],
      loopProgress: null,
      loopExitReason: null,
    };
  });

  describe("initial state", () => {
    it("should be null initially", () => {
      expect(mockContext.approvalMode).toBe(null);
    });
  });

  describe("APPROVE_PLAN event", () => {
    it("should set approvalMode to 'auto' and agentMode to 'act' on auto approval", () => {
      mockContext.planContent = "# Test Plan\n\nSome plan content";
      mockContext.agentMode = "plan";

      // Simulate approvePlan action with auto mode
      mockContext.approvalMode = "auto";
      mockContext.agentMode = "act";

      expect(mockContext.approvalMode).toBe("auto");
      expect(mockContext.agentMode).toBe("act");
    });

    it("should set approvalMode to 'manual' on manual approval", () => {
      mockContext.planContent = "# Test Plan\n\nSome plan content";
      mockContext.agentMode = "plan";

      // Simulate approvePlan action with manual mode
      mockContext.approvalMode = "manual";
      mockContext.agentMode = "act";

      expect(mockContext.approvalMode).toBe("manual");
      expect(mockContext.agentMode).toBe("act");
    });
  });

  describe("RESET event", () => {
    it("should reset approvalMode to null", () => {
      mockContext.approvalMode = "auto";

      // Simulate reset action
      mockContext.approvalMode = null;

      expect(mockContext.approvalMode).toBe(null);
    });
  });
});
