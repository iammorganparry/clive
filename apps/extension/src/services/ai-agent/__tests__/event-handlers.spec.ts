import { expect, vi } from "vitest";
import { describe, it } from "@effect/vitest";
import { Effect, Ref, HashMap } from "effect";
import {
  handleToolCallStreamingStart,
  handleToolCallDelta,
  handleToolCall,
  handleTextDelta,
  handleThinking,
  handleToolResult,
} from "../event-handlers";
import {
  createAgentState,
  createStreamingState,
  hasStreamingArgs,
  getStreamingArgs,
} from "../agent-state";

// Mock the streaming tools using factory - use async import to avoid hoisting issues
vi.mock("../tools/write-test-file", async () => {
  const { createMockStreamingWrite } = await import("../../../__tests__/mock-factories");
  return createMockStreamingWrite();
});

vi.mock("../tools/propose-test-plan", async () => {
  const { createMockPlanStreaming } = await import("../../../__tests__/mock-factories");
  return createMockPlanStreaming();
});

describe("Event Handlers", () => {
  describe("handleToolCallStreamingStart", () => {
    it.effect("should initialize streaming args for writeTestFile", () =>
      Effect.gen(function* () {
        const streamingState = yield* createStreamingState();
        const correlationId = "test-123";

        yield* handleToolCallStreamingStart(
          { toolName: "writeTestFile", toolCallId: "tool-abc" },
          streamingState,
          correlationId,
        );

        const hasArgs = yield* hasStreamingArgs(streamingState, "tool-abc");
        expect(hasArgs).toBe(true);
      }),
    );

    it.effect("should initialize streaming args for proposeTestPlan", () =>
      Effect.gen(function* () {
        const streamingState = yield* createStreamingState();
        const correlationId = "test-123";

        yield* handleToolCallStreamingStart(
          { toolName: "proposeTestPlan", toolCallId: "tool-def" },
          streamingState,
          correlationId,
        );

        const hasArgs = yield* hasStreamingArgs(streamingState, "tool-def");
        expect(hasArgs).toBe(true);
      }),
    );

    it.effect("should not initialize for other tool types", () =>
      Effect.gen(function* () {
        const streamingState = yield* createStreamingState();
        const correlationId = "test-123";

        yield* handleToolCallStreamingStart(
          { toolName: "bashExecute", toolCallId: "tool-ghi" },
          streamingState,
          correlationId,
        );

        const hasArgs = yield* hasStreamingArgs(streamingState, "tool-ghi");
        expect(hasArgs).toBe(false);
      }),
    );

    it.effect("should handle missing toolCallId gracefully", () =>
      Effect.gen(function* () {
        const streamingState = yield* createStreamingState();
        const correlationId = "test-123";

        // Should not throw
        yield* handleToolCallStreamingStart(
          { toolName: "writeTestFile", toolCallId: undefined },
          streamingState,
          correlationId,
        );

        // State should be unchanged
        const state = yield* Ref.get(streamingState);
        expect(HashMap.size(state.streamingArgsText)).toBe(0);
      }),
    );
  });

  describe("handleTextDelta", () => {
    it.effect("should emit content_streamed event", () =>
      Effect.gen(function* () {
        const events: Array<{ status: string; message: string }> = [];
        const progressCallback = (status: string, message: string) => {
          events.push({ status, message });
        };

        yield* handleTextDelta({ content: "Hello world" }, progressCallback);

        expect(events.length).toBe(1);
        expect(events[0].status).toBe("content_streamed");
        const parsed = JSON.parse(events[0].message);
        expect(parsed.type).toBe("content_streamed");
        expect(parsed.content).toBe("Hello world");
      }),
    );

    it.effect("should not emit for empty content", () =>
      Effect.gen(function* () {
        const events: Array<{ status: string; message: string }> = [];
        const progressCallback = (status: string, message: string) => {
          events.push({ status, message });
        };

        yield* handleTextDelta({ content: "" }, progressCallback);
        yield* handleTextDelta({ content: undefined }, progressCallback);
        yield* handleTextDelta({}, progressCallback);

        expect(events.length).toBe(0);
      }),
    );

    it.effect("should handle undefined progressCallback", () =>
      Effect.gen(function* () {
        // Should not throw
        yield* handleTextDelta({ content: "test" }, undefined);
      }),
    );
  });

  describe("handleThinking", () => {
    it.effect("should emit reasoning event with content", () =>
      Effect.gen(function* () {
        const events: Array<{ status: string; message: string }> = [];
        const progressCallback = (status: string, message: string) => {
          events.push({ status, message });
        };

        yield* handleThinking(
          { content: "I am thinking about this problem" },
          progressCallback,
          "test-123",
        );

        expect(events.length).toBe(1);
        expect(events[0].status).toBe("reasoning");
        const parsed = JSON.parse(events[0].message);
        expect(parsed.type).toBe("reasoning");
        expect(parsed.content).toBe("I am thinking about this problem");
      }),
    );

    it.effect("should not emit for empty content", () =>
      Effect.gen(function* () {
        const events: Array<{ status: string; message: string }> = [];
        const progressCallback = (status: string, message: string) => {
          events.push({ status, message });
        };

        yield* handleThinking({ content: "" }, progressCallback, "test-123");
        yield* handleThinking({ content: undefined }, progressCallback, "test-123");

        expect(events.length).toBe(0);
      }),
    );
  });

  describe("handleToolCall", () => {
    it.effect("should emit tool-call event", () =>
      Effect.gen(function* () {
        const agentState = yield* createAgentState();
        const streamingState = yield* createStreamingState();
        const events: Array<{ status: string; message: string }> = [];
        const progressCallback = (status: string, message: string) => {
          events.push({ status, message });
        };

        yield* handleToolCall(
          { toolName: "bashExecute", toolCallId: "call-123", toolArgs: { command: "echo test" } },
          agentState,
          streamingState,
          progressCallback,
          "corr-123",
        );

        const toolCallEvent = events.find((e) => e.status === "tool-call");
        expect(toolCallEvent).toBeDefined();
        const parsed = toolCallEvent ? JSON.parse(toolCallEvent.message) : null;
        expect(parsed?.toolName).toBe("bashExecute");
        expect(parsed?.toolCallId).toBe("call-123");
        expect(parsed?.state).toBe("input-available");
      }),
    );

    it.effect("should skip tool when rejection cascade is active", () =>
      Effect.gen(function* () {
        const agentState = yield* createAgentState();
        const streamingState = yield* createStreamingState();

        // Set rejection flag
        yield* Ref.update(agentState, (s) => ({ ...s, didRejectTool: true }));

        const events: Array<{ status: string; message: string }> = [];
        const progressCallback = (status: string, message: string) => {
          events.push({ status, message });
        };

        yield* handleToolCall(
          { toolName: "bashExecute", toolCallId: "call-456", toolArgs: {} },
          agentState,
          streamingState,
          progressCallback,
          "corr-123",
        );

        const skippedEvent = events.find((e) => e.status === "tool-skipped");
        expect(skippedEvent).toBeDefined();
        const parsed = skippedEvent ? JSON.parse(skippedEvent.message) : null;
        expect(parsed?.reason).toContain("rejected");
      }),
    );

    it.effect("should emit progress for test commands", () =>
      Effect.gen(function* () {
        const agentState = yield* createAgentState();
        const streamingState = yield* createStreamingState();
        const events: Array<{ status: string; message: string }> = [];
        const progressCallback = (status: string, message: string) => {
          events.push({ status, message });
        };

        yield* handleToolCall(
          { toolName: "bashExecute", toolCallId: "call-789", toolArgs: { command: "npm run vitest" } },
          agentState,
          streamingState,
          progressCallback,
          "corr-123",
        );

        const runningEvent = events.find((e) => e.status === "running");
        expect(runningEvent).toBeDefined();
      }),
    );

    it.effect("should handle missing toolCallId gracefully", () =>
      Effect.gen(function* () {
        const agentState = yield* createAgentState();
        const streamingState = yield* createStreamingState();
        const events: Array<{ status: string; message: string }> = [];
        const progressCallback = (status: string, message: string) => {
          events.push({ status, message });
        };

        yield* handleToolCall(
          { toolName: "bashExecute", toolCallId: undefined, toolArgs: {} },
          agentState,
          streamingState,
          progressCallback,
          "corr-123",
        );

        // Should not emit tool-call event without toolCallId
        const toolCallEvent = events.find((e) => e.status === "tool-call");
        expect(toolCallEvent).toBeUndefined();
      }),
    );
  });

  describe("handleToolResult", () => {
    it.effect("should emit tool-result event", () =>
      Effect.gen(function* () {
        const agentState = yield* createAgentState();
        const streamingState = yield* createStreamingState();
        const events: Array<{ status: string; message: string }> = [];
        const progressCallback = (status: string, message: string) => {
          events.push({ status, message });
        };

        yield* handleToolResult(
          {
            toolName: "bashExecute",
            toolCallId: "result-123",
            toolResult: { output: { success: true, stdout: "test" } },
          },
          agentState,
          streamingState,
          progressCallback,
          "corr-123",
        );

        const resultEvent = events.find((e) => e.status === "tool-result");
        expect(resultEvent).toBeDefined();
        const parsed = resultEvent ? JSON.parse(resultEvent.message) : null;
        expect(parsed?.toolName).toBe("bashExecute");
        expect(parsed?.state).toBe("output-available");
      }),
    );

    it.effect("should detect tool rejection and set flag", () =>
      Effect.gen(function* () {
        const agentState = yield* createAgentState();
        const streamingState = yield* createStreamingState();

        yield* handleToolResult(
          {
            toolName: "bashExecute",
            toolCallId: "result-456",
            toolResult: { output: { rejected: true } },
          },
          agentState,
          streamingState,
          undefined,
          "corr-123",
        );

        const state = yield* Ref.get(agentState);
        expect(state.didRejectTool).toBe(true);
      }),
    );

    it.effect("should detect completeTask completion", () =>
      Effect.gen(function* () {
        const agentState = yield* createAgentState();
        const streamingState = yield* createStreamingState();

        yield* handleToolResult(
          {
            toolName: "completeTask",
            toolCallId: "complete-789",
            toolResult: { output: { success: true, completed: true, message: "Done" } },
          },
          agentState,
          streamingState,
          undefined,
          "corr-123",
        );

        const state = yield* Ref.get(agentState);
        expect(state.taskCompleted).toBe(true);
      }),
    );

    it.effect("should increment mistakes on failure", () =>
      Effect.gen(function* () {
        const agentState = yield* createAgentState();
        const streamingState = yield* createStreamingState();

        yield* handleToolResult(
          {
            toolName: "bashExecute",
            toolCallId: "fail-123",
            toolResult: { output: { success: false, message: "Command failed" } },
          },
          agentState,
          streamingState,
          undefined,
          "corr-123",
        );

        const state = yield* Ref.get(agentState);
        expect(state.consecutiveMistakes).toBe(1);
      }),
    );

    it.effect("should reset mistakes on success", () =>
      Effect.gen(function* () {
        const agentState = yield* createAgentState();
        const streamingState = yield* createStreamingState();

        // First increment mistakes
        yield* Ref.update(agentState, (s) => ({ ...s, consecutiveMistakes: 3 }));

        // Then succeed
        yield* handleToolResult(
          {
            toolName: "bashExecute",
            toolCallId: "success-123",
            toolResult: { output: { success: true, stdout: "OK" } },
          },
          agentState,
          streamingState,
          undefined,
          "corr-123",
        );

        const state = yield* Ref.get(agentState);
        expect(state.consecutiveMistakes).toBe(0);
      }),
    );

    it.effect("should detect new diagnostic problems", () =>
      Effect.gen(function* () {
        const agentState = yield* createAgentState();
        const streamingState = yield* createStreamingState();
        const events: Array<{ status: string; message: string }> = [];
        const progressCallback = (status: string, message: string) => {
          events.push({ status, message });
        };

        yield* handleToolResult(
          {
            toolName: "writeTestFile",
            toolCallId: "diag-123",
            toolResult: {
              output: {
                success: true,
                message: "File saved. New diagnostic problems introduced: Line 5 error",
              },
            },
          },
          agentState,
          streamingState,
          progressCallback,
          "corr-123",
        );

        const diagEvent = events.find((e) => e.status === "diagnostic-problems");
        expect(diagEvent).toBeDefined();

        const state = yield* Ref.get(agentState);
        expect(state.consecutiveMistakes).toBe(1);
      }),
    );

    it.effect("should emit mistake-limit when limit reached", () =>
      Effect.gen(function* () {
        const agentState = yield* createAgentState();
        const streamingState = yield* createStreamingState();
        const events: Array<{ status: string; message: string }> = [];
        const progressCallback = (status: string, message: string) => {
          events.push({ status, message });
        };

        // Pre-set to 4 mistakes
        yield* Ref.update(agentState, (s) => ({ ...s, consecutiveMistakes: 4 }));

        // Fail once more to hit limit of 5
        yield* handleToolResult(
          {
            toolName: "bashExecute",
            toolCallId: "limit-123",
            toolResult: { output: { success: false } },
          },
          agentState,
          streamingState,
          progressCallback,
          "corr-123",
        );

        const limitEvent = events.find((e) => e.status === "mistake-limit");
        expect(limitEvent).toBeDefined();
        const parsed = limitEvent ? JSON.parse(limitEvent.message) : null;
        expect(parsed?.count).toBe(5);
      }),
    );

    it.effect("should add execution for successful writeTestFile", () =>
      Effect.gen(function* () {
        const agentState = yield* createAgentState();
        const streamingState = yield* createStreamingState();

        yield* handleToolResult(
          {
            toolName: "writeTestFile",
            toolCallId: "write-123",
            toolResult: {
              output: {
                success: true,
                filePath: "/tests/my-test.spec.ts",
                message: "File created",
              },
            },
          },
          agentState,
          streamingState,
          undefined,
          "corr-123",
        );

        const state = yield* Ref.get(agentState);
        expect(state.executions.length).toBe(1);
        expect(state.executions[0].filePath).toBe("/tests/my-test.spec.ts");
      }),
    );
  });

  describe("handleToolCallDelta", () => {
    it.effect("should accumulate args for writeTestFile", () =>
      Effect.gen(function* () {
        const streamingState = yield* createStreamingState();
        const correlationId = "test-123";

        // Initialize streaming
        yield* handleToolCallStreamingStart(
          { toolName: "writeTestFile", toolCallId: "delta-123" },
          streamingState,
          correlationId,
        );

        // Send deltas
        yield* handleToolCallDelta(
          { toolName: "writeTestFile", toolCallId: "delta-123", argsTextDelta: '{"target' },
          streamingState,
          undefined,
          correlationId,
        );

        yield* handleToolCallDelta(
          { toolName: "writeTestFile", toolCallId: "delta-123", argsTextDelta: 'Path": "test.ts"}' },
          streamingState,
          undefined,
          correlationId,
        );

        const args = yield* getStreamingArgs(streamingState, "delta-123");
        expect(args).toBe('{"targetPath": "test.ts"}');
      }),
    );

    it.effect("should handle missing argsTextDelta", () =>
      Effect.gen(function* () {
        const streamingState = yield* createStreamingState();
        const correlationId = "test-123";

        // Should not throw
        yield* handleToolCallDelta(
          { toolName: "writeTestFile", toolCallId: "delta-456", argsTextDelta: undefined },
          streamingState,
          undefined,
          correlationId,
        );
      }),
    );
  });
});

