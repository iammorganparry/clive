/**
 * WorkerSessionManager Tests
 *
 * Tests the helper functions for mode-based configuration:
 * - getSystemPromptForMode: Returns correct prompt for each mode
 * - getModelForMode: Returns correct model for each mode
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
    it("returns planning skill prompt", () => {
      const prompt = getSystemPromptForMode("plan");

      expect(prompt).toContain("Clive Plan Mode");
      expect(prompt).toContain("/clive-plan");
      expect(prompt).toContain("CRITICAL INSTRUCTION");
    });

    it("includes skill invocation instructions", () => {
      const prompt = getSystemPromptForMode("plan");

      expect(prompt).toContain("Skill tool");
      expect(prompt).toContain("Stakeholder interviews");
      expect(prompt).toContain("Linear issue creation");
    });

    it("includes DO NOT instructions", () => {
      const prompt = getSystemPromptForMode("plan");

      expect(prompt).toContain("DO NOT");
      expect(prompt).toContain("Ask questions yourself");
    });
  });

  describe("build mode", () => {
    it("returns build skill prompt", () => {
      const prompt = getSystemPromptForMode("build");

      expect(prompt).toContain("Clive Build Mode");
      expect(prompt).toContain("/clive-build");
      expect(prompt).toContain("CRITICAL INSTRUCTION");
    });

    it("includes task execution instructions", () => {
      const prompt = getSystemPromptForMode("build");

      expect(prompt).toContain("Claude Tasks");
      expect(prompt).toContain("global learnings");
      expect(prompt).toContain("Linear issue status");
    });

    it("includes DO NOT instructions", () => {
      const prompt = getSystemPromptForMode("build");

      expect(prompt).toContain("DO NOT");
      expect(prompt).toContain("Implement code yourself");
    });
  });

  describe("review mode", () => {
    it("returns review skill prompt", () => {
      const prompt = getSystemPromptForMode("review");

      expect(prompt).toContain("Clive Review Mode");
      expect(prompt).toContain("/clive-review");
      expect(prompt).toContain("CRITICAL INSTRUCTION");
    });

    it("includes verification instructions", () => {
      const prompt = getSystemPromptForMode("review");

      expect(prompt).toContain("Code review");
      expect(prompt).toContain("Acceptance criteria");
      expect(prompt).toContain("Browser testing");
    });

    it("includes DO NOT instructions", () => {
      const prompt = getSystemPromptForMode("review");

      expect(prompt).toContain("DO NOT");
      expect(prompt).toContain("Review code yourself");
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
    it("returns opus for plan mode", () => {
      expect(getModelForMode("plan")).toBe("opus");
    });

    it("returns sonnet for build mode", () => {
      expect(getModelForMode("build")).toBe("sonnet");
    });

    it("returns opus for review mode", () => {
      expect(getModelForMode("review")).toBe("opus");
    });
  });

  describe("model rationale", () => {
    it("uses expensive model for planning (comprehensive research)", () => {
      // Plan mode requires thorough codebase exploration and interview design
      expect(getModelForMode("plan")).toBe("opus");
    });

    it("uses efficient model for building (fast execution)", () => {
      // Build mode executes predefined tasks, efficiency matters
      expect(getModelForMode("build")).toBe("sonnet");
    });

    it("uses expensive model for review (thorough verification)", () => {
      // Review mode needs careful analysis and gap detection
      expect(getModelForMode("review")).toBe("opus");
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
   * 1. Call getSystemPromptForMode(mode) to get the prompt
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
    expect(model).toBe("sonnet");
  });

  it("review mode configuration is complete", () => {
    const systemPrompt = getSystemPromptForMode("review");
    const model = getModelForMode("review");

    expect(systemPrompt).toBeDefined();
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(model).toBe("opus");
  });
});
