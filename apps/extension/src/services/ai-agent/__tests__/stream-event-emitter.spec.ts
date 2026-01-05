/**
 * Stream Event Emitter Tests
 * Tests for event emission helper functions
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { emitStreamEvent, emit } from "../stream-event-emitter.js";
import type { ProgressCallback } from "../event-handlers.js";

describe("stream-event-emitter", () => {
  let mockCallback: ProgressCallback;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallback = vi.fn();
  });

  describe("emitStreamEvent", () => {
    it("should call callback with event type and serialized event", () => {
      const event = {
        type: "content_streamed" as const,
        content: "test content",
      };

      emitStreamEvent(mockCallback, event);

      expect(mockCallback).toHaveBeenCalledTimes(1);
      expect(mockCallback).toHaveBeenCalledWith(
        "content_streamed",
        JSON.stringify(event),
      );
    });

    it("should handle undefined callback gracefully", () => {
      const event = {
        type: "content_streamed" as const,
        content: "test content",
      };

      expect(() => emitStreamEvent(undefined, event)).not.toThrow();
    });

    it("should serialize complex event objects correctly", () => {
      const event = {
        type: "tool-call" as const,
        toolCallId: "call-123",
        toolName: "testTool",
        args: { key: "value", nested: { prop: 42 } },
        state: "input-available" as const,
      };

      emitStreamEvent(mockCallback, event);

      const serialized = JSON.stringify(event);
      expect(mockCallback).toHaveBeenCalledWith("tool-call", serialized);
      expect(JSON.parse(serialized)).toEqual(event);
    });
  });

  describe("emit.contentStreamed", () => {
    it("should emit content_streamed event with correct structure", () => {
      emit.contentStreamed(mockCallback, "test content");

      expect(mockCallback).toHaveBeenCalledWith(
        "content_streamed",
        JSON.stringify({ type: "content_streamed", content: "test content" }),
      );
    });

    it("should handle undefined callback gracefully", () => {
      expect(() => emit.contentStreamed(undefined, "test")).not.toThrow();
    });
  });

  describe("emit.reasoning", () => {
    it("should emit reasoning event with correct structure", () => {
      emit.reasoning(mockCallback, "thinking...");

      expect(mockCallback).toHaveBeenCalledWith(
        "reasoning",
        JSON.stringify({ type: "reasoning", content: "thinking..." }),
      );
    });

    it("should handle undefined callback gracefully", () => {
      expect(() => emit.reasoning(undefined, "test")).not.toThrow();
    });
  });

  describe("emit.toolCall", () => {
    it("should emit tool-call event with all parameters", () => {
      const args = { param: "value" };
      emit.toolCall(
        mockCallback,
        "call-123",
        "testTool",
        args,
        "input-available",
        true,
      );

      expect(mockCallback).toHaveBeenCalledWith(
        "tool-call",
        JSON.stringify({
          type: "tool-call",
          toolCallId: "call-123",
          toolName: "testTool",
          args,
          state: "input-available",
          isMcpTool: true,
        }),
      );
    });

    it("should emit tool-call event without optional isMcpTool parameter", () => {
      emit.toolCall(
        mockCallback,
        "call-456",
        "otherTool",
        {},
        "input-streaming",
      );

      const callArgs = vi.mocked(mockCallback).mock.calls[0];
      const event = JSON.parse(callArgs[1] as string);
      expect(event.isMcpTool).toBeUndefined();
    });

    it("should handle undefined callback gracefully", () => {
      expect(() =>
        emit.toolCall(undefined, "call-123", "test", {}, "input-available"),
      ).not.toThrow();
    });
  });

  describe("emit.toolResult", () => {
    it("should emit tool-result event with output-available state", () => {
      const output = { result: "success" };
      emit.toolResult(
        mockCallback,
        "call-123",
        "testTool",
        output,
        "output-available",
      );

      expect(mockCallback).toHaveBeenCalledWith(
        "tool-result",
        JSON.stringify({
          type: "tool-result",
          toolCallId: "call-123",
          toolName: "testTool",
          output,
          state: "output-available",
        }),
      );
    });

    it("should emit tool-result event with output-error state", () => {
      emit.toolResult(
        mockCallback,
        "call-456",
        "failTool",
        "error message",
        "output-error",
      );

      const callArgs = vi.mocked(mockCallback).mock.calls[0];
      const event = JSON.parse(callArgs[1] as string);
      expect(event.state).toBe("output-error");
    });

    it("should handle undefined callback gracefully", () => {
      expect(() =>
        emit.toolResult(undefined, "call-123", "test", {}, "output-available"),
      ).not.toThrow();
    });
  });

  describe("emit.planContent", () => {
    it("should emit plan-content-streaming event with all parameters", () => {
      emit.planContent(
        mockCallback,
        "call-123",
        "plan content",
        false,
        "/path/to/plan.md",
      );

      expect(mockCallback).toHaveBeenCalledWith(
        "plan-content-streaming",
        JSON.stringify({
          type: "plan-content-streaming",
          toolCallId: "call-123",
          content: "plan content",
          isComplete: false,
          filePath: "/path/to/plan.md",
        }),
      );
    });

    it("should emit plan-content-streaming event without optional filePath", () => {
      emit.planContent(mockCallback, "call-456", "content", true);

      const callArgs = vi.mocked(mockCallback).mock.calls[0];
      const event = JSON.parse(callArgs[1] as string);
      expect(event.isComplete).toBe(true);
      expect(event.filePath).toBeUndefined();
    });

    it("should handle undefined callback gracefully", () => {
      expect(() =>
        emit.planContent(undefined, "call-123", "content", false),
      ).not.toThrow();
    });
  });

  describe("emit.nativePlanModeEntered", () => {
    it("should emit native-plan-mode-entered event", () => {
      emit.nativePlanModeEntered(mockCallback, "call-123");

      expect(mockCallback).toHaveBeenCalledWith(
        "native-plan-mode-entered",
        JSON.stringify({
          type: "native-plan-mode-entered",
          toolCallId: "call-123",
        }),
      );
    });

    it("should handle undefined callback gracefully", () => {
      expect(() =>
        emit.nativePlanModeEntered(undefined, "call-123"),
      ).not.toThrow();
    });
  });

  describe("emit.nativePlanModeExiting", () => {
    it("should emit native-plan-mode-exiting event with planFilePath", () => {
      emit.nativePlanModeExiting(mockCallback, "call-123", "/path/to/plan.md");

      expect(mockCallback).toHaveBeenCalledWith(
        "native-plan-mode-exiting",
        JSON.stringify({
          type: "native-plan-mode-exiting",
          toolCallId: "call-123",
          planFilePath: "/path/to/plan.md",
        }),
      );
    });

    it("should emit native-plan-mode-exiting event without planFilePath", () => {
      emit.nativePlanModeExiting(mockCallback, "call-456");

      const callArgs = vi.mocked(mockCallback).mock.calls[0];
      const event = JSON.parse(callArgs[1] as string);
      expect(event.planFilePath).toBeUndefined();
    });

    it("should handle undefined callback gracefully", () => {
      expect(() =>
        emit.nativePlanModeExiting(undefined, "call-123"),
      ).not.toThrow();
    });
  });

  describe("emit.fileCreated", () => {
    it("should emit file-created event", () => {
      emit.fileCreated(mockCallback, "call-123", "/path/to/file.ts");

      expect(mockCallback).toHaveBeenCalledWith(
        "file-created",
        JSON.stringify({
          type: "file-created",
          toolCallId: "call-123",
          filePath: "/path/to/file.ts",
        }),
      );
    });

    it("should handle undefined callback gracefully", () => {
      expect(() =>
        emit.fileCreated(undefined, "call-123", "/path"),
      ).not.toThrow();
    });
  });

  describe("emit.error", () => {
    it("should emit error event", () => {
      emit.error(mockCallback, "Something went wrong");

      expect(mockCallback).toHaveBeenCalledWith(
        "error",
        JSON.stringify({
          type: "error",
          message: "Something went wrong",
        }),
      );
    });

    it("should handle undefined callback gracefully", () => {
      expect(() => emit.error(undefined, "error")).not.toThrow();
    });
  });

  describe("emit.toolSkipped", () => {
    it("should emit tool-skipped event with all parameters", () => {
      emit.toolSkipped(
        mockCallback,
        "call-123",
        "testTool",
        "User denied permission",
      );

      expect(mockCallback).toHaveBeenCalledWith(
        "tool-skipped",
        JSON.stringify({
          type: "tool-skipped",
          toolCallId: "call-123",
          toolName: "testTool",
          reason: "User denied permission",
        }),
      );
    });

    it("should emit tool-skipped event with undefined toolName", () => {
      emit.toolSkipped(mockCallback, "call-456", undefined, "Unknown tool");

      const callArgs = vi.mocked(mockCallback).mock.calls[0];
      const event = JSON.parse(callArgs[1] as string);
      expect(event.toolName).toBeUndefined();
    });

    it("should handle undefined callback gracefully", () => {
      expect(() =>
        emit.toolSkipped(undefined, "call-123", "test", "reason"),
      ).not.toThrow();
    });
  });

  describe("emit.diagnosticProblems", () => {
    it("should emit diagnostic-problems event with all parameters", () => {
      emit.diagnosticProblems(mockCallback, "call-123", "testTool");

      expect(mockCallback).toHaveBeenCalledWith(
        "diagnostic-problems",
        JSON.stringify({
          type: "diagnostic-problems",
          toolCallId: "call-123",
          toolName: "testTool",
        }),
      );
    });

    it("should emit diagnostic-problems event without optional parameters", () => {
      emit.diagnosticProblems(mockCallback);

      const callArgs = vi.mocked(mockCallback).mock.calls[0];
      const event = JSON.parse(callArgs[1] as string);
      expect(event.toolCallId).toBeUndefined();
      expect(event.toolName).toBeUndefined();
    });

    it("should handle undefined callback gracefully", () => {
      expect(() => emit.diagnosticProblems(undefined)).not.toThrow();
    });
  });

  describe("emit.mistakeLimit", () => {
    it("should emit mistake-limit event", () => {
      emit.mistakeLimit(mockCallback, 5, "5 consecutive mistakes detected");

      expect(mockCallback).toHaveBeenCalledWith(
        "mistake-limit",
        JSON.stringify({
          type: "mistake-limit",
          count: 5,
          message: "5 consecutive mistakes detected",
        }),
      );
    });

    it("should handle undefined callback gracefully", () => {
      expect(() => emit.mistakeLimit(undefined, 3, "test")).not.toThrow();
    });
  });

  describe("emit.loopIterationStart", () => {
    it("should emit loop-iteration-start event", () => {
      emit.loopIterationStart(mockCallback, 1, 10);

      expect(mockCallback).toHaveBeenCalledWith(
        "loop-iteration-start",
        JSON.stringify({
          type: "loop-iteration-start",
          iteration: 1,
          maxIterations: 10,
        }),
      );
    });

    it("should handle undefined callback gracefully", () => {
      expect(() => emit.loopIterationStart(undefined, 1, 10)).not.toThrow();
    });
  });

  describe("emit.loopIterationComplete", () => {
    it("should emit loop-iteration-complete event with todos and progress", () => {
      const todos = [
        { content: "Test 1", status: "completed", activeForm: "Testing 1" },
        { content: "Test 2", status: "in_progress", activeForm: "Testing 2" },
      ];
      const progress = {
        completed: 1,
        pending: 1,
        total: 2,
        percentComplete: 50,
      };

      emit.loopIterationComplete(mockCallback, 1, todos, progress);

      expect(mockCallback).toHaveBeenCalledWith(
        "loop-iteration-complete",
        JSON.stringify({
          type: "loop-iteration-complete",
          iteration: 1,
          todos,
          progress,
        }),
      );
    });

    it("should handle undefined callback gracefully", () => {
      expect(() =>
        emit.loopIterationComplete(undefined, 1, [], {
          completed: 0,
          pending: 0,
          total: 0,
          percentComplete: 0,
        }),
      ).not.toThrow();
    });
  });

  describe("emit.loopComplete", () => {
    it("should emit loop-complete event with complete reason", () => {
      const todos = [
        { content: "Test 1", status: "completed", activeForm: "Testing 1" },
      ];
      const progress = {
        completed: 1,
        pending: 0,
        total: 1,
        percentComplete: 100,
      };

      emit.loopComplete(mockCallback, "complete", 5, todos, progress);

      expect(mockCallback).toHaveBeenCalledWith(
        "loop-complete",
        JSON.stringify({
          type: "loop-complete",
          reason: "complete",
          iteration: 5,
          todos,
          progress,
        }),
      );
    });

    it("should emit loop-complete event with max_iterations reason", () => {
      const todos: { content: string; status: string; activeForm: string }[] =
        [];
      const progress = {
        completed: 0,
        pending: 2,
        total: 2,
        percentComplete: 0,
      };

      emit.loopComplete(mockCallback, "max_iterations", 10, todos, progress);

      const callArgs = vi.mocked(mockCallback).mock.calls[0];
      const event = JSON.parse(callArgs[1] as string);
      expect(event.reason).toBe("max_iterations");
      expect(event.iteration).toBe(10);
    });

    it("should emit loop-complete event with error reason", () => {
      const todos: { content: string; status: string; activeForm: string }[] =
        [];
      const progress = {
        completed: 0,
        pending: 2,
        total: 2,
        percentComplete: 0,
      };

      emit.loopComplete(mockCallback, "error", 3, todos, progress);

      const callArgs = vi.mocked(mockCallback).mock.calls[0];
      const event = JSON.parse(callArgs[1] as string);
      expect(event.reason).toBe("error");
    });

    it("should emit loop-complete event with cancelled reason", () => {
      const todos: { content: string; status: string; activeForm: string }[] =
        [];
      const progress = {
        completed: 0,
        pending: 2,
        total: 2,
        percentComplete: 0,
      };

      emit.loopComplete(mockCallback, "cancelled", 2, todos, progress);

      const callArgs = vi.mocked(mockCallback).mock.calls[0];
      const event = JSON.parse(callArgs[1] as string);
      expect(event.reason).toBe("cancelled");
    });

    it("should handle undefined callback gracefully", () => {
      expect(() =>
        emit.loopComplete(undefined, "cancelled", 1, [], {
          completed: 0,
          pending: 0,
          total: 0,
          percentComplete: 0,
        }),
      ).not.toThrow();
    });
  });

  describe("emit.todosUpdated", () => {
    it("should emit todos-updated event", () => {
      const todos = [
        { content: "Test 1", status: "completed", activeForm: "Testing 1" },
        { content: "Test 2", status: "pending", activeForm: "Testing 2" },
      ];
      const progress = {
        completed: 1,
        pending: 1,
        total: 2,
        percentComplete: 50,
      };

      emit.todosUpdated(mockCallback, todos, progress);

      expect(mockCallback).toHaveBeenCalledWith(
        "todos-updated",
        JSON.stringify({
          type: "todos-updated",
          todos,
          progress,
        }),
      );
    });

    it("should handle undefined callback gracefully", () => {
      expect(() =>
        emit.todosUpdated(undefined, [], {
          completed: 0,
          pending: 0,
          total: 0,
          percentComplete: 0,
        }),
      ).not.toThrow();
    });
  });
});
