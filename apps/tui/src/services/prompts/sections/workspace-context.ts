import { Effect } from "effect";
import type { BuildConfig, PromptBuildError } from "../types";

/**
 * Workspace context section
 * Provides workspace root and file operation context
 */
export const workspaceContext = (
  config: BuildConfig,
): Effect.Effect<string, PromptBuildError> =>
  Effect.gen(function* () {
    const { workspaceRoot, mode } = config;

    if (!workspaceRoot) {
      return "";
    }

    // Plan mode includes tool mentions for exploration
    if (mode === "plan") {
      return `
WORKSPACE CONTEXT: You are working in the directory: ${workspaceRoot}
All file paths and operations should be relative to this workspace root. Use tools like Read, Glob, and Grep to explore the codebase structure.
`;
    }

    // Build mode has simpler context
    return `
WORKSPACE CONTEXT: You are working in the directory: ${workspaceRoot}
All file paths and operations should be relative to this workspace root.
`;
  });
