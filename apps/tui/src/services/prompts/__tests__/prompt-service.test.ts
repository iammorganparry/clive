/**
 * PromptService Integration Tests
 *
 * Tests that the prompt pipeline correctly composes all sections,
 * including the epic context section for worktree assignment.
 */

import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

// Mock command-loader to avoid filesystem dependency
vi.mock("../../../utils/command-loader", () => ({
  loadCommand: vi.fn(() => ({
    content: "# Mock Command File\nThis is a mock command.",
    metadata: {},
  })),
}));

import { PromptService, PromptServiceLive } from "../prompt-service";
import type { BuildConfig } from "../types";

function buildPrompt(config: BuildConfig): Promise<string> {
  const program = Effect.gen(function* () {
    const service = yield* PromptService;
    return yield* service.buildPrompt(config);
  });

  return Effect.runPromise(program.pipe(Effect.provide(PromptServiceLive)));
}

describe("PromptService", () => {
  describe("epic context in pipeline", () => {
    it("should include epic context in plan mode prompt when epicId is set", async () => {
      const prompt = await buildPrompt({
        mode: "plan",
        workspaceRoot: "/workspace",
        epicId: "abc-123-def-456",
        epicIdentifier: "CLIVE-42",
      });

      expect(prompt).toContain("EPIC CONTEXT");
      expect(prompt).toContain('CLIVE_PARENT_ID="abc-123-def-456"');
      expect(prompt).toContain("WORKTREE SETUP (MANDATORY");
    });

    it("should include epic context in build mode prompt when epicId is set", async () => {
      const prompt = await buildPrompt({
        mode: "build",
        workspaceRoot: "/workspace/worktree",
        epicId: "abc-123-def-456",
        epicIdentifier: "CLIVE-42",
      });

      expect(prompt).toContain("WORKTREE CONTEXT");
      expect(prompt).toContain(".worktree-branch");
    });

    it("should NOT include epic context when epicId is not set", async () => {
      const prompt = await buildPrompt({
        mode: "plan",
        workspaceRoot: "/workspace",
      });

      expect(prompt).not.toContain("EPIC CONTEXT");
      expect(prompt).not.toContain("CLIVE_PARENT_ID");
      expect(prompt).not.toContain("WORKTREE CONTEXT");
    });

    it("should place epic context between workspace context and issue tracker context", async () => {
      const prompt = await buildPrompt({
        mode: "plan",
        workspaceRoot: "/workspace",
        issueTracker: "linear",
        epicId: "abc-123",
        epicIdentifier: "CLIVE-1",
      });

      const workspaceIdx = prompt.indexOf("WORKSPACE CONTEXT");
      const epicIdx = prompt.indexOf("EPIC CONTEXT");
      const issueTrackerIdx = prompt.indexOf("Linear");

      expect(workspaceIdx).toBeGreaterThan(-1);
      expect(epicIdx).toBeGreaterThan(-1);
      expect(issueTrackerIdx).toBeGreaterThan(-1);

      // Epic context should be after workspace context
      expect(epicIdx).toBeGreaterThan(workspaceIdx);
      // Issue tracker context should be after epic context
      expect(issueTrackerIdx).toBeGreaterThan(epicIdx);
    });
  });

  describe("iteration context in pipeline", () => {
    it("should include iteration context in build mode when iteration is set", async () => {
      const prompt = await buildPrompt({
        mode: "build",
        workspaceRoot: "/workspace",
        iteration: 2,
        maxIterations: 5,
      });

      expect(prompt).toContain("ITERATION CONTEXT: Iteration 2 of 5");
      expect(prompt).toContain("COMPLETION PROTOCOL");
      expect(prompt).toContain("<promise>TASK_COMPLETE</promise>");
    });

    it("should NOT include iteration context in build mode without iteration", async () => {
      const prompt = await buildPrompt({
        mode: "build",
        workspaceRoot: "/workspace",
      });

      expect(prompt).not.toContain("ITERATION CONTEXT");
      expect(prompt).not.toContain("COMPLETION PROTOCOL");
    });

    it("should NOT include iteration context in plan mode even with iteration set", async () => {
      const prompt = await buildPrompt({
        mode: "plan",
        workspaceRoot: "/workspace",
        iteration: 1,
        maxIterations: 10,
      });

      expect(prompt).not.toContain("ITERATION CONTEXT");
    });
  });

  describe("prompt pipeline completeness", () => {
    it("should include all standard sections in plan mode", async () => {
      const prompt = await buildPrompt({
        mode: "plan",
        workspaceRoot: "/workspace",
        issueTracker: "linear",
        previousContext: "Previous conversation context here",
      });

      // Command file
      expect(prompt).toContain("Mock Command File");
      // Workspace context
      expect(prompt).toContain("WORKSPACE CONTEXT");
      // Issue tracker context
      expect(prompt).toContain("Linear");
      // Terminal formatting
      expect(prompt).toContain("OUTPUT FORMATTING");
      // Conversation context
      expect(prompt).toContain("CONVERSATION CONTEXT");
    });

    it("should include all standard sections plus epic context when epicId is set", async () => {
      const prompt = await buildPrompt({
        mode: "plan",
        workspaceRoot: "/workspace",
        issueTracker: "linear",
        epicId: "uuid-abc",
        epicIdentifier: "PROJ-1",
        previousContext: "Previous context",
      });

      expect(prompt).toContain("Mock Command File");
      expect(prompt).toContain("WORKSPACE CONTEXT");
      expect(prompt).toContain("EPIC CONTEXT");
      expect(prompt).toContain("Linear");
      expect(prompt).toContain("OUTPUT FORMATTING");
      expect(prompt).toContain("CONVERSATION CONTEXT");
    });

    it("should match plan mode with epic context snapshot", async () => {
      const prompt = await buildPrompt({
        mode: "plan",
        workspaceRoot: "/workspace",
        epicId: "test-epic-uuid",
        epicIdentifier: "TEST-1",
      });

      expect(prompt).toMatchSnapshot();
    });

    it("should match build mode with epic context snapshot", async () => {
      const prompt = await buildPrompt({
        mode: "build",
        workspaceRoot: "/workspace/worktree",
        epicId: "test-epic-uuid",
        epicIdentifier: "TEST-1",
      });

      expect(prompt).toMatchSnapshot();
    });

    it("should match plan mode without epic context snapshot", async () => {
      const prompt = await buildPrompt({
        mode: "plan",
        workspaceRoot: "/workspace",
      });

      expect(prompt).toMatchSnapshot();
    });
  });
});
