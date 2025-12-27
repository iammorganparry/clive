/**
 * Snapshot tests for all prompt sections
 * Ensures sections remain stable and changes are visible in review
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { sectionRegistry } from "../sections/index.js";
import { SectionId } from "../types.js";
import type { BuildConfig } from "../types.js";

describe("Prompt Sections", () => {
  const baseConfig: BuildConfig = {
    workspaceRoot: "/test/workspace",
    mode: "plan",
    includeUserRules: false,
  };

  // Test each section with base config
  describe("Base Sections (no user rules)", () => {
    for (const [id, sectionFn] of Object.entries(sectionRegistry)) {
      it(`${id} matches snapshot`, async () => {
        const content = await Effect.runPromise(sectionFn(baseConfig));
        expect(content).toMatchSnapshot();
      });
    }
  });

  // Test agent rules section with user rules
  describe("Agent Rules with User Rules", () => {
    it("includes user rules when provided", async () => {
      const configWithUserRules = {
        ...baseConfig,
        includeUserRules: true,
        userRules: "## Custom Rule 1\n\nThis is a custom rule.",
      } as BuildConfig & { userRules?: string };

      const content = await Effect.runPromise(
        sectionRegistry[SectionId.AgentRules](configWithUserRules),
      );

      expect(content).toContain("<user_defined_rules>");
      expect(content).toContain("## Custom Rule 1");
      expect(content).toMatchSnapshot();
    });

    it("excludes user rules when includeUserRules is false", async () => {
      const configWithoutUserRules = {
        ...baseConfig,
        includeUserRules: false,
        userRules: "## Custom Rule 1\n\nThis is a custom rule.",
      } as BuildConfig & { userRules?: string };

      const content = await Effect.runPromise(
        sectionRegistry[SectionId.AgentRules](configWithoutUserRules),
      );

      expect(content).not.toContain("<user_defined_rules>");
      expect(content).not.toContain("## Custom Rule 1");
    });
  });

  // Test mode variations
  describe("Mode Variations", () => {
    it("AgentRole section works in act mode", async () => {
      const actConfig: BuildConfig = { ...baseConfig, mode: "act" };
      const content = await Effect.runPromise(
        sectionRegistry[SectionId.AgentRole](actConfig),
      );
      expect(content).toMatchSnapshot();
    });
  });
});

