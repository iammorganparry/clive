/**
 * Integration tests for PromptService
 * Tests complete prompt building with snapshots
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Effect, Layer } from "effect";
import * as vscode from "vscode";
import { PromptService } from "../prompt-service.js";
import { RulesService } from "../rules-service.js";
import type { BuildConfig } from "../types.js";

// Mock vscode module using shared factory
vi.mock("vscode", async () => {
  const { createVSCodeMock } = await import("../../../../__tests__/mock-factories");
  return createVSCodeMock();
});

describe("PromptService Integration", () => {
  const testLayer = PromptService.Default.pipe(
    Layer.provide(RulesService.Default),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no user rules
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([]);
  });

  describe("buildTestAgentPrompt", () => {
    it("builds complete prompt without user rules", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test-workspace",
        mode: "plan",
        includeUserRules: false,
      };

      const prompt = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PromptService;
          return yield* service.buildTestAgentPrompt(config);
        }).pipe(Effect.provide(testLayer)),
      );

      // Should contain all major sections
      expect(prompt).toContain("<role>");
      expect(prompt).toContain("<knowledge_base>");
      expect(prompt).toContain("<workflow>");
      expect(prompt).toContain("<rules>");
      expect(prompt).not.toContain("<user_defined_rules>");

      // Snapshot test for full prompt
      expect(prompt).toMatchSnapshot();
    });

    it("builds complete prompt with user rules", async () => {
      const mockRuleFile = {
        fsPath: "/test-workspace/.clive/rules/custom.md",
      } as vscode.Uri;

      vi.mocked(vscode.workspace.findFiles).mockResolvedValue([
        mockRuleFile,
      ]);
      vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
        new TextEncoder().encode(
          "Always use TypeScript for new files",
        ),
      );

      const config: BuildConfig = {
        workspaceRoot: "/test-workspace",
        mode: "act",
        includeUserRules: true,
      };

      const prompt = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PromptService;
          return yield* service.buildTestAgentPrompt(config);
        }).pipe(Effect.provide(testLayer)),
      );

      // Should contain user rules
      expect(prompt).toContain("<user_defined_rules>");
      expect(prompt).toContain("Always use TypeScript for new files");

      // Snapshot with user rules
      expect(prompt).toMatchSnapshot();
    });

    it("builds prompt without workspace root", async () => {
      const config: BuildConfig = {
        mode: "plan",
      };

      const prompt = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PromptService;
          return yield* service.buildTestAgentPrompt(config);
        }).pipe(Effect.provide(testLayer)),
      );

      // Should still work but without user rules
      expect(prompt).toContain("<role>");
      expect(prompt).not.toContain("<user_defined_rules>");
    });

    it("replaces all placeholders in template", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test-workspace",
        mode: "plan",
        includeUserRules: false,
      };

      const prompt = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PromptService;
          return yield* service.buildTestAgentPrompt(config);
        }).pipe(Effect.provide(testLayer)),
      );

      // Should not contain any unresolved placeholders
      expect(prompt).not.toMatch(/\{\{[A-Z_]+\}\}/);
    });

    it("final line matches expected ending", async () => {
      const config: BuildConfig = {
        workspaceRoot: "/test-workspace",
        mode: "plan",
      };

      const prompt = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PromptService;
          return yield* service.buildTestAgentPrompt(config);
        }).pipe(Effect.provide(testLayer)),
      );

      // Should end with the expected final line
      expect(prompt.trim()).toMatch(
        /Focus on comprehensive testing strategy.*conversation flow\.$/,
      );
    });
  });

  describe("buildCustomPrompt", () => {
    it("builds prompt with only specified sections", async () => {
      const { SectionId } = await import("../types.js");

      const customTemplate = `{{AGENT_ROLE}}

{{WORKFLOW}}`;

      const sections = [SectionId.AgentRole, SectionId.Workflow];

      const prompt = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PromptService;
          return yield* service.buildCustomPrompt(
            sections,
            customTemplate,
            { mode: "plan" },
          );
        }).pipe(Effect.provide(testLayer)),
      );

      // Should contain only specified sections
      expect(prompt).toContain("<role>");
      expect(prompt).toContain("<workflow>");
      // Should not contain other sections
      expect(prompt).not.toContain("<knowledge_base>");
      expect(prompt).not.toContain("<rules>");
    });
  });
});

