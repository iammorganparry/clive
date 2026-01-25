/**
 * Unit Tests for Mode-Aware Prompt Sections
 * Tests conversation, task-instructions, and workflow sections
 * which return different content based on "plan" vs "act" mode
 */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { BuildConfig } from "../../types.js";
import { conversation } from "../conversation.js";
import { taskInstructions } from "../task-instructions.js";
import { workflow } from "../workflow.js";

describe("Mode-Aware Prompt Sections", () => {
  describe("Conversation Section", () => {
    it("should return plan mode content by default", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test/workspace",
      };

      const content = await Effect.runPromise(conversation(config));

      expect(content).toContain("<conversation_handling>");
      expect(content).toContain("You are in planning mode");
      expect(content).toContain(
        "Handle user interaction to refine the proposal",
      );
    });

    it("should return act mode content when mode is 'act'", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test/workspace",
        mode: "act" as const,
      };

      const content = await Effect.runPromise(conversation(config));

      expect(content).toContain("<conversation_handling>");
      expect(content).toContain("You are in execution mode");
      expect(content).toContain("implementing tests");
      expect(content).not.toContain("planning mode");
    });
  });

  describe("Workflow Section", () => {
    it("should return plan mode content by default", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test/workspace",
      };

      const content = await Effect.runPromise(workflow(config));

      expect(content).toContain("<workflow>");
      expect(content).toContain("You are in planning mode");
      expect(content).toContain("THOROUGH CONTEXT GATHERING");
      expect(content).toContain("ANALYSIS & PROPOSAL");
    });

    it("should return act mode content when mode is 'act'", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test/workspace",
        mode: "act" as const,
      };

      const content = await Effect.runPromise(workflow(config));

      expect(content).toContain("<workflow>");
      expect(content).toContain("You are in execution mode");
      expect(content).toContain("ITERATIVE TEST IMPLEMENTATION");
      expect(content).not.toContain("ANALYSIS & PROPOSAL");
    });

    it("should include context gathering in act mode", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test/workspace",
        mode: "act" as const,
      };

      const content = await Effect.runPromise(workflow(config));

      expect(content).toContain("LIMITED CONTEXT GATHERING");
      expect(content).toContain("if absolutely necessary");
    });

    it("should include planFilePath in act mode when provided", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test/workspace",
        mode: "act" as const,
        planFilePath: ".clive/plans/test-plan-12345.md",
      };

      const content = await Effect.runPromise(workflow(config));

      expect(content).toContain("**Plan file available**");
      expect(content).toContain(".clive/plans/test-plan-12345.md");
      expect(content).toContain("Read the approved test plan");
    });

    it("should not include planFilePath section in act mode when not provided", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test/workspace",
        mode: "act" as const,
      };

      const content = await Effect.runPromise(workflow(config));

      expect(content).not.toContain("**Plan file available**");
      expect(content).not.toContain("Read the approved test plan");
    });

    it("should not include planFilePath in plan mode even when provided", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test/workspace",
        mode: "plan" as const,
        planFilePath: ".clive/plans/test-plan-12345.md",
      };

      const content = await Effect.runPromise(workflow(config));

      expect(content).toContain("You are in planning mode");
      expect(content).not.toContain("**Plan file available**");
      expect(content).not.toContain(".clive/plans/test-plan-12345.md");
    });
  });

  describe("Task Instructions Section", () => {
    it("should return plan mode content by default", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test/workspace",
      };

      const content = await Effect.runPromise(taskInstructions(config));

      expect(content).toContain("<your_task>");
      expect(content).toContain("You are in planning mode");
      expect(content).toContain(
        "analyzing code and proposing a comprehensive test strategy",
      );
    });

    it("should return act mode content when mode is 'act'", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test/workspace",
        mode: "act" as const,
      };

      const content = await Effect.runPromise(taskInstructions(config));

      expect(content).toContain("<your_task>");
      expect(content).toContain("You are in execution mode");
      expect(content).toContain("implementing the approved test plan");
      expect(content).not.toContain("planning mode");
    });

    it("should include proposal format in plan mode only", async () => {
      const planConfig: BuildConfig = {
        workspaceRoot: "/test/workspace",
      };

      const actConfig: BuildConfig = {
        workspaceRoot: "/test/workspace",
        mode: "act" as const,
      };

      const planContent = await Effect.runPromise(taskInstructions(planConfig));
      const actContent = await Effect.runPromise(taskInstructions(actConfig));

      expect(planContent).toContain("YAML frontmatter");
      expect(planContent).toContain(
        "Output format for your natural language response",
      );
      expect(actContent).not.toContain("YAML frontmatter");
      expect(actContent).not.toContain(
        "Output format for your natural language response",
      );
    });

    it("should mention completeTask in act mode", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test/workspace",
        mode: "act" as const,
      };

      const content = await Effect.runPromise(taskInstructions(config));

      expect(content).toContain("completeTask");
    });
  });

  describe("Default Mode Behavior", () => {
    it("conversation should default to plan mode when mode is undefined", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test/workspace",
      };

      const content = await Effect.runPromise(conversation(config));

      expect(content).toContain("You are in planning mode");
    });

    it("workflow should default to plan mode when mode is undefined", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test/workspace",
      };

      const content = await Effect.runPromise(workflow(config));

      expect(content).toContain("You are in planning mode");
    });

    it("taskInstructions should default to plan mode when mode is undefined", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test/workspace",
      };

      const content = await Effect.runPromise(taskInstructions(config));

      expect(content).toContain("You are in planning mode");
    });
  });
});
