/**
 * Integration tests for PromptService
 * Tests complete prompt building with snapshots
 */

import { describe, expect, beforeEach, vi } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as vscode from "vscode";
import { PromptService } from "../prompt-service.js";
import { RulesService } from "../rules-service.js";
import type { BuildConfig } from "../types.js";
import { createMockVSCodeServiceLayer } from "../../../../__tests__/mock-factories/index.js";
import { getVSCodeMock } from "../../../../__tests__/mock-factories/vscode-mock.js";

// Mock vscode globally for RulesService which uses vscode.* directly
// Use setupVSCodeMock to ensure singleton pattern - same instance used everywhere
vi.mock("vscode", async () => {
  const { setupVSCodeMock } = await import(
    "../../../../__tests__/mock-factories/vscode-mock.js"
  );
  return setupVSCodeMock();
});

describe("PromptService Integration", () => {
  let mockVSCodeServiceLayer: ReturnType<
    typeof createMockVSCodeServiceLayer
  >["layer"];
  let mockVscode: typeof vscode;

  // PromptService depends on RulesService, which depends on VSCodeService
  // Merge mock VSCodeService and RulesService, then provide to PromptService
  let testLayer: Layer.Layer<PromptService>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Get the singleton mock instance that vi.mock("vscode") created
    // This is the same instance used by VSCodeService.Default
    mockVscode = getVSCodeMock() ?? vscode;

    // Create mock VSCodeService layer (needed for Effect context)
    const { layer } = createMockVSCodeServiceLayer();
    mockVSCodeServiceLayer = layer;

    // First provide RulesService to PromptService (PromptService depends on RulesService)
    // Then merge with VSCodeService (RulesService needs VSCodeService but doesn't declare it)
    const promptWithRules = PromptService.Default.pipe(
      Layer.provide(RulesService.Default),
    );
    testLayer = Layer.merge(promptWithRules, mockVSCodeServiceLayer);

    // Default: no user rules
    (
      mockVscode.workspace.findFiles as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);
  });

  describe("buildTestAgentPrompt", () => {
    it.effect(
      "builds complete prompt without user rules",
      () =>
        Effect.gen(function* () {
          const config: BuildConfig = {
            workspaceRoot: "/test-workspace",
            mode: "plan",
            includeUserRules: false,
          };

          const service = yield* PromptService;
          const prompt = yield* service.buildTestAgentPrompt(config);

          yield* Effect.sync(() => {
            // Should contain all major sections
            expect(prompt).toContain("<role>");
            expect(prompt).toContain("<knowledge_base>");
            expect(prompt).toContain("<workflow>");
            expect(prompt).toContain("<rules>");
            expect(prompt).not.toContain("<user_defined_rules>");

            // Snapshot test for full prompt
            expect(prompt).toMatchSnapshot();
          });
        }).pipe(Effect.provide(testLayer)) as Effect.Effect<void>,
    );

    it.effect("builds complete prompt with user rules", () => {
      const mockRuleFile = {
        fsPath: "/test-workspace/.clive/rules/custom.md",
      } as vscode.Uri;

      // Set mocks before Effect execution
      (
        mockVscode.workspace.findFiles as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue([mockRuleFile]);
      (
        mockVscode.workspace.fs.readFile as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(
        new TextEncoder().encode("Always use TypeScript for new files"),
      );

      return Effect.gen(function* () {
        const config: BuildConfig = {
          workspaceRoot: "/test-workspace",
          mode: "act",
          includeUserRules: true,
        };

        const service = yield* PromptService;
        const prompt = yield* service.buildTestAgentPrompt(config);

        yield* Effect.sync(() => {
          // Should contain user rules
          expect(prompt).toContain("<user_defined_rules>");
          expect(prompt).toContain("Always use TypeScript for new files");

          // Snapshot with user rules
          expect(prompt).toMatchSnapshot();
        });
      }).pipe(Effect.provide(testLayer)) as Effect.Effect<void>;
    });

    it.effect(
      "builds prompt without workspace root",
      () =>
        Effect.gen(function* () {
          const config: BuildConfig = {
            mode: "plan",
          };

          const service = yield* PromptService;
          const prompt = yield* service.buildTestAgentPrompt(config);

          yield* Effect.sync(() => {
            // Should still work but without user rules
            expect(prompt).toContain("<role>");
            expect(prompt).not.toContain("<user_defined_rules>");
          });
        }).pipe(Effect.provide(testLayer)) as Effect.Effect<void>,
    );

    it.effect(
      "replaces all placeholders in template",
      () =>
        Effect.gen(function* () {
          const config: BuildConfig = {
            workspaceRoot: "/test-workspace",
            mode: "plan",
            includeUserRules: false,
          };

          const service = yield* PromptService;
          const prompt = yield* service.buildTestAgentPrompt(config);

          yield* Effect.sync(() => {
            // Should not contain any unresolved placeholders
            expect(prompt).not.toMatch(/\{\{[A-Z_]+\}\}/);
          });
        }).pipe(Effect.provide(testLayer)) as Effect.Effect<void>,
    );

    it.effect(
      "final line matches expected ending",
      () =>
        Effect.gen(function* () {
          const config: BuildConfig = {
            workspaceRoot: "/test-workspace",
            mode: "plan",
          };

          const service = yield* PromptService;
          const prompt = yield* service.buildTestAgentPrompt(config);

          yield* Effect.sync(() => {
            // Should end with the expected final line
            expect(prompt.trim()).toMatch(
              /Focus on comprehensive testing strategy.*conversation flow\.?\s*$/,
            );
          });
        }).pipe(Effect.provide(testLayer)) as Effect.Effect<void>,
    );
  });

  describe("buildCustomPrompt", () => {
    it.effect(
      "builds prompt with only specified sections",
      () =>
        Effect.gen(function* () {
          const { SectionId } = yield* Effect.promise(
            () => import("../types.js"),
          );

          const customTemplate = `{{AGENT_ROLE}}

{{WORKFLOW}}`;

          const sections = [SectionId.AgentRole, SectionId.Workflow];

          const service = yield* PromptService;
          const prompt = yield* service.buildCustomPrompt(
            sections,
            customTemplate,
            {
              mode: "plan",
            },
          );

          yield* Effect.sync(() => {
            // Should contain only specified sections
            expect(prompt).toContain("<role>");
            expect(prompt).toContain("<workflow>");
            // Should not contain other sections
            expect(prompt).not.toContain("<knowledge_base>");
            expect(prompt).not.toContain("<rules>");
          });
        }).pipe(Effect.provide(testLayer)) as Effect.Effect<void>,
    );
  });
});
