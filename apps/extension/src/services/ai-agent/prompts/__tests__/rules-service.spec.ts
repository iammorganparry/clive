/**
 * Tests for RulesService
 * Tests user rules loading from .clive/rules/*.md files
 */

import { expect, beforeEach, vi } from "vitest";
import { describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type * as vscode from "vscode";
import { RulesService } from "../rules-service.js";
import {
  createMockVSCodeServiceLayer,
  type createVSCodeMock,
} from "../../../../__tests__/mock-factories/index.js";

// Mock vscode globally for code that uses vscode.* directly (e.g., new vscode.RelativePattern())
vi.mock("vscode", async () => {
  const { createVSCodeMock } = await import(
    "../../../../__tests__/mock-factories/vscode-mock.js"
  );
  return createVSCodeMock();
});

describe("RulesService", () => {
  let mockVSCodeServiceLayer: ReturnType<
    typeof createMockVSCodeServiceLayer
  >["layer"];
  let mockVscode: ReturnType<typeof createVSCodeMock>;
  let testLayer: Layer.Layer<RulesService>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock VSCodeService layer
    const { layer, mockVscode: vsMock } = createMockVSCodeServiceLayer();
    mockVSCodeServiceLayer = layer;
    mockVscode = vsMock;

    // Ensure mock workspace has a workspace folder for RulesService to work
    // @ts-expect-error - mockVscode is a mock, so we can mutate it
    mockVscode.workspace.workspaceFolders = [
      {
        uri: { fsPath: "/test/workspace", scheme: "file" } as vscode.Uri,
        name: "workspace",
        index: 0,
      },
    ] as vscode.WorkspaceFolder[];

    // Provide VSCodeService to RulesService
    // RulesService.Default requires VSCodeService.Default as a dependency
    // The standard pattern: ServiceWithDependency.Default.pipe(Layer.provide(dependencyLayer))
    // Merge both layers so both services are available
    testLayer = Layer.mergeAll(
      mockVSCodeServiceLayer,
      RulesService.Default.pipe(Layer.provide(mockVSCodeServiceLayer)),
    );
  });

  it.effect("returns empty string when no rule files exist", () => {
    (
      mockVscode.workspace.findFiles as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);

    return Effect.gen(function* () {
      const service = yield* RulesService;
      const result = yield* service.loadUserRules();
      expect(result).toBe("");
    }).pipe(Effect.provide(testLayer)) as Effect.Effect<void, never, never>;
  });

  it.effect("loads and combines multiple rule files", () => {
    const mockFiles = [
      { fsPath: "/test/workspace/.clive/rules/rule1.md" },
      { fsPath: "/test/workspace/.clive/rules/rule2.md" },
    ] as vscode.Uri[];

    (
      mockVscode.workspace.findFiles as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(mockFiles);
    (mockVscode.workspace.fs.readFile as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new TextEncoder().encode("Content of rule 1"))
      .mockResolvedValueOnce(new TextEncoder().encode("Content of rule 2"));

    return Effect.gen(function* () {
      const service = yield* RulesService;
      const result = yield* service.loadUserRules();
      expect(result).toContain("## rule1");
      expect(result).toContain("Content of rule 1");
      expect(result).toContain("## rule2");
      expect(result).toContain("Content of rule 2");
    }).pipe(Effect.provide(testLayer)) as Effect.Effect<void, never, never>;
  });

  it.effect("gracefully handles read errors for individual files", () => {
    const mockFiles = [
      { fsPath: "/test/workspace/.clive/rules/good.md" },
      { fsPath: "/test/workspace/.clive/rules/bad.md" },
    ] as vscode.Uri[];

    (
      mockVscode.workspace.findFiles as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(mockFiles);
    (mockVscode.workspace.fs.readFile as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new TextEncoder().encode("Good content"))
      .mockRejectedValueOnce(new Error("Read failed"));

    return Effect.gen(function* () {
      const service = yield* RulesService;
      const result = yield* service.loadUserRules();
      // Should include the good file but skip the bad one
      expect(result).toContain("## good");
      expect(result).toContain("Good content");
      expect(result).not.toContain("## bad");
    }).pipe(Effect.provide(testLayer)) as Effect.Effect<void, never, never>;
  });

  it.effect("gracefully handles missing .clive/rules directory", () => {
    (
      mockVscode.workspace.findFiles as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error("Directory not found"));

    return Effect.gen(function* () {
      const service = yield* RulesService;
      const result = yield* service.loadUserRules();
      expect(result).toBe("");
    }).pipe(Effect.provide(testLayer)) as Effect.Effect<void, never, never>;
  });

  it.effect("formats multiple rules with proper sections", () => {
    const mockFiles = [
      { fsPath: "/test/workspace/.clive/rules/auth-rules.md" },
      { fsPath: "/test/workspace/.clive/rules/testing-rules.md" },
    ] as vscode.Uri[];

    (
      mockVscode.workspace.findFiles as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(mockFiles);
    (mockVscode.workspace.fs.readFile as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new TextEncoder().encode("Always authenticate users"),
      )
      .mockResolvedValueOnce(
        new TextEncoder().encode("Write comprehensive tests"),
      );

    return Effect.gen(function* () {
      const service = yield* RulesService;
      const result = yield* service.loadUserRules();
      // Should have both rules formatted as sections
      expect(result).toMatch(/## auth-rules\s+Always authenticate users/);
      expect(result).toMatch(/## testing-rules\s+Write comprehensive tests/);
      // Should be separated by blank lines
      expect(result).toContain("\n\n");
    }).pipe(Effect.provide(testLayer)) as Effect.Effect<void, never, never>;
  });
});
