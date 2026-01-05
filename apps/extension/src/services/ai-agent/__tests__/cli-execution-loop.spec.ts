import { describe, expect, it, vi, beforeEach } from "vitest";
import { Effect, Stream, Runtime, Ref } from "effect";
import { runCliExecutionLoop, runRalphWiggumCliLoop } from "../cli-execution-loop.js";
import type { CliExecutionHandle, ClaudeCliEvent } from "../../claude-cli-service.js";
import type { CliToolExecutor, CliToolResult } from "../cli-tool-executor.js";
import type { LoopState } from "../loop-state.js";
import { createEmptyLoopState } from "../loop-state.js";

// Mock vscode globally
vi.mock("vscode", async () => {
  const { createVSCodeMock } = await import(
    "../../../__tests__/mock-factories/vscode-mock.js"
  );
  return createVSCodeMock();
});

// Mock the logger
vi.mock("../../../utils/logger.js", () => ({
  logToOutput: vi.fn(),
}));

// Mock the frontmatter utils
vi.mock("../../../utils/frontmatter-utils.js", () => ({
  buildFullPlanContent: vi.fn((metadata, content) => {
    return `---\nname: ${metadata.name}\n---\n${content}`;
  }),
}));

describe("cli-execution-loop", () => {
  const runtime = Runtime.defaultRuntime;

  // Helper to create a mock CLI handle
  const createMockCliHandle = (
    events: ClaudeCliEvent[],
  ): CliExecutionHandle => {
    return {
      stream: Stream.fromIterable(events),
      sendToolResult: vi.fn(),
      close: vi.fn(),
      kill: vi.fn(),
    };
  };

  // Helper to create a mock tool executor
  const createMockToolExecutor = (
    result: CliToolResult = { success: true, result: '{"test": "result"}' },
  ): CliToolExecutor => {
    return {
      executeToolCall: vi.fn(() => Effect.succeed(result)),
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Text event handling", () => {
    it("should emit content_streamed progress event", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        { type: "text", content: "Hello world" },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      expect(progressCallback).toHaveBeenCalledWith(
        "content_streamed",
        expect.stringContaining("Hello world"),
      );
    });

    it("should accumulate text to response", async () => {
      const cliHandle = createMockCliHandle([
        { type: "text", content: "Part 1 " },
        { type: "text", content: "Part 2" },
        { type: "done" },
      ]);

      const result = await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
      }).pipe(Runtime.runPromise(runtime));

      expect(result.response).toBe("Part 1 Part 2");
    });
  });

  describe("Thinking event handling", () => {
    it("should emit reasoning progress event (not thinking)", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        { type: "thinking", content: "Let me think about this..." },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      // Should emit as "reasoning" for UI compatibility
      expect(progressCallback).toHaveBeenCalledWith(
        "reasoning",
        expect.stringContaining("Let me think"),
      );

      // Verify the JSON contains type: "reasoning"
      const reasoningCall = progressCallback.mock.calls.find(
        (call) => call[0] === "reasoning",
      );
      expect(reasoningCall).toBeDefined();
      const parsed = JSON.parse(reasoningCall?.[1]);
      expect(parsed.type).toBe("reasoning");
    });
  });

  describe("Tool use event handling", () => {
    it("should emit tool-call progress event with input-available state", async () => {
      const progressCallback = vi.fn();
      const toolExecutor = createMockToolExecutor();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "tool-123",
          name: "Read",
          input: { file_path: "/test.ts" },
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor,
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      // Find the tool-call event
      const toolCallEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "tool-call",
      );
      expect(toolCallEvent).toBeDefined();

      const parsed = JSON.parse(toolCallEvent?.[1]);
      expect(parsed.toolCallId).toBe("tool-123");
      expect(parsed.toolName).toBe("Read");
      expect(parsed.state).toBe("input-available");
    });

    it("should NOT execute CLI built-in tools locally (CLI handles them)", async () => {
      const toolExecutor = createMockToolExecutor();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "tool-456",
          name: "Bash",
          input: { command: "echo test" },
        },
        // CLI executes the tool and sends back tool_result
        {
          type: "tool_result",
          id: "tool-456",
          content: '{"stdout": "test\\n"}',
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor,
      }).pipe(Runtime.runPromise(runtime));

      // toolExecutor should NOT be called for CLI built-in tools
      expect(toolExecutor.executeToolCall).not.toHaveBeenCalled();
    });

    it("should emit tool-result when CLI sends tool_result event", async () => {
      const progressCallback = vi.fn();
      const toolExecutor = createMockToolExecutor();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "tool-789",
          name: "Read",
          input: { file_path: "/test.ts" },
        },
        // CLI executes the tool and sends back tool_result
        {
          type: "tool_result",
          id: "tool-789",
          content: '{"content": "file contents"}',
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor,
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      // Find the tool-result event
      const toolResultEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "tool-result",
      );
      expect(toolResultEvent).toBeDefined();

      const parsed = JSON.parse(toolResultEvent?.[1]);
      expect(parsed.toolCallId).toBe("tool-789");
      expect(parsed.state).toBe("output-available");
    });

    it("should emit tool-result with output-error state when CLI sends error result", async () => {
      const progressCallback = vi.fn();
      const toolExecutor = createMockToolExecutor();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "tool-error",
          name: "Read",
          input: { file_path: "/nonexistent.ts" },
        },
        // CLI executes the tool and sends back error result
        {
          type: "tool_result",
          id: "tool-error",
          content: '{"success": false, "error": "File not found"}',
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor,
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      // Find the tool-result event
      const toolResultEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "tool-result",
      );
      expect(toolResultEvent).toBeDefined();

      const parsed = JSON.parse(toolResultEvent?.[1]);
      expect(parsed.state).toBe("output-error");
    });

    it("should NOT send result back to CLI for built-in tools (CLI handles them)", async () => {
      const toolExecutor = createMockToolExecutor();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "tool-send",
          name: "Glob",
          input: { pattern: "*.ts" },
        },
        // CLI executes the tool and sends back tool_result
        {
          type: "tool_result",
          id: "tool-send",
          content: '{"files": ["test.ts"]}',
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor,
      }).pipe(Runtime.runPromise(runtime));

      // sendToolResult should NOT be called for CLI built-in tools
      expect(cliHandle.sendToolResult).not.toHaveBeenCalled();
    });
  });

  describe("Error event handling", () => {
    it("should emit error progress event", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        { type: "error", message: "Something went wrong" },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      expect(progressCallback).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("Something went wrong"),
      );
    });
  });

  describe("Done event handling", () => {
    it("should set taskCompleted flag", async () => {
      const cliHandle = createMockCliHandle([{ type: "done" }]);

      const result = await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
      }).pipe(Runtime.runPromise(runtime));

      expect(result.taskCompleted).toBe(true);
    });
  });

  describe("Abort signal handling", () => {
    it("should kill CLI handle on abort", async () => {
      const abortController = new AbortController();

      // Create a stream that yields one event then waits
      let resolveWait: () => void;
      const waitPromise = new Promise<void>((resolve) => {
        resolveWait = resolve;
      });

      const events: ClaudeCliEvent[] = [
        { type: "text", content: "Starting..." },
      ];

      const cliHandle: CliExecutionHandle = {
        stream: Stream.concat(
          Stream.fromIterable(events),
          Stream.fromEffect(
            Effect.promise(() => waitPromise).pipe(
              Effect.map(() => ({ type: "done" as const })),
            ),
          ),
        ),
        sendToolResult: vi.fn(),
        close: vi.fn(),
        kill: vi.fn(() => {
          resolveWait?.();
        }),
      };

      // Start the loop
      const loopPromise = runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
        signal: abortController.signal,
      }).pipe(Runtime.runPromise(runtime));

      // Give it a moment to start processing
      await new Promise((r) => setTimeout(r, 10));

      // Abort
      abortController.abort();

      await loopPromise;

      expect(cliHandle.kill).toHaveBeenCalled();
    });
  });

  describe("Result parsing", () => {
    it("should parse JSON results from CLI tool_result for UI", async () => {
      const progressCallback = vi.fn();
      const toolExecutor = createMockToolExecutor();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "tool-json",
          name: "Glob",
          input: { pattern: "*.ts" },
        },
        // CLI executes the tool and sends back tool_result
        {
          type: "tool_result",
          id: "tool-json",
          content: '{"files": [{"path": "/a.ts"}], "totalMatches": 1}',
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor,
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      // Find the tool-result event
      const toolResultEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "tool-result",
      );
      const parsed = JSON.parse(toolResultEvent?.[1]);

      // Output should be parsed object, not string
      expect(typeof parsed.output).toBe("object");
      expect(parsed.output.files).toHaveLength(1);
    });

    it("should keep string results when not valid JSON", async () => {
      const progressCallback = vi.fn();
      const toolExecutor = createMockToolExecutor();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "tool-string",
          name: "Bash",
          input: { command: "echo test" },
        },
        // CLI executes the tool and sends back tool_result (plain text)
        {
          type: "tool_result",
          id: "tool-string",
          content: "plain text result",
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor,
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      // Find the tool-result event
      const toolResultEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "tool-result",
      );
      const parsed = JSON.parse(toolResultEvent?.[1]);

      // Output should be the string as-is
      expect(parsed.output).toBe("plain text result");
    });
  });

  describe("Full execution flow", () => {
    it("should handle complete conversation with multiple events", async () => {
      const progressCallback = vi.fn();
      const toolExecutor = createMockToolExecutor();

      const cliHandle = createMockCliHandle([
        { type: "thinking", content: "Let me read the file" },
        { type: "text", content: "I'll read the file for you. " },
        {
          type: "tool_use",
          id: "tool-full",
          name: "Read",
          input: { file_path: "/src/index.ts" },
        },
        // CLI executes the tool and sends back tool_result
        {
          type: "tool_result",
          id: "tool-full",
          content: '{"content": "file data"}',
        },
        { type: "text", content: "Here's what I found." },
        { type: "done" },
      ]);

      const result = await runCliExecutionLoop({
        cliHandle,
        toolExecutor,
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(true);
      expect(result.taskCompleted).toBe(true);
      expect(result.response).toBe("I'll read the file for you. Here's what I found.");

      // Verify all event types were handled
      expect(progressCallback).toHaveBeenCalledWith("reasoning", expect.any(String));
      expect(progressCallback).toHaveBeenCalledWith("content_streamed", expect.any(String));
      expect(progressCallback).toHaveBeenCalledWith("tool-call", expect.any(String));
      expect(progressCallback).toHaveBeenCalledWith("tool-result", expect.any(String));
    });
  });

  describe("MCP Tool Detection", () => {
    it("should detect MCP tools by mcp__ prefix and emit tool-call event", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "mcp-tool-1",
          name: "mcp__clive-tools__proposeTestPlan",
          input: {
            name: "Test Plan",
            overview: "Test overview",
            planContent: "# Plan content",
          },
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      // Should emit tool-call event with isMcpTool flag
      const toolCallEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "tool-call",
      );
      expect(toolCallEvent).toBeDefined();
      const parsed = JSON.parse(toolCallEvent?.[1]);
      expect(parsed.toolName).toBe("proposeTestPlan");
      expect(parsed.isMcpTool).toBe(true);
    });

    it("should NOT execute MCP tools locally (delegated to MCP server)", async () => {
      const progressCallback = vi.fn();
      const toolExecutor = createMockToolExecutor();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "propose-1",
          name: "mcp__clive-tools__proposeTestPlan",
          input: {
            name: "Authentication Tests",
            overview: "Tests for auth module",
            suites: [
              {
                id: "suite-1",
                name: "Unit Tests",
                testType: "unit",
                targetFilePath: "src/auth/__tests__/auth.test.ts",
                sourceFiles: ["src/auth/auth.ts"],
              },
            ],
            mockDependencies: [],
            discoveredPatterns: {
              testFramework: "vitest",
              mockFactoryPaths: [],
              testPatterns: [],
            },
            planContent: "# Authentication Tests\n\nTest plan content here",
          },
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor,
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      // Should NOT call toolExecutor for MCP tools (handled by MCP server)
      expect(toolExecutor.executeToolCall).not.toHaveBeenCalled();

      // Should NOT send tool result back to CLI (MCP server handles it)
      expect(cliHandle.sendToolResult).not.toHaveBeenCalled();

      // Verify tool-call event was emitted with isMcpTool flag
      const toolCallEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "tool-call",
      );
      expect(toolCallEvent).toBeDefined();
      const toolCallParsed = JSON.parse(toolCallEvent?.[1]);
      expect(toolCallParsed.toolName).toBe("proposeTestPlan");
      expect(toolCallParsed.isMcpTool).toBe(true);
    });

    it("should emit plan-content-streaming event for proposeTestPlan", async () => {
      const { buildFullPlanContent } = await import("../../../utils/frontmatter-utils.js");
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "streaming-test",
          name: "mcp__clive-tools__proposeTestPlan",
          input: {
            name: "Streaming Test Plan",
            overview: "Test streaming",
            planContent: "# Content",
          },
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      // Verify buildFullPlanContent was called
      expect(buildFullPlanContent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Streaming Test Plan",
          overview: "Test streaming",
        }),
        "# Content",
      );

      // Verify plan-content-streaming event was emitted
      const planContentEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "plan-content-streaming",
      );
      expect(planContentEvent).toBeDefined();
      const planParsed = JSON.parse(planContentEvent?.[1]);
      expect(planParsed.toolCallId).toBe("streaming-test");
      expect(planParsed.isComplete).toBe(true);
    });

  });

  describe("tool_result event handling", () => {
    it("should handle tool_result events from MCP server", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_result",
          id: "mcp-result-1",
          content: '{"success": true, "planId": "plan-123", "message": "Plan created"}',
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      // Should emit tool-result event for UI
      const toolResultEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "tool-result",
      );
      expect(toolResultEvent).toBeDefined();
      const parsed = JSON.parse(toolResultEvent?.[1]);
      expect(parsed.toolCallId).toBe("mcp-result-1");
      expect(parsed.state).toBe("output-available");
      expect(parsed.output.success).toBe(true);
      expect(parsed.output.planId).toBe("plan-123");
    });

    it("should detect tool_result errors by success field", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_result",
          id: "mcp-error-1",
          content: '{"success": false, "error": "Failed to create plan file"}',
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      // Should emit error state
      const toolResultEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "tool-result",
      );
      expect(toolResultEvent).toBeDefined();
      const parsed = JSON.parse(toolResultEvent?.[1]);
      expect(parsed.state).toBe("output-error");
      expect(parsed.output.success).toBe(false);
      expect(parsed.output.error).toBe("Failed to create plan file");
    });

    it("should detect tool_result errors by error field", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_result",
          id: "mcp-error-2",
          content: '{"error": "Tool execution failed"}',
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      // Should emit error state
      const toolResultEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "tool-result",
      );
      expect(toolResultEvent).toBeDefined();
      const parsed = JSON.parse(toolResultEvent?.[1]);
      expect(parsed.state).toBe("output-error");
      expect(parsed.output.error).toBe("Tool execution failed");
    });

    it("should handle non-JSON tool_result content", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_result",
          id: "mcp-string-1",
          content: "plain text result",
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      // Should keep as string if not JSON
      const toolResultEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "tool-result",
      );
      expect(toolResultEvent).toBeDefined();
      const parsed = JSON.parse(toolResultEvent?.[1]);
      expect(parsed.output).toBe("plain text result");
      expect(parsed.state).toBe("output-available");
    });
  });

  describe("proposeTestPlan plan content emission conditionals", () => {
    it("should NOT emit plan-content-streaming when planContent is missing", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "mcp-no-content",
          name: "mcp__clive-tools__proposeTestPlan",
          input: {
            name: "Test Plan",
            overview: "Overview text",
            suites: [],
            // NO planContent
          },
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      const planEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "plan-content-streaming",
      );
      expect(planEvent).toBeUndefined();
    });

    it("should NOT emit plan-content-streaming when name is missing", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "mcp-no-name",
          name: "mcp__clive-tools__proposeTestPlan",
          input: {
            // NO name
            overview: "Overview text",
            planContent: "# Plan content here",
          },
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      const planEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "plan-content-streaming",
      );
      expect(planEvent).toBeUndefined();
    });

    it("should emit plan-content-streaming when both name and planContent exist", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "mcp-full",
          name: "mcp__clive-tools__proposeTestPlan",
          input: {
            name: "Complete Test Plan",
            overview: "Full overview",
            planContent: "# Complete plan content",
            suites: [],
          },
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      const planEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "plan-content-streaming",
      );
      expect(planEvent).toBeDefined();
    });
  });

  describe("MCP tool name extraction edge cases", () => {
    it("should handle MCP tool with only two segments", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "mcp-short",
          name: "mcp__shortname",
          input: {},
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      // Should use the full name as toolName since only 2 segments
      const toolCallEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "tool-call",
      );
      expect(toolCallEvent).toBeDefined();
      const parsed = JSON.parse(toolCallEvent?.[1]);
      expect(parsed.toolName).toBe("mcp__shortname");
    });

    it("should handle MCP tool with extra underscores in name", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "mcp-extra",
          name: "mcp__server__tool_with_underscores",
          input: {},
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      const toolCallEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "tool-call",
      );
      expect(toolCallEvent).toBeDefined();
      const parsed = JSON.parse(toolCallEvent?.[1]);
      expect(parsed.toolName).toBe("tool_with_underscores");
    });
  });

  describe("tool_result error detection edge cases", () => {
    it("should detect error when both success:false AND error field exist", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "tool-both-errors",
          name: "Read",
          input: { file_path: "/test.ts" },
        },
        {
          type: "tool_result",
          id: "tool-both-errors",
          content: '{"success": false, "error": "File not found"}',
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      const toolResultEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "tool-result",
      );
      expect(toolResultEvent).toBeDefined();
      const parsed = JSON.parse(toolResultEvent?.[1]);
      expect(parsed.state).toBe("output-error");
    });

    it("should treat empty error string as success", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "tool-empty-error",
          name: "Read",
          input: { file_path: "/test.ts" },
        },
        {
          type: "tool_result",
          id: "tool-empty-error",
          content: '{"data": "result", "error": ""}',
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor: createMockToolExecutor(),
        progressCallback,
      }).pipe(Runtime.runPromise(runtime));

      const toolResultEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "tool-result",
      );
      expect(toolResultEvent).toBeDefined();
      const parsed = JSON.parse(toolResultEvent?.[1]);
      // Empty string error should be treated as success
      expect(parsed.state).toBe("output-available");
    });
  });

  describe("Ralph Wiggum Loop", () => {
    const createMockClaudeCliService = (
      handle: CliExecutionHandle,
    ) => {
      return {
        execute: vi.fn(() => Effect.succeed(handle)),
      };
    };

    it("should start Ralph Wiggum loop and execute first iteration", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        { type: "text", content: "Iteration 1 response" },
        { type: "done" },
      ]);
      const mockService = createMockClaudeCliService(cliHandle);

      const result = await Effect.gen(function* () {
        const initialState = createEmptyLoopState();
        const loopStateRef = yield* Ref.make(initialState);

        return yield* runRalphWiggumCliLoop({
          loopStateRef,
          claudeCliService: mockService as any,
          cliOptions: {
            systemPrompt: "Test system prompt",
            model: "claude-sonnet-4",
            maxTokens: 8096,
          },
          toolExecutor: createMockToolExecutor(),
          progressCallback,
          correlationId: "test-correlation-id",
          workspaceRoot: "/test/workspace",
          planFilePath: "/test/plan.md",
        });
      }).pipe(Runtime.runPromise(runtime));

      expect(mockService.execute).toHaveBeenCalledTimes(1);
      expect(result.response).toContain("Iteration 1 response");
    });

    it("should emit loop-iteration-start event at beginning of each iteration", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        { type: "text", content: "Response" },
        { type: "done" },
      ]);
      const mockService = createMockClaudeCliService(cliHandle);

      await Effect.gen(function* () {
        const initialState = createEmptyLoopState();
        const loopStateRef = yield* Ref.make(initialState);

        return yield* runRalphWiggumCliLoop({
          loopStateRef,
          claudeCliService: mockService as any,
          cliOptions: {
            systemPrompt: "Test system prompt",
            model: "claude-sonnet-4",
            maxTokens: 8096,
          },
          toolExecutor: createMockToolExecutor(),
          progressCallback,
          correlationId: "test-id",
          workspaceRoot: "/test",
          planFilePath: "/test/plan.md",
        });
      }).pipe(Runtime.runPromise(runtime));

      const iterationStartEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "loop-iteration-start",
      );
      expect(iterationStartEvent).toBeDefined();
      const parsed = JSON.parse(iterationStartEvent?.[1]);
      expect(parsed.iteration).toBeGreaterThan(0);
      expect(parsed.maxIterations).toBeGreaterThan(0);
    });

    it("should emit loop-complete event when loop exits", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        { type: "text", content: "Response" },
        { type: "done" },
      ]);
      const mockService = createMockClaudeCliService(cliHandle);

      await Effect.gen(function* () {
        const initialState = createEmptyLoopState();
        const loopStateRef = yield* Ref.make(initialState);

        return yield* runRalphWiggumCliLoop({
          loopStateRef,
          claudeCliService: mockService as any,
          cliOptions: {
            systemPrompt: "Test system prompt",
            model: "claude-sonnet-4",
            maxTokens: 8096,
          },
          toolExecutor: createMockToolExecutor(),
          progressCallback,
          correlationId: "test-id",
          workspaceRoot: "/test",
          planFilePath: "/test/plan.md",
        });
      }).pipe(Runtime.runPromise(runtime));

      const loopCompleteEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "loop-complete",
      );
      expect(loopCompleteEvent).toBeDefined();
      const parsed = JSON.parse(loopCompleteEvent?.[1]);
      expect(parsed.reason).toBeDefined();
      expect(parsed.iteration).toBeDefined();
    });

    it("should handle abort signal during loop execution", async () => {
      const progressCallback = vi.fn();
      const abortController = new AbortController();
      const cliHandle = createMockCliHandle([
        { type: "text", content: "Response" },
        { type: "done" },
      ]);
      const mockService = createMockClaudeCliService(cliHandle);

      // Abort immediately
      abortController.abort();

      await Effect.gen(function* () {
        const initialState = createEmptyLoopState();
        const loopStateRef = yield* Ref.make(initialState);

        return yield* runRalphWiggumCliLoop({
          loopStateRef,
          claudeCliService: mockService as any,
          cliOptions: {
            systemPrompt: "Test system prompt",
            model: "claude-sonnet-4",
            maxTokens: 8096,
          },
          toolExecutor: createMockToolExecutor(),
          progressCallback,
          signal: abortController.signal,
          correlationId: "test-id",
          workspaceRoot: "/test",
          planFilePath: "/test/plan.md",
        });
      }).pipe(Runtime.runPromise(runtime));

      // Should not execute when aborted
      expect(mockService.execute).not.toHaveBeenCalled();
    });

    it("should build iteration prompt with workspace root and plan file path", async () => {
      const progressCallback = vi.fn();
      const cliHandle = createMockCliHandle([
        { type: "text", content: "Response" },
        { type: "done" },
      ]);
      const mockService = createMockClaudeCliService(cliHandle);

      await Effect.gen(function* () {
        const initialState = createEmptyLoopState();
        const loopStateRef = yield* Ref.make(initialState);

        return yield* runRalphWiggumCliLoop({
          loopStateRef,
          claudeCliService: mockService as any,
          cliOptions: {
            systemPrompt: "Test system prompt",
            model: "claude-sonnet-4",
            maxTokens: 8096,
          },
          toolExecutor: createMockToolExecutor(),
          progressCallback,
          correlationId: "test-id",
          workspaceRoot: "/test/workspace",
          planFilePath: "/test/plan.md",
        });
      }).pipe(Runtime.runPromise(runtime));

      // Verify execute was called with correct prompt that includes workspace root
      expect(mockService.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("/test/workspace"),
        }),
      );
    });
  });
});
