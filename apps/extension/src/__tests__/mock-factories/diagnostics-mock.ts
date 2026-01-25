/**
 * Mock factories for VS Code diagnostics
 * Provides helpers for creating test diagnostics scenarios
 */

import type * as vscode from "vscode";

/**
 * Create a mock diagnostic with optional overrides
 */
export function createMockDiagnostic(
  overrides?: Partial<vscode.Diagnostic>,
): vscode.Diagnostic {
  const defaultRange = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 10 },
    isEqual: (other: vscode.Range) => {
      return (
        defaultRange.start.line === other.start.line &&
        defaultRange.start.character === other.start.character &&
        defaultRange.end.line === other.end.line &&
        defaultRange.end.character === other.end.character
      );
    },
  } as unknown as vscode.Range;

  return {
    range: overrides?.range ?? defaultRange,
    message: overrides?.message ?? "Test diagnostic message",
    severity: overrides?.severity ?? 0, // DiagnosticSeverity.Error
    source: overrides?.source,
    code: overrides?.code,
  } as vscode.Diagnostic;
}

/**
 * Create a mock diagnostic with a specific line and message
 */
export function createMockDiagnosticWithRange(
  line: number,
  message: string,
  severity: number = 0, // DiagnosticSeverity.Error
): vscode.Diagnostic {
  const range = {
    start: { line, character: 0 },
    end: { line, character: 10 },
    isEqual: (other: vscode.Range) => {
      return (
        range.start.line === other.start.line &&
        range.start.character === other.start.character &&
        range.end.line === other.end.line &&
        range.end.character === other.end.character
      );
    },
  } as unknown as vscode.Range;

  return createMockDiagnostic({
    range,
    message,
    severity,
  });
}

/**
 * Create pre/post diagnostic scenarios for testing
 */
export function createPrePostDiagnosticScenario(
  scenario: "new-error" | "fixed-error" | "unchanged",
): {
  preDiagnostics: vscode.Diagnostic[];
  postDiagnostics: vscode.Diagnostic[];
} {
  const existingError = createMockDiagnosticWithRange(5, "Existing error", 0);
  const newError = createMockDiagnosticWithRange(10, "New error introduced", 0);
  const existingWarning = createMockDiagnosticWithRange(
    7,
    "Existing warning",
    1, // DiagnosticSeverity.Warning
  );

  switch (scenario) {
    case "new-error":
      return {
        preDiagnostics: [existingError, existingWarning],
        postDiagnostics: [existingError, existingWarning, newError],
      };
    case "fixed-error":
      return {
        preDiagnostics: [existingError, existingWarning],
        postDiagnostics: [existingWarning],
      };
    case "unchanged":
      return {
        preDiagnostics: [existingError, existingWarning],
        postDiagnostics: [existingError, existingWarning],
      };
  }
}
