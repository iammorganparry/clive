import { describe, expect, it, vi, beforeEach } from "vitest";
import { Effect, Stream, Runtime } from "effect";
import { runCliExecutionLoop } from "../cli-execution-loop.js";
import type { CliExecutionHandle, ClaudeCliEvent } from "../../claude-cli-service.js";
import type { CliToolExecutor, CliToolResult } from "../cli-tool-executor.js";

// Mock the logger
vi.mock("../../../utils/logger.js", () => ({
  logToOutput: vi.fn(),
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

    it("should execute tool via toolExecutor", async () => {
      const toolExecutor = createMockToolExecutor();
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "tool-456",
          name: "Bash",
          input: { command: "echo test" },
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor,
      }).pipe(Runtime.runPromise(runtime));

      expect(toolExecutor.executeToolCall).toHaveBeenCalledWith(
        "Bash",
        { command: "echo test" },
        "tool-456",
      );
    });

    it("should emit tool-result with output-available state on success", async () => {
      const progressCallback = vi.fn();
      const toolExecutor = createMockToolExecutor({
        success: true,
        result: '{"content": "file contents"}',
      });
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "tool-789",
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

      // Find the tool-result event
      const toolResultEvent = progressCallback.mock.calls.find(
        (call) => call[0] === "tool-result",
      );
      expect(toolResultEvent).toBeDefined();

      const parsed = JSON.parse(toolResultEvent?.[1]);
      expect(parsed.toolCallId).toBe("tool-789");
      expect(parsed.state).toBe("output-available");
    });

    it("should emit tool-result with output-error state on failure", async () => {
      const progressCallback = vi.fn();
      const toolExecutor = createMockToolExecutor({
        success: false,
        result: "",
        error: "File not found",
      });
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "tool-error",
          name: "Read",
          input: { file_path: "/nonexistent.ts" },
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

    it("should send result back to CLI via sendToolResult", async () => {
      const toolExecutor = createMockToolExecutor({
        success: true,
        result: '{"data": "result"}',
      });
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "tool-send",
          name: "Glob",
          input: { pattern: "*.ts" },
        },
        { type: "done" },
      ]);

      await runCliExecutionLoop({
        cliHandle,
        toolExecutor,
      }).pipe(Runtime.runPromise(runtime));

      expect(cliHandle.sendToolResult).toHaveBeenCalledWith(
        "tool-send",
        '{"data": "result"}',
      );
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
    it("should parse JSON results for UI", async () => {
      const progressCallback = vi.fn();
      const toolExecutor = createMockToolExecutor({
        success: true,
        result: '{"files": [{"path": "/a.ts"}], "totalMatches": 1}',
      });
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "tool-json",
          name: "Glob",
          input: { pattern: "*.ts" },
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
      const toolExecutor = createMockToolExecutor({
        success: true,
        result: "plain text result",
      });
      const cliHandle = createMockCliHandle([
        {
          type: "tool_use",
          id: "tool-string",
          name: "Bash",
          input: { command: "echo test" },
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
      const toolExecutor = createMockToolExecutor({
        success: true,
        result: '{"content": "file data"}',
      });

      const cliHandle = createMockCliHandle([
        { type: "thinking", content: "Let me read the file" },
        { type: "text", content: "I'll read the file for you. " },
        {
          type: "tool_use",
          id: "tool-full",
          name: "Read",
          input: { file_path: "/src/index.ts" },
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
});
