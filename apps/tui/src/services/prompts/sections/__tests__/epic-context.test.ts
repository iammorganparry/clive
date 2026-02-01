/**
 * Epic Context Prompt Section Tests
 *
 * Tests the epic context section that injects epic ID and worktree context
 * into system prompts, with snapshot tests for prompt stability.
 *
 * Modes:
 * - Plan: emits CLIVE_PARENT_ID and worktree creation instructions
 * - Build: emits worktree verification context
 * - No epicId: returns empty string (no-op)
 */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { BuildConfig } from "../../types";
import { epicContext } from "../epic-context";

function runSection(config: BuildConfig): string {
  return Effect.runSync(epicContext(config));
}

describe("epicContext", () => {
  describe("no epicId (no-op)", () => {
    it("should return empty string when no epicId is provided", () => {
      const result = runSection({
        mode: "plan",
        workspaceRoot: "/workspace",
      });

      expect(result).toBe("");
    });

    it("should return empty string for build mode without epicId", () => {
      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace",
      });

      expect(result).toBe("");
    });

    it("should return empty string for review mode without epicId", () => {
      const result = runSection({
        mode: "review",
        workspaceRoot: "/workspace",
        epicId: undefined,
      });

      expect(result).toBe("");
    });
  });

  describe("plan mode with epicId", () => {
    it("should emit CLIVE_PARENT_ID and worktree creation instructions", () => {
      const result = runSection({
        mode: "plan",
        workspaceRoot: "/workspace",
        epicId: "abc-123-def-456",
        epicIdentifier: "CLIVE-42",
      });

      expect(result).toContain('CLIVE_PARENT_ID="abc-123-def-456"');
      expect(result).toContain('CLIVE_EPIC_IDENTIFIER="CLIVE-42"');
      expect(result).toContain("WORKTREE SETUP (MANDATORY");
      expect(result).toContain("git worktree add");
      expect(result).toContain("worktree.json");
      expect(result).toContain(".worktree-branch");
      expect(result).toContain("yarn install --frozen-lockfile");
    });

    it("should use epicId as identifier fallback when epicIdentifier is not provided", () => {
      const result = runSection({
        mode: "plan",
        workspaceRoot: "/workspace",
        epicId: "abc-123-def-456",
      });

      expect(result).toContain('CLIVE_EPIC_IDENTIFIER="abc-123-def-456"');
      expect(result).toContain("clive/abc-123-def-456");
    });

    it("should derive branch name from epicIdentifier", () => {
      const result = runSection({
        mode: "plan",
        workspaceRoot: "/workspace",
        epicId: "uuid-here",
        epicIdentifier: "PROJ-99",
      });

      expect(result).toContain('BRANCH="clive/PROJ-99"');
    });

    it("should match plan mode snapshot", () => {
      const result = runSection({
        mode: "plan",
        workspaceRoot: "/workspace",
        epicId: "abc-123-def-456",
        epicIdentifier: "CLIVE-42",
      });

      expect(result).toMatchSnapshot();
    });
  });

  describe("build mode with epicId", () => {
    it("should emit worktree verification context", () => {
      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace/worktree",
        epicId: "abc-123-def-456",
        epicIdentifier: "CLIVE-42",
      });

      expect(result).toContain("WORKTREE CONTEXT");
      expect(result).toContain(".worktree-branch");
      expect(result).toContain("git branch --show-current");
      expect(result).toContain(".worktree-origin");
    });

    it("should warn about staying within worktree directory", () => {
      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace/worktree",
        epicId: "abc-123-def-456",
      });

      expect(result).toContain("MUST stay within this worktree directory");
      expect(result).toContain("Do NOT modify files in the main repository");
    });

    it("should return empty string for build mode without workspaceRoot", () => {
      const result = runSection({
        mode: "build",
        epicId: "abc-123-def-456",
      });

      expect(result).toBe("");
    });

    it("should match build mode snapshot", () => {
      const result = runSection({
        mode: "build",
        workspaceRoot: "/workspace/worktree",
        epicId: "abc-123-def-456",
        epicIdentifier: "CLIVE-42",
      });

      expect(result).toMatchSnapshot();
    });
  });

  describe("review mode with epicId", () => {
    it("should return empty string for review mode even with epicId", () => {
      const result = runSection({
        mode: "review",
        workspaceRoot: "/workspace",
        epicId: "abc-123-def-456",
        epicIdentifier: "CLIVE-42",
      });

      expect(result).toBe("");
    });
  });

  describe("edge cases", () => {
    it("should handle undefined mode with epicId", () => {
      const result = runSection({
        workspaceRoot: "/workspace",
        epicId: "abc-123-def-456",
      });

      expect(result).toBe("");
    });

    it("should handle empty string epicId", () => {
      const result = runSection({
        mode: "plan",
        workspaceRoot: "/workspace",
        epicId: "",
      });

      // Empty string is falsy, should return empty
      expect(result).toBe("");
    });
  });
});
