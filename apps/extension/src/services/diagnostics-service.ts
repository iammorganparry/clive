/**
 * Diagnostics Service
 * Shared service for capturing and analyzing VS Code diagnostics
 * Extracted from DiffViewProvider for reuse across file tools
 */

import * as vscode from "vscode";
import { Effect } from "effect";

/**
 * Get diagnostics for a URI with a delay to allow diagnostics to settle
 */
export function getDiagnostics(
  uri: vscode.Uri,
): Effect.Effect<vscode.Diagnostic[], never> {
  return Effect.gen(function* () {
    // Wait for diagnostics to update (LSP may be async)
    yield* Effect.sleep("3500 millis");
    const diagnostics = vscode.languages.getDiagnostics(uri);
    return diagnostics;
  });
}

/**
 * Get new problems by comparing pre and post diagnostics
 * Only returns errors (not warnings) that were newly introduced
 */
export function getNewProblems(
  preEdit: vscode.Diagnostic[],
  postEdit: vscode.Diagnostic[],
): vscode.Diagnostic[] {
  // Only report errors, not warnings (to avoid distraction)
  const preEditErrors = preEdit.filter(
    (d) => d.severity === vscode.DiagnosticSeverity.Error,
  );
  const postEditErrors = postEdit.filter(
    (d) => d.severity === vscode.DiagnosticSeverity.Error,
  );

  // Find new errors by comparing ranges and messages
  const newErrors: vscode.Diagnostic[] = [];

  for (const postError of postEditErrors) {
    const isNew = !preEditErrors.some((preError) => {
      return (
        preError.range.isEqual(postError.range) &&
        preError.message === postError.message
      );
    });

    if (isNew) {
      newErrors.push(postError);
    }
  }

  return newErrors;
}

/**
 * Format diagnostics message for AI consumption
 */
export function formatDiagnosticsMessage(
  diagnostics: vscode.Diagnostic[],
): string {
  if (diagnostics.length === 0) {
    return "";
  }

  const messages = diagnostics.map((d) => {
    const line = d.range.start.line + 1;
    const col = d.range.start.character + 1;
    const source = d.source ? `[${d.source}] ` : "";
    return `${source}Line ${line}, Column ${col}: ${d.message}`;
  });

  return `New diagnostic problems introduced:\n${messages.join("\n")}`;
}

