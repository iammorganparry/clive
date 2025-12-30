import { describe, it, expect, } from "vitest";
import { createActor } from "xstate";
import {
  changesetChatMachine,
  type ChangesetChatEvent,
} from "../changeset-chat-machine.js";

/**
 * Integration tests for plan content handling in the state machine
 * Verifies the updatePlanContent action correctly processes plan-content-streaming events
 */
describe("Plan Content Handling", () => {
  describe("updatePlanContent action", () => {
    it("should update planContent from plan-content-streaming event", () => {
      const actor = createActor(changesetChatMachine, {
        input: { files: ["test.ts"], branchName: "feature" },
      });
      actor.start();

      // Transition to analyzing state first
      actor.send({ type: "START_ANALYSIS" });

      // Send plan-content-streaming event
      actor.send({
        type: "RESPONSE_CHUNK",
        chunkType: "plan-content-streaming",
        streamingPlanContent: {
          toolCallId: "tool-123",
          content: "# Test Plan\n\n## Problem Summary\n\nTest content",
          isComplete: false,
          filePath: ".clive/plans/test-plan.md",
        },
      } as ChangesetChatEvent);

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.planContent).toBe(
        "# Test Plan\n\n## Problem Summary\n\nTest content",
      );

      actor.stop();
    });

    it("should update planFilePath when filePath is provided", () => {
      const actor = createActor(changesetChatMachine, {
        input: { files: ["test.ts"], branchName: "feature" },
      });
      actor.start();

      actor.send({ type: "START_ANALYSIS" });

      actor.send({
        type: "RESPONSE_CHUNK",
        chunkType: "plan-content-streaming",
        streamingPlanContent: {
          toolCallId: "tool-456",
          content: "# Plan Content",
          isComplete: false,
          filePath: ".clive/plans/test-plan-auth-1234567890.md",
        },
      } as ChangesetChatEvent);

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.planFilePath).toBe(
        ".clive/plans/test-plan-auth-1234567890.md",
      );

      actor.stop();
    });

    it("should accumulate content during streaming (isComplete=false)", () => {
      const actor = createActor(changesetChatMachine, {
        input: { files: ["test.ts"], branchName: "feature" },
      });
      actor.start();

      actor.send({ type: "START_ANALYSIS" });

      // First streaming chunk
      actor.send({
        type: "RESPONSE_CHUNK",
        chunkType: "plan-content-streaming",
        streamingPlanContent: {
          toolCallId: "tool-789",
          content: "# Test Plan\n",
          isComplete: false,
          filePath: ".clive/plans/test.md",
        },
      } as ChangesetChatEvent);

      let snapshot = actor.getSnapshot();
      expect(snapshot.context.planContent).toBe("# Test Plan\n");

      // Second streaming chunk with more content
      actor.send({
        type: "RESPONSE_CHUNK",
        chunkType: "plan-content-streaming",
        streamingPlanContent: {
          toolCallId: "tool-789",
          content: "# Test Plan\n\n## Problem Summary",
          isComplete: false,
          filePath: ".clive/plans/test.md",
        },
      } as ChangesetChatEvent);

      snapshot = actor.getSnapshot();
      expect(snapshot.context.planContent).toBe(
        "# Test Plan\n\n## Problem Summary",
      );

      actor.stop();
    });

    it("should set final content when isComplete=true", () => {
      const actor = createActor(changesetChatMachine, {
        input: { files: ["test.ts"], branchName: "feature" },
      });
      actor.start();

      actor.send({ type: "START_ANALYSIS" });

      // Send complete event
      actor.send({
        type: "RESPONSE_CHUNK",
        chunkType: "plan-content-streaming",
        streamingPlanContent: {
          toolCallId: "tool-complete",
          content:
            "# Final Plan\n\n## Problem Summary\n\nComplete plan content here.",
          isComplete: true,
          filePath: ".clive/plans/final-plan.md",
        },
      } as ChangesetChatEvent);

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.planContent).toBe(
        "# Final Plan\n\n## Problem Summary\n\nComplete plan content here.",
      );
      expect(snapshot.context.planFilePath).toBe(".clive/plans/final-plan.md");

      actor.stop();
    });

    it("should preserve filePath across multiple streaming events", () => {
      const actor = createActor(changesetChatMachine, {
        input: { files: ["test.ts"], branchName: "feature" },
      });
      actor.start();

      actor.send({ type: "START_ANALYSIS" });

      const filePath = ".clive/plans/consistent-path.md";

      // Multiple streaming events with same filePath
      for (let i = 1; i <= 3; i++) {
        actor.send({
          type: "RESPONSE_CHUNK",
          chunkType: "plan-content-streaming",
          streamingPlanContent: {
            toolCallId: "tool-path-test",
            content: `Content chunk ${i}`,
            isComplete: i === 3,
            filePath,
          },
        } as ChangesetChatEvent);

        const snapshot = actor.getSnapshot();
        expect(snapshot.context.planFilePath).toBe(filePath);
      }

      actor.stop();
    });

    it("should not update planContent when streamingPlanContent is missing", () => {
      const actor = createActor(changesetChatMachine, {
        input: { files: ["test.ts"], branchName: "feature" },
      });
      actor.start();

      actor.send({ type: "START_ANALYSIS" });

      // Set initial planContent
      actor.send({
        type: "RESPONSE_CHUNK",
        chunkType: "plan-content-streaming",
        streamingPlanContent: {
          toolCallId: "tool-initial",
          content: "Initial content",
          isComplete: false,
          filePath: ".clive/plans/test.md",
        },
      } as ChangesetChatEvent);

      // Send event without streamingPlanContent
      actor.send({
        type: "RESPONSE_CHUNK",
        chunkType: "plan-content-streaming",
        // No streamingPlanContent
      } as ChangesetChatEvent);

      const snapshot = actor.getSnapshot();
      // Should still have the initial content
      expect(snapshot.context.planContent).toBe("Initial content");

      actor.stop();
    });

    it("should handle empty content in streaming event", () => {
      const actor = createActor(changesetChatMachine, {
        input: { files: ["test.ts"], branchName: "feature" },
      });
      actor.start();

      actor.send({ type: "START_ANALYSIS" });

      // First set some content
      actor.send({
        type: "RESPONSE_CHUNK",
        chunkType: "plan-content-streaming",
        streamingPlanContent: {
          toolCallId: "tool-empty-test",
          content: "Initial content",
          isComplete: false,
          filePath: ".clive/plans/test.md",
        },
      } as ChangesetChatEvent);

      // Send event with empty content (should not overwrite)
      actor.send({
        type: "RESPONSE_CHUNK",
        chunkType: "plan-content-streaming",
        streamingPlanContent: {
          toolCallId: "tool-empty-test",
          content: "",
          isComplete: false,
          filePath: ".clive/plans/test.md",
        },
      } as ChangesetChatEvent);

      const snapshot = actor.getSnapshot();
      // Empty content should not update (based on updatePlanContent logic)
      expect(snapshot.context.planContent).toBe("Initial content");

      actor.stop();
    });
  });

  describe("RESET action", () => {
    it("should reset planContent to null", () => {
      const actor = createActor(changesetChatMachine, {
        input: { files: ["test.ts"], branchName: "feature" },
      });
      actor.start();

      // Set planContent via streaming
      actor.send({ type: "START_ANALYSIS" });
      actor.send({
        type: "RESPONSE_CHUNK",
        chunkType: "plan-content-streaming",
        streamingPlanContent: {
          toolCallId: "tool-reset",
          content: "Plan to be reset",
          isComplete: true,
          filePath: ".clive/plans/reset-test.md",
        },
      } as ChangesetChatEvent);
      actor.send({ type: "RESPONSE_COMPLETE", taskCompleted: false });

      let snapshot = actor.getSnapshot();
      expect(snapshot.context.planContent).toBe("Plan to be reset");

      // Reset
      actor.send({ type: "RESET" });

      snapshot = actor.getSnapshot();
      expect(snapshot.context.planContent).toBeNull();
      expect(snapshot.context.planFilePath).toBeNull();

      actor.stop();
    });
  });

  describe("TestPlanPreview rendering conditions", () => {
    it("should have planContent available for TestPlanPreview when set", () => {
      const actor = createActor(changesetChatMachine, {
        input: { files: ["test.ts"], branchName: "feature" },
      });
      actor.start();

      actor.send({ type: "START_ANALYSIS" });
      actor.send({
        type: "RESPONSE_CHUNK",
        chunkType: "plan-content-streaming",
        streamingPlanContent: {
          toolCallId: "tool-render",
          content: "name: Test Plan\noverview: Testing\n\n## Test Plan",
          isComplete: true,
          filePath: ".clive/plans/render-test.md",
        },
      } as ChangesetChatEvent);

      const snapshot = actor.getSnapshot();

      // These are the conditions used in index.tsx for rendering TestPlanPreview
      const planContent = snapshot.context.planContent;
      const planFilePath = snapshot.context.planFilePath;

      expect(planContent).not.toBeNull();
      expect(planFilePath).not.toBeNull();
      expect(planContent).toContain("Test Plan");
      expect(planFilePath).toContain(".clive/plans/");

      actor.stop();
    });

    it("should have planFilePath for Read More button functionality", () => {
      const actor = createActor(changesetChatMachine, {
        input: { files: ["test.ts"], branchName: "feature" },
      });
      actor.start();

      actor.send({ type: "START_ANALYSIS" });
      actor.send({
        type: "RESPONSE_CHUNK",
        chunkType: "plan-content-streaming",
        streamingPlanContent: {
          toolCallId: "tool-read-more",
          content: "# Complete Plan",
          isComplete: true,
          filePath: ".clive/plans/read-more-test.md",
        },
      } as ChangesetChatEvent);

      const snapshot = actor.getSnapshot();

      // The Read More button uses planFilePath to open the file
      const filePath = snapshot.context.planFilePath;
      expect(filePath).toBe(".clive/plans/read-more-test.md");

      actor.stop();
    });
  });

  describe("State transitions with plan content", () => {
    it("should handle plan-content-streaming in analyzing state", () => {
      const actor = createActor(changesetChatMachine, {
        input: { files: ["test.ts"], branchName: "feature" },
      });
      actor.start();

      actor.send({ type: "START_ANALYSIS" });

      let snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("analyzing");

      actor.send({
        type: "RESPONSE_CHUNK",
        chunkType: "plan-content-streaming",
        streamingPlanContent: {
          toolCallId: "tool-analyzing",
          content: "# Plan in Analyzing",
          isComplete: false,
          filePath: ".clive/plans/analyzing.md",
        },
      } as ChangesetChatEvent);

      snapshot = actor.getSnapshot();
      // Should transition to streaming state after receiving RESPONSE_CHUNK
      expect(snapshot.value).toBe("streaming");
      expect(snapshot.context.planContent).toBe("# Plan in Analyzing");

      actor.stop();
    });

    it("should handle plan-content-streaming in streaming state", () => {
      const actor = createActor(changesetChatMachine, {
        input: { files: ["test.ts"], branchName: "feature" },
      });
      actor.start();

      actor.send({ type: "START_ANALYSIS" });

      // First event transitions to streaming
      actor.send({
        type: "RESPONSE_CHUNK",
        chunkType: "message",
        content: "Starting...",
      } as ChangesetChatEvent);

      let snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("streaming");

      // Plan content streaming in streaming state
      actor.send({
        type: "RESPONSE_CHUNK",
        chunkType: "plan-content-streaming",
        streamingPlanContent: {
          toolCallId: "tool-streaming",
          content: "# Plan in Streaming State",
          isComplete: false,
          filePath: ".clive/plans/streaming.md",
        },
      } as ChangesetChatEvent);

      snapshot = actor.getSnapshot();
      expect(snapshot.context.planContent).toBe("# Plan in Streaming State");

      actor.stop();
    });

    it("should preserve planContent after RESPONSE_COMPLETE", () => {
      const actor = createActor(changesetChatMachine, {
        input: { files: ["test.ts"], branchName: "feature" },
      });
      actor.start();

      actor.send({ type: "START_ANALYSIS" });
      actor.send({
        type: "RESPONSE_CHUNK",
        chunkType: "plan-content-streaming",
        streamingPlanContent: {
          toolCallId: "tool-preserve",
          content: "# Preserved Plan Content",
          isComplete: true,
          filePath: ".clive/plans/preserved.md",
        },
      } as ChangesetChatEvent);

      actor.send({ type: "RESPONSE_COMPLETE", taskCompleted: false });

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("idle");
      expect(snapshot.context.planContent).toBe("# Preserved Plan Content");
      expect(snapshot.context.planFilePath).toBe(".clive/plans/preserved.md");
      expect(snapshot.context.hasCompletedAnalysis).toBe(true);

      actor.stop();
    });
  });
});

