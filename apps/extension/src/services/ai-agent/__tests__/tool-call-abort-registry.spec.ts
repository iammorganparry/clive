import { describe, it, expect, beforeEach } from "vitest";
import { ToolCallAbortRegistry } from "../tool-call-abort-registry";

describe("ToolCallAbortRegistry", () => {
  beforeEach(() => {
    // Clean up any registered tool calls between tests
    // We'll need to add a reset method or just test in isolation
    // For now, we'll use unique IDs per test to avoid conflicts
  });

  describe("register", () => {
    it("should return an AbortController for a new toolCallId", () => {
      const toolCallId = "test-tool-call-1";
      const controller = ToolCallAbortRegistry.register(toolCallId);

      expect(controller).toBeInstanceOf(AbortController);
      expect(controller.signal.aborted).toBe(false);

      // Cleanup
      ToolCallAbortRegistry.cleanup(toolCallId);
    });

    it("should abort existing controller when registering same toolCallId", () => {
      const toolCallId = "test-tool-call-2";
      const controller1 = ToolCallAbortRegistry.register(toolCallId);
      const controller2 = ToolCallAbortRegistry.register(toolCallId);

      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(false);

      // Cleanup
      ToolCallAbortRegistry.cleanup(toolCallId);
    });
  });

  describe("abort", () => {
    it("should abort a registered tool call and return true", () => {
      const toolCallId = "test-tool-call-3";
      const controller = ToolCallAbortRegistry.register(toolCallId);

      const result = ToolCallAbortRegistry.abort(toolCallId);

      expect(result).toBe(true);
      expect(controller.signal.aborted).toBe(true);
    });

    it("should return false for non-existent toolCallId", () => {
      const result = ToolCallAbortRegistry.abort("non-existent-id");

      expect(result).toBe(false);
    });

    it("should remove the toolCallId from registry after abort", () => {
      const toolCallId = "test-tool-call-4";
      ToolCallAbortRegistry.register(toolCallId);

      ToolCallAbortRegistry.abort(toolCallId);

      // Second abort should return false since it was removed
      expect(ToolCallAbortRegistry.abort(toolCallId)).toBe(false);
    });
  });

  describe("cleanup", () => {
    it("should remove toolCallId from registry without aborting", () => {
      const toolCallId = "test-tool-call-5";
      const controller = ToolCallAbortRegistry.register(toolCallId);

      ToolCallAbortRegistry.cleanup(toolCallId);

      // Controller should NOT be aborted
      expect(controller.signal.aborted).toBe(false);
      // But it should be removed from registry
      expect(ToolCallAbortRegistry.isRunning(toolCallId)).toBe(false);
    });
  });

  describe("isRunning", () => {
    it("should return true for registered and non-aborted tool call", () => {
      const toolCallId = "test-tool-call-6";
      ToolCallAbortRegistry.register(toolCallId);

      expect(ToolCallAbortRegistry.isRunning(toolCallId)).toBe(true);

      // Cleanup
      ToolCallAbortRegistry.cleanup(toolCallId);
    });

    it("should return false for non-existent toolCallId", () => {
      expect(ToolCallAbortRegistry.isRunning("non-existent")).toBe(false);
    });

    it("should return false after abort", () => {
      const toolCallId = "test-tool-call-7";
      ToolCallAbortRegistry.register(toolCallId);
      ToolCallAbortRegistry.abort(toolCallId);

      expect(ToolCallAbortRegistry.isRunning(toolCallId)).toBe(false);
    });
  });
});
