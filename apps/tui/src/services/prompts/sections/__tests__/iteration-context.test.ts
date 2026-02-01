/**
 * Iteration Context Prompt Section Tests
 *
 * Tests the iteration context section that injects scratchpad,
 * learnings, and completion marker instructions during build loop iterations.
 *
 * Active only when mode === "build" && iteration is set.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildConfig } from "../../types";
import { iterationContext } from "../iteration-context";

// Mock fs module
vi.mock("node:fs");

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

function runSection(config: BuildConfig): string {
  return Effect.runSync(iterationContext(config));
}

describe("iterationContext", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("inactive conditions (returns empty string)", () => {
    it("should return empty when mode is plan", () => {
      const result = runSection({
        mode: "plan",
        workspaceRoot: "/workspace",
        iteration: 1,
        maxIterations: 10,
      });
      expect(result).toBe("");
    });

    it("should return empty when mode is review", () => {
      const result = runSection({
        mode: "review",
        workspaceRoot: "/workspace",
        iteration: 1,
      });
      expect(result).toBe("");
    });

    it("should return empty when iteration is not set", () => {
      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
      });
      expect(result).toBe("");
    });

    it("should return empty when iteration is 0 (falsy)", () => {
      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
        iteration: 0,
      });
      expect(result).toBe("");
    });

    it("should return empty when mode is undefined", () => {
      const result = runSection({
        workspaceRoot: "/workspace",
        iteration: 1,
      });
      expect(result).toBe("");
    });
  });

  describe("iteration header", () => {
    it("should include iteration count in header", () => {
      mockExistsSync.mockReturnValue(false);

      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
        iteration: 3,
        maxIterations: 10,
      });

      expect(result).toContain("ITERATION CONTEXT: Iteration 3 of 10");
    });

    it("should default maxIterations to 10 when not set", () => {
      mockExistsSync.mockReturnValue(false);

      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
        iteration: 1,
      });

      expect(result).toContain("ITERATION CONTEXT: Iteration 1 of 10");
    });
  });

  describe("scratchpad reading", () => {
    it("should show no previous context message on first iteration without scratchpad", () => {
      mockExistsSync.mockReturnValue(false);

      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
        epicId: "epic-123",
        iteration: 1,
        maxIterations: 5,
      });

      expect(result).toContain("No previous context (first iteration)");
    });

    it("should read scratchpad when it exists", () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        return String(p).endsWith("scratchpad.md");
      });
      mockReadFileSync.mockReturnValue(
        "## Task 1\nCompleted auth service\n## Issues\nNone",
      );

      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
        epicId: "epic-123",
        iteration: 2,
        maxIterations: 5,
      });

      expect(result).toContain("SCRATCHPAD (from previous iterations)");
      expect(result).toContain("Completed auth service");
    });

    it("should read scratchpad from correct path based on epicId", () => {
      mockExistsSync.mockReturnValue(false);

      runSection({
        mode: "build",
        workspaceRoot: "/workspace",
        epicId: "my-epic-uuid",
        iteration: 1,
      });

      expect(mockExistsSync).toHaveBeenCalledWith(
        path.join("/workspace", ".claude", "epics", "my-epic-uuid", "scratchpad.md"),
      );
    });

    it("should truncate scratchpad content longer than 3000 chars", () => {
      const longContent = "A".repeat(4000);
      mockExistsSync.mockImplementation((p: fs.PathLike) =>
        String(p).endsWith("scratchpad.md"),
      );
      mockReadFileSync.mockReturnValue(longContent);

      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
        epicId: "epic-123",
        iteration: 2,
      });

      expect(result).toContain("... (truncated)");
      // Should contain first 3000 chars
      expect(result).toContain("A".repeat(3000));
      // Should NOT contain the full 4000 chars
      expect(result).not.toContain("A".repeat(3001));
    });

    it("should handle empty scratchpad file", () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) =>
        String(p).endsWith("scratchpad.md"),
      );
      mockReadFileSync.mockReturnValue("   \n  ");

      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
        epicId: "epic-123",
        iteration: 2,
      });

      // Empty scratchpad should not show scratchpad section
      expect(result).not.toContain("SCRATCHPAD");
    });

    it("should handle missing workspaceRoot gracefully", () => {
      const result = runSection({
        mode: "build",
        iteration: 1,
      });

      // No workspaceRoot means no scratchpad or learnings, but header should still show
      expect(result).toContain("ITERATION CONTEXT: Iteration 1 of 10");
      expect(result).toContain("No previous context (first iteration)");
    });
  });

  describe("learnings reading", () => {
    it("should read error-patterns.md, success-patterns.md, and gotchas.md", () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return (
          s.endsWith("error-patterns.md") ||
          s.endsWith("success-patterns.md") ||
          s.endsWith("gotchas.md")
        );
      });
      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s.endsWith("error-patterns.md")) return "## Error 1\nDon't do X";
        if (s.endsWith("success-patterns.md"))
          return "## Success 1\nAlways do Y";
        if (s.endsWith("gotchas.md")) return "## Gotcha 1\nWatch out for Z";
        return "";
      });

      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
        iteration: 2,
      });

      expect(result).toContain("GLOBAL LEARNINGS");
      expect(result).toContain("error patterns");
      expect(result).toContain("Don't do X");
      expect(result).toContain("success patterns");
      expect(result).toContain("Always do Y");
      expect(result).toContain("gotchas");
      expect(result).toContain("Watch out for Z");
    });

    it("should skip learnings files that don't exist", () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        return String(p).endsWith("error-patterns.md");
      });
      mockReadFileSync.mockReturnValue("Error content only");

      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
        iteration: 2,
      });

      expect(result).toContain("GLOBAL LEARNINGS");
      expect(result).toContain("Error content only");
      expect(result).not.toContain("success patterns");
      expect(result).not.toContain("gotchas");
    });

    it("should not show GLOBAL LEARNINGS header when no files exist", () => {
      mockExistsSync.mockReturnValue(false);

      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
        iteration: 2,
      });

      expect(result).not.toContain("GLOBAL LEARNINGS");
    });

    it("should truncate individual learnings files at 2000 chars", () => {
      const longContent = "B".repeat(3000);
      mockExistsSync.mockImplementation((p: fs.PathLike) =>
        String(p).endsWith("error-patterns.md"),
      );
      mockReadFileSync.mockReturnValue(longContent);

      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
        iteration: 2,
      });

      expect(result).toContain("... (truncated)");
      expect(result).toContain("B".repeat(2000));
      expect(result).not.toContain("B".repeat(2001));
    });
  });

  describe("completion marker instructions", () => {
    it("should include completion protocol", () => {
      mockExistsSync.mockReturnValue(false);

      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
        iteration: 1,
      });

      expect(result).toContain("COMPLETION PROTOCOL");
      expect(result).toContain("<promise>TASK_COMPLETE</promise>");
      expect(result).toContain("<promise>ALL_TASKS_COMPLETE</promise>");
    });

    it("should include scratchpad update path with epicId", () => {
      mockExistsSync.mockReturnValue(false);

      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
        epicId: "my-epic-id",
        iteration: 1,
      });

      expect(result).toContain(".claude/epics/my-epic-id/scratchpad.md");
    });

    it("should use generic scratchpad path when no epicId", () => {
      mockExistsSync.mockReturnValue(false);

      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
        iteration: 1,
      });

      expect(result).toContain(".claude/scratchpad.md");
    });

    it("should instruct agent to execute ONE task and STOP", () => {
      mockExistsSync.mockReturnValue(false);

      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
        iteration: 1,
      });

      expect(result).toContain("Execute ONE task");
      expect(result).toContain("STOP IMMEDIATELY");
    });
  });

  describe("full integration", () => {
    it("should compose all sections correctly for iteration with scratchpad and learnings", () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return (
          s.endsWith("scratchpad.md") || s.endsWith("error-patterns.md")
        );
      });
      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s.endsWith("scratchpad.md"))
          return "Task 1 done. Task 2 in progress.";
        if (s.endsWith("error-patterns.md"))
          return "Don't forget to run tests.";
        return "";
      });

      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
        epicId: "epic-uuid",
        iteration: 3,
        maxIterations: 8,
      });

      // Header
      expect(result).toContain("ITERATION CONTEXT: Iteration 3 of 8");
      // Scratchpad
      expect(result).toContain("SCRATCHPAD");
      expect(result).toContain("Task 1 done");
      // Learnings
      expect(result).toContain("GLOBAL LEARNINGS");
      expect(result).toContain("Don't forget to run tests");
      // Completion protocol
      expect(result).toContain("COMPLETION PROTOCOL");
    });
  });
});
