/**
 * Plan Mode Handler
 *
 * Utilities for handling Claude Code's native planning mode.
 * When using the Claude CLI provider, Claude Code may use its native
 * EnterPlanMode/ExitPlanMode tools which create plan files in .claude/plans/
 *
 * This module provides utilities to:
 * 1. Discover plan files created by native plan mode
 * 2. Read plan file content
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";

/**
 * State tracking for native plan mode
 */
export interface NativePlanModeState {
  /** Whether we're currently in native plan mode */
  isActive: boolean;
  /** Tool call ID from EnterPlanMode */
  enterToolCallId: string | null;
  /** Discovered plan file path */
  planFilePath: string | null;
}

/**
 * Create initial plan mode state
 */
export const createNativePlanModeState = (): NativePlanModeState => ({
  isActive: false,
  enterToolCallId: null,
  planFilePath: null,
});

/**
 * Get potential plan directories to search
 * Claude Code saves plans to:
 * 1. ~/.claude/plans/ (user's home directory - Claude Code's default)
 * 2. {workspaceRoot}/.claude/plans/ (workspace-specific, less common)
 */
const getPlanDirectories = (workspaceRoot: string): string[] => {
  const homeDir = os.homedir();
  const dirs: string[] = [];

  // Primary location: user's home directory (Claude Code default)
  if (homeDir) {
    dirs.push(path.join(homeDir, ".claude", "plans"));
  }

  // Secondary location: workspace root
  dirs.push(path.join(workspaceRoot, ".claude", "plans"));

  return dirs;
};

/**
 * Discover the most recent plan file in .claude/plans/
 *
 * Strategy:
 * 1. Check both ~/.claude/plans/ and {workspaceRoot}/.claude/plans/
 * 2. Find all .md files in each directory
 * 3. Sort by modification time across all directories
 * 4. Return the most recent one
 *
 * @param workspaceRoot - The workspace root directory
 * @returns The path to the most recent plan file, or null if none found
 */
export const discoverPlanFilePath = (
  workspaceRoot: string,
): Effect.Effect<string | null, never> =>
  Effect.gen(function* () {
    const plansDirs = getPlanDirectories(workspaceRoot);
    const allFileStats: Array<{ name: string; path: string; mtime: Date }> = [];

    for (const plansDir of plansDirs) {
      // Check if directory exists
      const dirExists = yield* Effect.sync(() => {
        try {
          return fs.existsSync(plansDir) && fs.statSync(plansDir).isDirectory();
        } catch {
          return false;
        }
      });

      if (!dirExists) {
        continue;
      }

      // Find all .md files
      const files = yield* Effect.sync(() => {
        try {
          return fs.readdirSync(plansDir).filter((f) => f.endsWith(".md"));
        } catch {
          return [] as string[];
        }
      });

      // Get file stats
      const fileStats = yield* Effect.sync(() => {
        return files
          .map((f) => {
            const filePath = path.join(plansDir, f);
            try {
              const stat = fs.statSync(filePath);
              return {
                name: f,
                path: filePath,
                mtime: stat.mtime,
              };
            } catch {
              return null;
            }
          })
          .filter((f): f is NonNullable<typeof f> => f !== null);
      });

      allFileStats.push(...fileStats);
    }

    if (allFileStats.length === 0) {
      return null;
    }

    // Sort by modification time (most recent first) across all directories
    allFileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    return allFileStats[0].path;
  });

/**
 * Read plan file content
 *
 * @param planFilePath - Path to the plan file
 * @returns The content of the plan file
 */
export const readPlanContent = (
  planFilePath: string,
): Effect.Effect<string, Error> =>
  Effect.try({
    try: () => fs.readFileSync(planFilePath, "utf-8"),
    catch: (e) =>
      new Error(
        `Failed to read plan file at ${planFilePath}: ${e instanceof Error ? e.message : String(e)}`,
      ),
  });

/**
 * Read plan content with retry logic
 *
 * Useful when the plan file might still be being written.
 *
 * @param planFilePath - Path to the plan file
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param delayMs - Delay between retries in milliseconds (default: 500)
 * @returns The content of the plan file
 */
export const readPlanContentWithRetry = (
  planFilePath: string,
  maxRetries = 3,
  delayMs = 500,
): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = yield* readPlanContent(planFilePath).pipe(
        Effect.map((content) => ({ success: true as const, content })),
        Effect.catchAll((error) =>
          Effect.succeed({ success: false as const, error }),
        ),
      );

      if (result.success) {
        return result.content;
      }

      lastError = result.error;

      // Wait before retrying (unless this was the last attempt)
      if (attempt < maxRetries) {
        yield* Effect.sleep(delayMs);
      }
    }

    return yield* Effect.fail(
      lastError ?? new Error("Failed to read plan file after retries"),
    );
  });
