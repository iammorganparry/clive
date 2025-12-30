/**
 * Unit Tests for Agent Rules Section
 * Tests the agent rules section with various configurations
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { agentRules } from "../agent-rules.js";
import type { BuildConfig } from "../../types.js";

describe("Agent Rules Section", () => {
  describe("Built-in Rules", () => {
    it("should return built-in rules with minimal config", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test/workspace",
      };

      const content = await Effect.runPromise(agentRules(config));

      expect(content).toContain("<rules>");
      expect(content).toContain("NATURAL CONVERSATION");
      expect(content).toContain("CONVERSATIONAL FLEXIBILITY");
      expect(content).toContain("MOCK FACTORY REUSE");
      expect(content).not.toContain("<user_defined_rules>");
    });

    it("should include all expected built-in rule categories", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test/workspace",
      };

      const content = await Effect.runPromise(agentRules(config));

      // Verify all key rule categories are present
      expect(content).toContain("NATURAL CONVERSATION");
      expect(content).toContain("CONVERSATIONAL FLEXIBILITY");
      expect(content).toContain("CONTEXT EFFICIENCY");
      expect(content).toContain("PATTERN RESEARCH");
      expect(content).toContain("MOCK FACTORY REUSE");
      expect(content).toContain("MODE-AWARE BEHAVIOR");
      expect(content).toContain("ITERATIVE TEST CREATION");
      expect(content).toContain("CODE ACCURACY");
      expect(content).toContain("COMPLETION");
      expect(content).toContain("HIGH-VALUE TEST FOCUS");
      expect(content).toContain("VALUE vs EFFORT");
    });
  });

  describe("User-Defined Rules", () => {
    it("should append user rules when provided in config", async () => {
      const config = {
        workspaceRoot: "/test/workspace",
        includeUserRules: true,
        userRules: "## Custom Rule\n\nThis is a custom testing rule.",
      } as BuildConfig & { userRules?: string };

      const content = await Effect.runPromise(agentRules(config));

      expect(content).toContain("<rules>");
      expect(content).toContain("NATURAL CONVERSATION");
      expect(content).toContain("<user_defined_rules>");
      expect(content).toContain("## Custom Rule");
      expect(content).toContain("This is a custom testing rule");
    });

    it("should exclude user rules when includeUserRules is false", async () => {
      const config = {
        workspaceRoot: "/test/workspace",
        includeUserRules: false,
        userRules: "## Custom Rule\n\nThis should not appear.",
      } as BuildConfig & { userRules?: string };

      const content = await Effect.runPromise(agentRules(config));

      expect(content).toContain("<rules>");
      expect(content).toContain("NATURAL CONVERSATION");
      expect(content).not.toContain("<user_defined_rules>");
      expect(content).not.toContain("## Custom Rule");
      expect(content).not.toContain("This should not appear");
    });

    it("should handle empty user rules string", async () => {
      const config = {
        workspaceRoot: "/test/workspace",
        includeUserRules: true,
        userRules: "   ",
      } as BuildConfig & { userRules?: string };

      const content = await Effect.runPromise(agentRules(config));

      expect(content).toContain("<rules>");
      expect(content).not.toContain("<user_defined_rules>");
    });

    it("should handle missing workspaceRoot", async () => {
      const config = {
        includeUserRules: true,
        userRules: "## Custom Rule",
      } as BuildConfig & { userRules?: string };

      const content = await Effect.runPromise(agentRules(config));

      expect(content).toContain("<rules>");
      expect(content).not.toContain("<user_defined_rules>");
    });

    it("should handle undefined userRules", async () => {
      const config = {
        workspaceRoot: "/test/workspace",
        includeUserRules: true,
      } as BuildConfig & { userRules?: string };

      const content = await Effect.runPromise(agentRules(config));

      expect(content).toContain("<rules>");
      expect(content).not.toContain("<user_defined_rules>");
    });
  });
});
