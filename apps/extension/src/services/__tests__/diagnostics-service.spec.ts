import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import { Runtime } from "effect";
import {
  getDiagnostics,
  getNewProblems,
  formatDiagnosticsMessage,
} from "../diagnostics-service";
import {
  createMockDiagnostic,
  createMockDiagnosticWithRange,
  createPrePostDiagnosticScenario,
} from "../../__tests__/mock-factories";

// Mock vscode module using shared factory
vi.mock("vscode", async () => {
  const { createVSCodeMock } = await import("../../__tests__/mock-factories");
  return createVSCodeMock();
});

describe("DiagnosticsService", () => {
  let mockLanguages: {
    getDiagnostics: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLanguages = vscode.languages as unknown as {
      getDiagnostics: ReturnType<typeof vi.fn>;
    };
  });

  describe("getDiagnostics", () => {
    it("should return diagnostics for a given URI", async () => {
      const testUri = vscode.Uri.file("/test/file.ts");
      const expectedDiagnostics = [
        createMockDiagnosticWithRange(5, "Test error"),
      ];
      mockLanguages.getDiagnostics.mockReturnValue(expectedDiagnostics);

      const result = await Runtime.runPromise(Runtime.defaultRuntime)(
        getDiagnostics(testUri),
      );

      expect(result).toEqual(expectedDiagnostics);
      expect(mockLanguages.getDiagnostics).toHaveBeenCalledWith(testUri);
    });

    it("should wait for diagnostics to settle before returning", async () => {
      const testUri = vscode.Uri.file("/test/file.ts");
      mockLanguages.getDiagnostics.mockReturnValue([]);

      const startTime = Date.now();
      await Runtime.runPromise(Runtime.defaultRuntime)(
        getDiagnostics(testUri),
      );
      const endTime = Date.now();

      // Should wait approximately 3500ms (allow some tolerance)
      expect(endTime - startTime).toBeGreaterThanOrEqual(3400);
    });

    it("should return empty array when no diagnostics exist", async () => {
      const testUri = vscode.Uri.file("/test/file.ts");
      mockLanguages.getDiagnostics.mockReturnValue([]);

      const result = await Runtime.runPromise(Runtime.defaultRuntime)(
        getDiagnostics(testUri),
      );

      expect(result).toEqual([]);
    });
  });

  describe("getNewProblems", () => {
    it("should detect new errors introduced after edit", () => {
      const { preDiagnostics, postDiagnostics } =
        createPrePostDiagnosticScenario("new-error");

      const newProblems = getNewProblems(preDiagnostics, postDiagnostics);

      expect(newProblems).toHaveLength(1);
      expect(newProblems[0].message).toBe("New error introduced");
    });

    it("should ignore warnings and only report errors", () => {
      const preEdit = [
        createMockDiagnosticWithRange(5, "Existing error", 0), // Error
        createMockDiagnosticWithRange(7, "Existing warning", 1), // Warning
      ];
      const postEdit = [
        createMockDiagnosticWithRange(5, "Existing error", 0), // Error
        createMockDiagnosticWithRange(7, "Existing warning", 1), // Warning
        createMockDiagnosticWithRange(10, "New warning", 1), // Warning - should be ignored
      ];

      const newProblems = getNewProblems(preEdit, postEdit);

      expect(newProblems).toHaveLength(0);
    });

    it("should not report pre-existing errors", () => {
      const { preDiagnostics, postDiagnostics } =
        createPrePostDiagnosticScenario("unchanged");

      const newProblems = getNewProblems(preDiagnostics, postDiagnostics);

      expect(newProblems).toHaveLength(0);
    });

    it("should handle empty pre-edit diagnostics", () => {
      const preEdit: vscode.Diagnostic[] = [];
      const postEdit = [createMockDiagnosticWithRange(10, "New error", 0)];

      const newProblems = getNewProblems(preEdit, postEdit);

      expect(newProblems).toHaveLength(1);
      expect(newProblems[0].message).toBe("New error");
    });

    it("should handle empty post-edit diagnostics", () => {
      const preEdit = [createMockDiagnosticWithRange(5, "Existing error", 0)];
      const postEdit: vscode.Diagnostic[] = [];

      const newProblems = getNewProblems(preEdit, postEdit);

      expect(newProblems).toHaveLength(0);
    });

    it("should match diagnostics by range and message", () => {
      // Create a mock Range class with isEqual method
      const createRange = (line: number) => ({
        start: { line, character: 0 },
        end: { line, character: 10 },
        isEqual: vi.fn((other: vscode.Range) => {
          return (
            other.start.line === line &&
            other.start.character === 0 &&
            other.end.line === line &&
            other.end.character === 10
          );
        }),
      });

      const preEdit = [
        createMockDiagnostic({
          range: createRange(5) as unknown as vscode.Range,
          message: "Error at line 5",
          severity: 0,
        }),
      ];
      const postEdit = [
        createMockDiagnostic({
          range: createRange(5) as unknown as vscode.Range,
          message: "Error at line 5",
          severity: 0,
        }),
        createMockDiagnostic({
          range: createRange(10) as unknown as vscode.Range,
          message: "New error at line 10",
          severity: 0,
        }),
      ];

      const newProblems = getNewProblems(preEdit, postEdit);

      expect(newProblems).toHaveLength(1);
      expect(newProblems[0].message).toBe("New error at line 10");
    });
  });

  describe("formatDiagnosticsMessage", () => {
    it("should format single diagnostic with line and column", () => {
      const diagnostic = createMockDiagnosticWithRange(
        10,
        "Variable 'x' is not defined",
      );

      const message = formatDiagnosticsMessage([diagnostic]);

      expect(message).toContain("New diagnostic problems introduced:");
      expect(message).toContain("Line 11, Column 1");
      expect(message).toContain("Variable 'x' is not defined");
    });

    it("should format multiple diagnostics", () => {
      const diagnostics = [
        createMockDiagnosticWithRange(10, "First error"),
        createMockDiagnosticWithRange(20, "Second error"),
      ];

      const message = formatDiagnosticsMessage(diagnostics);

      expect(message).toContain("First error");
      expect(message).toContain("Second error");
      expect(message).toContain("Line 11");
      expect(message).toContain("Line 21");
    });

    it("should include diagnostic source when available", () => {
      const diagnostic = createMockDiagnostic({
        message: "Type error",
        source: "typescript",
        severity: 0,
      });

      const message = formatDiagnosticsMessage([diagnostic]);

      expect(message).toContain("[typescript]");
      expect(message).toContain("Type error");
    });

    it("should return empty string for no diagnostics", () => {
      const message = formatDiagnosticsMessage([]);

      expect(message).toBe("");
    });
  });
});

