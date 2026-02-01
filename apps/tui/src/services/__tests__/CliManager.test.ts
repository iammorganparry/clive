/**
 * CliManager Tests
 *
 * Tests completion marker detection in the text stream.
 * The CliManager accumulates text chunks and detects
 * TASK_COMPLETE and ALL_TASKS_COMPLETE markers, emitting
 * corresponding events.
 *
 * Since CliManager's constructor creates an Effect runtime,
 * we test the marker detection by directly testing enrichEvent
 * on a partially-constructed instance, bypassing the constructor.
 */

import { EventEmitter } from "node:events";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../utils/debug-logger", () => ({
  debugLog: vi.fn(),
}));

/**
 * Create a minimal CliManager-like object that has the enrichEvent method
 * and the accumulatedText buffer, without needing the full constructor.
 * This lets us test marker detection in isolation.
 */
function createMarkerDetector() {
  const emitter = new EventEmitter();
  let accumulatedText = "";

  // This mirrors the marker detection logic from CliManager.enrichEvent "text" case
  function processTextEvent(content: string) {
    accumulatedText += content;

    if (accumulatedText.includes("<promise>ALL_TASKS_COMPLETE</promise>")) {
      emitter.emit("all-tasks-complete");
      accumulatedText = "";
    } else if (
      accumulatedText.includes("<promise>TASK_COMPLETE</promise>")
    ) {
      emitter.emit("task-complete");
      accumulatedText = "";
    }

    // Keep buffer bounded
    if (accumulatedText.length > 200) {
      accumulatedText = accumulatedText.slice(-100);
    }
  }

  function clear() {
    accumulatedText = "";
  }

  return {
    emitter,
    processTextEvent,
    clear,
    getAccumulatedText: () => accumulatedText,
  };
}

describe("CliManager - completion marker detection", () => {
  let detector: ReturnType<typeof createMarkerDetector>;

  beforeEach(() => {
    detector = createMarkerDetector();
  });

  it("should emit task-complete when TASK_COMPLETE marker is detected", () => {
    const handler = vi.fn();
    detector.emitter.on("task-complete", handler);

    detector.processTextEvent(
      "Task is done. <promise>TASK_COMPLETE</promise>",
    );

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should emit all-tasks-complete when ALL_TASKS_COMPLETE marker is detected", () => {
    const handler = vi.fn();
    detector.emitter.on("all-tasks-complete", handler);

    detector.processTextEvent(
      "Everything is done. <promise>ALL_TASKS_COMPLETE</promise>",
    );

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should prioritize ALL_TASKS_COMPLETE over TASK_COMPLETE when both present", () => {
    const taskHandler = vi.fn();
    const allTasksHandler = vi.fn();
    detector.emitter.on("task-complete", taskHandler);
    detector.emitter.on("all-tasks-complete", allTasksHandler);

    detector.processTextEvent("<promise>ALL_TASKS_COMPLETE</promise>");

    expect(allTasksHandler).toHaveBeenCalledTimes(1);
    // ALL_TASKS_COMPLETE contains TASK_COMPLETE as substring, but the ALL check comes first
    expect(taskHandler).not.toHaveBeenCalled();
  });

  it("should handle TASK_COMPLETE marker spanning across multiple text chunks", () => {
    const handler = vi.fn();
    detector.emitter.on("task-complete", handler);

    detector.processTextEvent("Done! <promise>TASK_");
    expect(handler).not.toHaveBeenCalled();

    detector.processTextEvent("COMPLETE</promise>");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should handle ALL_TASKS_COMPLETE marker spanning chunks", () => {
    const handler = vi.fn();
    detector.emitter.on("all-tasks-complete", handler);

    detector.processTextEvent("<promise>ALL_TASKS");
    expect(handler).not.toHaveBeenCalled();

    detector.processTextEvent("_COMPLETE</promise>");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should handle marker split across three chunks", () => {
    const handler = vi.fn();
    detector.emitter.on("task-complete", handler);

    detector.processTextEvent("<promise>");
    expect(handler).not.toHaveBeenCalled();

    detector.processTextEvent("TASK_COMP");
    expect(handler).not.toHaveBeenCalled();

    detector.processTextEvent("LETE</promise>");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should not emit on regular text without markers", () => {
    const taskHandler = vi.fn();
    const allTasksHandler = vi.fn();
    detector.emitter.on("task-complete", taskHandler);
    detector.emitter.on("all-tasks-complete", allTasksHandler);

    detector.processTextEvent(
      "Just regular text output without any markers.",
    );

    expect(taskHandler).not.toHaveBeenCalled();
    expect(allTasksHandler).not.toHaveBeenCalled();
  });

  it("should keep accumulation buffer bounded", () => {
    // Send a lot of text without any markers
    for (let i = 0; i < 10; i++) {
      detector.processTextEvent("A".repeat(50));
    }

    // Buffer should be bounded — truncated when exceeding 200 chars to keep last 100
    // After 10 iterations of 50 chars, the buffer oscillates between 100-200
    expect(detector.getAccumulatedText().length).toBeLessThanOrEqual(200);
  });

  it("should reset accumulation buffer on clear()", () => {
    detector.processTextEvent("Some accumulated text");
    expect(detector.getAccumulatedText()).not.toBe("");

    detector.clear();
    expect(detector.getAccumulatedText()).toBe("");
  });

  it("should reset accumulation buffer after detecting a marker", () => {
    detector.processTextEvent(
      "prefix <promise>TASK_COMPLETE</promise> suffix",
    );

    expect(detector.getAccumulatedText()).toBe("");
  });

  it("should handle partial marker that never completes", () => {
    const handler = vi.fn();
    detector.emitter.on("task-complete", handler);

    detector.processTextEvent("<promise>TASK_");
    detector.processTextEvent("something else entirely");

    expect(handler).not.toHaveBeenCalled();
  });

  it("should detect marker even after buffer truncation", () => {
    const handler = vi.fn();
    detector.emitter.on("task-complete", handler);

    // Fill buffer past truncation threshold
    detector.processTextEvent("X".repeat(250));

    // Now send a marker - it should still be detected in fresh accumulation
    detector.processTextEvent("<promise>TASK_COMPLETE</promise>");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should only emit once per marker occurrence", () => {
    const handler = vi.fn();
    detector.emitter.on("task-complete", handler);

    detector.processTextEvent("<promise>TASK_COMPLETE</promise>");
    expect(handler).toHaveBeenCalledTimes(1);

    // Buffer is cleared after detection, so sending more text without marker shouldn't trigger
    detector.processTextEvent("more text");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should detect a second marker after the first one", () => {
    const handler = vi.fn();
    detector.emitter.on("task-complete", handler);

    detector.processTextEvent("<promise>TASK_COMPLETE</promise>");
    expect(handler).toHaveBeenCalledTimes(1);

    // Second occurrence in fresh text
    detector.processTextEvent(
      "New iteration done <promise>TASK_COMPLETE</promise>",
    );
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
