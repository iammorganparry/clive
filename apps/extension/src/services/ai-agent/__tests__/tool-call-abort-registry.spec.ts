import { beforeEach, describe, expect, it } from "vitest";
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

  describe("abortAll", () => {
    it("should abort all running tool calls and return count", () => {
      const toolCallId1 = "test-abort-all-1";
      const toolCallId2 = "test-abort-all-2";
      const toolCallId3 = "test-abort-all-3";

      const controller1 = ToolCallAbortRegistry.register(toolCallId1);
      const controller2 = ToolCallAbortRegistry.register(toolCallId2);
      const controller3 = ToolCallAbortRegistry.register(toolCallId3);

      const abortedCount = ToolCallAbortRegistry.abortAll();

      expect(abortedCount).toBe(3);
      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(true);
      expect(controller3.signal.aborted).toBe(true);
    });

    it("should return 0 when no tool calls are running", () => {
      // Ensure registry is clean
      ToolCallAbortRegistry.abortAll();

      const abortedCount = ToolCallAbortRegistry.abortAll();

      expect(abortedCount).toBe(0);
    });

    it("should clear all tool calls from registry", () => {
      const toolCallId1 = "test-abort-all-clear-1";
      const toolCallId2 = "test-abort-all-clear-2";

      ToolCallAbortRegistry.register(toolCallId1);
      ToolCallAbortRegistry.register(toolCallId2);

      ToolCallAbortRegistry.abortAll();

      expect(ToolCallAbortRegistry.isRunning(toolCallId1)).toBe(false);
      expect(ToolCallAbortRegistry.isRunning(toolCallId2)).toBe(false);
      expect(ToolCallAbortRegistry.getRunningCount()).toBe(0);
    });
  });

  describe("getRunningCount", () => {
    it("should return 0 when no tool calls are registered", () => {
      // Ensure registry is clean
      ToolCallAbortRegistry.abortAll();

      expect(ToolCallAbortRegistry.getRunningCount()).toBe(0);
    });

    it("should return correct count of running tool calls", () => {
      const toolCallId1 = "test-count-1";
      const toolCallId2 = "test-count-2";

      ToolCallAbortRegistry.register(toolCallId1);
      expect(ToolCallAbortRegistry.getRunningCount()).toBe(1);

      ToolCallAbortRegistry.register(toolCallId2);
      expect(ToolCallAbortRegistry.getRunningCount()).toBe(2);

      // Cleanup
      ToolCallAbortRegistry.abortAll();
    });

    it("should decrease count after abort", () => {
      const toolCallId1 = "test-count-abort-1";
      const toolCallId2 = "test-count-abort-2";

      ToolCallAbortRegistry.register(toolCallId1);
      ToolCallAbortRegistry.register(toolCallId2);

      expect(ToolCallAbortRegistry.getRunningCount()).toBe(2);

      ToolCallAbortRegistry.abort(toolCallId1);

      expect(ToolCallAbortRegistry.getRunningCount()).toBe(1);

      // Cleanup
      ToolCallAbortRegistry.abortAll();
    });
  });

  describe("getRunningToolCallIds", () => {
    it("should return empty array when no tool calls are registered", () => {
      // Ensure registry is clean
      ToolCallAbortRegistry.abortAll();

      expect(ToolCallAbortRegistry.getRunningToolCallIds()).toEqual([]);
    });

    it("should return all running tool call IDs", () => {
      const toolCallId1 = "test-ids-1";
      const toolCallId2 = "test-ids-2";

      ToolCallAbortRegistry.register(toolCallId1);
      ToolCallAbortRegistry.register(toolCallId2);

      const ids = ToolCallAbortRegistry.getRunningToolCallIds();

      expect(ids).toContain(toolCallId1);
      expect(ids).toContain(toolCallId2);
      expect(ids.length).toBe(2);

      // Cleanup
      ToolCallAbortRegistry.abortAll();
    });

    it("should not include aborted tool calls", () => {
      const toolCallId1 = "test-ids-aborted-1";
      const toolCallId2 = "test-ids-aborted-2";

      ToolCallAbortRegistry.register(toolCallId1);
      ToolCallAbortRegistry.register(toolCallId2);

      ToolCallAbortRegistry.abort(toolCallId1);

      const ids = ToolCallAbortRegistry.getRunningToolCallIds();

      expect(ids).not.toContain(toolCallId1);
      expect(ids).toContain(toolCallId2);
      expect(ids.length).toBe(1);

      // Cleanup
      ToolCallAbortRegistry.abortAll();
    });
  });

  describe("race condition handling", () => {
    it("should handle registration immediately followed by abortAll", () => {
      const toolCallId = "race-condition-1";

      // Simulate a race condition: register then immediately abortAll
      const controller = ToolCallAbortRegistry.register(toolCallId);
      const abortedCount = ToolCallAbortRegistry.abortAll();

      expect(abortedCount).toBe(1);
      expect(controller.signal.aborted).toBe(true);
      expect(ToolCallAbortRegistry.isRunning(toolCallId)).toBe(false);
    });

    it("should handle multiple rapid registrations and abortAll", () => {
      const ids = ["rapid-1", "rapid-2", "rapid-3", "rapid-4", "rapid-5"];
      const controllers: AbortController[] = [];

      // Rapid registration
      for (const id of ids) {
        controllers.push(ToolCallAbortRegistry.register(id));
      }

      // All should be running
      expect(ToolCallAbortRegistry.getRunningCount()).toBe(5);

      // AbortAll should handle all of them
      const abortedCount = ToolCallAbortRegistry.abortAll();

      expect(abortedCount).toBe(5);
      for (const controller of controllers) {
        expect(controller.signal.aborted).toBe(true);
      }
      expect(ToolCallAbortRegistry.getRunningCount()).toBe(0);
    });

    it("should handle abort listeners being triggered", () => {
      const toolCallId = "listener-test-1";
      let listenerCalled = false;

      const controller = ToolCallAbortRegistry.register(toolCallId);
      controller.signal.addEventListener("abort", () => {
        listenerCalled = true;
      });

      ToolCallAbortRegistry.abort(toolCallId);

      expect(listenerCalled).toBe(true);
    });

    it("should handle abort listeners with abortAll", () => {
      const toolCallId1 = "listener-all-1";
      const toolCallId2 = "listener-all-2";
      const listenersCalled: string[] = [];

      const controller1 = ToolCallAbortRegistry.register(toolCallId1);
      const controller2 = ToolCallAbortRegistry.register(toolCallId2);

      controller1.signal.addEventListener("abort", () => {
        listenersCalled.push(toolCallId1);
      });
      controller2.signal.addEventListener("abort", () => {
        listenersCalled.push(toolCallId2);
      });

      ToolCallAbortRegistry.abortAll();

      expect(listenersCalled).toContain(toolCallId1);
      expect(listenersCalled).toContain(toolCallId2);
      expect(listenersCalled.length).toBe(2);
    });

    it("should allow re-registration after abort", () => {
      const toolCallId = "re-register-1";

      // First registration and abort
      const controller1 = ToolCallAbortRegistry.register(toolCallId);
      ToolCallAbortRegistry.abort(toolCallId);

      expect(controller1.signal.aborted).toBe(true);
      expect(ToolCallAbortRegistry.isRunning(toolCallId)).toBe(false);

      // Re-registration should work
      const controller2 = ToolCallAbortRegistry.register(toolCallId);

      expect(controller2.signal.aborted).toBe(false);
      expect(ToolCallAbortRegistry.isRunning(toolCallId)).toBe(true);

      // Cleanup
      ToolCallAbortRegistry.cleanup(toolCallId);
    });

    it("should allow re-registration after abortAll", () => {
      const toolCallId = "re-register-all-1";

      // First registration and abortAll
      ToolCallAbortRegistry.register(toolCallId);
      ToolCallAbortRegistry.abortAll();

      // Re-registration should work
      const controller = ToolCallAbortRegistry.register(toolCallId);

      expect(controller.signal.aborted).toBe(false);
      expect(ToolCallAbortRegistry.isRunning(toolCallId)).toBe(true);

      // Cleanup
      ToolCallAbortRegistry.cleanup(toolCallId);
    });
  });
});
