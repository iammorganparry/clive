/**
 * Tests for RulesService
 * Tests user rules loading from .clive/rules/*.md files
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Effect } from "effect";
import * as vscode from "vscode";
import { RulesService } from "../rules-service.js";

// Mock vscode module using shared factory
vi.mock("vscode", async () => {
  const { createVSCodeMock } = await import("../../../../__tests__/mock-factories");
  return createVSCodeMock();
});

describe("RulesService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty string when no rule files exist", async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([]);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* RulesService;
        return yield* service.loadUserRules();
      }).pipe(Effect.provide(RulesService.Default)),
    );

    expect(result).toBe("");
  });

  it("loads and combines multiple rule files", async () => {
    const mockFiles = [
      { fsPath: "/test/workspace/.clive/rules/rule1.md" },
      { fsPath: "/test/workspace/.clive/rules/rule2.md" },
    ] as vscode.Uri[];

    vi.mocked(vscode.workspace.findFiles).mockResolvedValue(mockFiles);
    vi.mocked(vscode.workspace.fs.readFile)
      .mockResolvedValueOnce(
        new TextEncoder().encode("Content of rule 1"),
      )
      .mockResolvedValueOnce(
        new TextEncoder().encode("Content of rule 2"),
      );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* RulesService;
        return yield* service.loadUserRules();
      }).pipe(Effect.provide(RulesService.Default)),
    );

    expect(result).toContain("## rule1");
    expect(result).toContain("Content of rule 1");
    expect(result).toContain("## rule2");
    expect(result).toContain("Content of rule 2");
  });

  it("gracefully handles read errors for individual files", async () => {
    const mockFiles = [
      { fsPath: "/test/workspace/.clive/rules/good.md" },
      { fsPath: "/test/workspace/.clive/rules/bad.md" },
    ] as vscode.Uri[];

    vi.mocked(vscode.workspace.findFiles).mockResolvedValue(mockFiles);
    vi.mocked(vscode.workspace.fs.readFile)
      .mockResolvedValueOnce(
        new TextEncoder().encode("Good content"),
      )
      .mockRejectedValueOnce(new Error("Read failed"));

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* RulesService;
        return yield* service.loadUserRules();
      }).pipe(Effect.provide(RulesService.Default)),
    );

    // Should include the good file but skip the bad one
    expect(result).toContain("## good");
    expect(result).toContain("Good content");
    expect(result).not.toContain("## bad");
  });

  it("gracefully handles missing .clive/rules directory", async () => {
    vi.mocked(vscode.workspace.findFiles).mockRejectedValue(
      new Error("Directory not found"),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* RulesService;
        return yield* service.loadUserRules();
      }).pipe(Effect.provide(RulesService.Default)),
    );

    expect(result).toBe("");
  });

  it("formats multiple rules with proper sections", async () => {
    const mockFiles = [
      { fsPath: "/test/workspace/.clive/rules/auth-rules.md" },
      { fsPath: "/test/workspace/.clive/rules/testing-rules.md" },
    ] as vscode.Uri[];

    vi.mocked(vscode.workspace.findFiles).mockResolvedValue(mockFiles);
    vi.mocked(vscode.workspace.fs.readFile)
      .mockResolvedValueOnce(
        new TextEncoder().encode("Always authenticate users"),
      )
      .mockResolvedValueOnce(
        new TextEncoder().encode("Write comprehensive tests"),
      );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* RulesService;
        return yield* service.loadUserRules();
      }).pipe(Effect.provide(RulesService.Default)),
    );

    // Should have both rules formatted as sections
    expect(result).toMatch(/## auth-rules\s+Always authenticate users/);
    expect(result).toMatch(
      /## testing-rules\s+Write comprehensive tests/,
    );
    // Should be separated by blank lines
    expect(result).toContain("\n\n");
  });
});

