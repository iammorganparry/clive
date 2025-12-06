import * as vscode from "vscode";
import { tool } from "ai";
import { z } from "zod";
import type { GlobSearchInput, GlobSearchOutput } from "../types.js";

/**
 * Tool for finding files by glob pattern
 */
export const globSearchTool = tool({
  description:
    "Find files matching a glob pattern. Useful for finding test files, config files, or files by extension.",
  inputSchema: z.object({
    pattern: z
      .string()
      .describe(
        "Glob pattern to match files. Examples: '**/*.cy.ts', '**/cypress.config.*', '**/components/**/*.tsx'",
      ),
    excludePattern: z
      .string()
      .optional()
      .describe(
        "Optional glob pattern to exclude. Defaults to excluding node_modules, dist, build, .next",
      ),
  }),
  execute: async ({
    pattern,
    excludePattern,
  }: GlobSearchInput): Promise<GlobSearchOutput> => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error("No workspace folder found");
    }

    try {
      // Default exclude patterns
      const defaultExcludes = [
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/.next/**",
        "**/out/**",
      ];

      const exclude = excludePattern
        ? [...defaultExcludes, excludePattern].join(",")
        : defaultExcludes.join(",");

      const files = await vscode.workspace.findFiles(pattern, exclude);

      const fileList = files.map((fileUri) => {
        const relativePath = vscode.workspace.asRelativePath(fileUri, false);
        return {
          path: fileUri.fsPath,
          relativePath,
        };
      });

      return {
        files: fileList,
        pattern,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Glob search failed: ${errorMessage}`);
    }
  },
});
