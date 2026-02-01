/**
 * WorkerSessionManager Tests
 *
 * Tests the helper functions for mode-based configuration:
 * - getSystemPromptForMode: Loads full prompts from command files
 * - getModelForMode: Returns default model (inherits from Claude Code)
 *
 * These are regression tests for the bug where systemPrompt was
 * referenced but not defined in createExecutionProgram.
 */

import { describe, expect, it } from "vitest";
import {
  getSystemPromptForMode,
  getModelForMode,
  type SessionMode,
} from "../WorkerSessionManager";

describe("getSystemPromptForMode", () => {
  describe("plan mode", () => {
    it("returns planning instructions from command file", () => {
      const prompt = getSystemPromptForMode("plan");

      expect(prompt).toContain("Work Planning Agent");
      expect(prompt).toContain("PLANNING ONLY");
    });

    it("includes interview protocol", () => {
      const prompt = getSystemPromptForMode("plan");

      expect(prompt).toContain("Interview Phase");
      expect(prompt).toContain("AskUserQuestion");
      expect(prompt).toContain("Linear");
    });

    it("does not reference skill invocation", () => {
      const prompt = getSystemPromptForMode("plan");

      expect(prompt).not.toContain("invoke the /clive-plan skill");
      expect(prompt).not.toContain("Skill tool NOW");
    });
  });

  describe("build mode", () => {
    it("returns build instructions from command file", () => {
      const prompt = getSystemPromptForMode("build");

      expect(prompt).toContain("Task Execution Agent");
      expect(prompt).toContain("Execution Workflow");
    });

    it("includes implementation guidance", () => {
      const prompt = getSystemPromptForMode("build");

      expect(prompt).toContain("Implement Changes");
      expect(prompt).toContain("Verify Implementation");
    });

    it("does not reference skill invocation", () => {
      const prompt = getSystemPromptForMode("build");

      expect(prompt).not.toContain("invoke the /clive-build skill");
      expect(prompt).not.toContain("Skill tool NOW");
    });
  });

  describe("review mode", () => {
    it("returns review instructions from command file", () => {
      const prompt = getSystemPromptForMode("review");

      expect(prompt).toContain("Review Mode");
      expect(prompt).toContain("6-Phase Review Workflow");
    });

    it("includes verification phases", () => {
      const prompt = getSystemPromptForMode("review");

      expect(prompt).toContain("Code Review");
      expect(prompt).toContain("Acceptance Criteria");
      expect(prompt).toContain("Browser Testing");
    });

    it("does not reference skill invocation", () => {
      const prompt = getSystemPromptForMode("review");

      expect(prompt).not.toContain("invoke the /clive-review skill");
      expect(prompt).not.toContain("Skill tool NOW");
    });
  });

  describe("exhaustive mode coverage", () => {
    it("returns different prompts for each mode", () => {
      const planPrompt = getSystemPromptForMode("plan");
      const buildPrompt = getSystemPromptForMode("build");
      const reviewPrompt = getSystemPromptForMode("review");

      expect(planPrompt).not.toBe(buildPrompt);
      expect(buildPrompt).not.toBe(reviewPrompt);
      expect(reviewPrompt).not.toBe(planPrompt);
    });

    it("returns non-empty strings for all modes", () => {
      const modes: SessionMode[] = ["plan", "build", "review"];

      for (const mode of modes) {
        const prompt = getSystemPromptForMode(mode);
        expect(prompt).toBeTruthy();
        expect(typeof prompt).toBe("string");
        expect(prompt.length).toBeGreaterThan(100);
      }
    });
  });
});

describe("getModelForMode", () => {
  describe("model selection", () => {
    it("returns opus for all modes (inherits from Claude Code)", () => {
      const modes: SessionMode[] = ["plan", "build", "review"];

      for (const mode of modes) {
        expect(getModelForMode(mode)).toBe("opus");
      }
    });
  });

  describe("exhaustive mode coverage", () => {
    it("returns valid model string for all modes", () => {
      const modes: SessionMode[] = ["plan", "build", "review"];
      const validModels = ["opus", "sonnet", "haiku"];

      for (const mode of modes) {
        const model = getModelForMode(mode);
        expect(validModels).toContain(model);
      }
    });
  });
});

describe("Regression: systemPrompt undefined bug", () => {
  /**
   * This test documents the bug that was fixed:
   *
   * In createExecutionProgram, the code referenced `systemPrompt` without
   * defining it, causing: ReferenceError: systemPrompt is not defined
   *
   * The fix was to:
   * 1. Call getSystemPromptForMode(mode) to load from command files
   * 2. Pass it to createExecutionProgram as a parameter
   * 3. Use getModelForMode(mode) for default model selection
   */

  it("getSystemPromptForMode is defined and callable", () => {
    expect(typeof getSystemPromptForMode).toBe("function");
    expect(() => getSystemPromptForMode("plan")).not.toThrow();
  });

  it("getModelForMode is defined and callable", () => {
    expect(typeof getModelForMode).toBe("function");
    expect(() => getModelForMode("plan")).not.toThrow();
  });

  it("functions return correct types", () => {
    expect(typeof getSystemPromptForMode("plan")).toBe("string");
    expect(typeof getModelForMode("plan")).toBe("string");
  });

  it("plan mode configuration is complete", () => {
    const systemPrompt = getSystemPromptForMode("plan");
    const model = getModelForMode("plan");

    expect(systemPrompt).toBeDefined();
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(model).toBe("opus");
  });

  it("build mode configuration is complete", () => {
    const systemPrompt = getSystemPromptForMode("build");
    const model = getModelForMode("build");

    expect(systemPrompt).toBeDefined();
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(model).toBe("opus");
  });

  it("review mode configuration is complete", () => {
    const systemPrompt = getSystemPromptForMode("review");
    const model = getModelForMode("review");

    expect(systemPrompt).toBeDefined();
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(model).toBe("opus");
  });
});
