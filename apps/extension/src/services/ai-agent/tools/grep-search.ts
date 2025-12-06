import * as vscode from "vscode";
import { tool } from "ai";
import { z } from "zod";
import type { GrepSearchInput, GrepSearchOutput } from "../types.js";

/**
 * Tool for searching file contents using file reading and regex matching
 * Efficient for searching across workspace files
 */
export const grepSearchTool = tool({
  description:
    "Search for text patterns in files across the workspace using efficient grep-like search. Supports regex patterns.",
  inputSchema: z.object({
    pattern: z
      .string()
      .describe(
        "The search pattern (regex supported). Example: 'import.*ComponentName' or 'export const'",
      ),
    path: z
      .string()
      .optional()
      .describe(
        "Optional path to limit search scope. Defaults to entire workspace.",
      ),
    fileType: z
      .string()
      .optional()
      .describe(
        "Optional file type filter (e.g., 'tsx', 'ts', 'js'). Searches all files if not specified.",
      ),
    maxResults: z
      .number()
      .optional()
      .default(50)
      .describe("Maximum number of results to return (default: 50)"),
  }),
  execute: async ({
    pattern,
    path: searchPath,
    fileType,
    maxResults = 50,
  }: GrepSearchInput): Promise<GrepSearchOutput> => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error("No workspace folder found");
    }

    try {
      // Build include pattern
      let includePattern = "**/*";
      if (fileType) {
        includePattern = `**/*.${fileType}`;
      }
      if (searchPath) {
        includePattern = `${searchPath}/${includePattern}`;
      }

      const excludePattern =
        "**/node_modules/**,**/dist/**,**/build/**,**/.next/**,**/out/**";

      // Find files matching the pattern
      const files = await vscode.workspace.findFiles(
        includePattern,
        excludePattern,
        maxResults * 10, // Get more files to search through
      );

      const matches: GrepSearchOutput["matches"] = [];
      const regex = new RegExp(pattern, "i"); // Case-insensitive regex

      // Search through files
      for (const fileUri of files) {
        if (matches.length >= maxResults) {
          break;
        }

        try {
          const content = await vscode.workspace.fs.readFile(fileUri);
          const text = Buffer.from(content).toString("utf-8");
          const lines = text.split("\n");

          const relativePath = vscode.workspace.asRelativePath(fileUri, false);

          // Search each line
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= maxResults) {
              break;
            }

            const line = lines[i];
            if (regex.test(line)) {
              matches.push({
                filePath: fileUri.fsPath,
                relativePath,
                lineNumber: i + 1, // 1-indexed
                lineContent: line.trim(),
              });
            }
          }
        } catch {
          // Skip files that can't be read (binary files, etc.)
          continue;
        }
      }

      return {
        matches,
        pattern,
        totalMatches: matches.length,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Grep search failed: ${errorMessage}`);
    }
  },
});
