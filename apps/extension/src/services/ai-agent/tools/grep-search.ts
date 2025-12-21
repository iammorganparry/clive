import type * as vscode from "vscode";
import { tool } from "ai";
import { z } from "zod";
import { Effect, Runtime } from "effect";
import type { GrepSearchInput, GrepSearchOutput } from "../types.js";
import type { TokenBudgetService } from "../token-budget.js";
import { countTokensInText } from "../../../utils/token-utils.js";
import {
  findFilesEffect,
  readFileAsStringEffect,
  getRelativePath,
  getWorkspaceRoot,
} from "../../../lib/vscode-effects.js";
import {
  TOOL_CONCURRENCY,
  SEARCH_LIMITS,
} from "../../../consts/tool-constants.js";

/**
 * Search a single file for pattern matches
 * Returns matches found in the file
 */
const searchFileForPattern = (
  fileUri: vscode.Uri,
  regex: RegExp,
  maxResults: number,
  currentMatchCount: number,
) =>
  Effect.gen(function* () {
    const text = yield* readFileAsStringEffect(fileUri);
    const lines = text.split("\n");
    const relativePath = yield* getRelativePath(fileUri);

    const matches: GrepSearchOutput["matches"] = [];
    const remainingSlots = maxResults - currentMatchCount;

    for (let i = 0; i < lines.length && matches.length < remainingSlots; i++) {
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

    return matches;
  }).pipe(
    // Silently skip files that can't be read (binary files, etc.)
    Effect.catchAll(() => Effect.succeed([] as GrepSearchOutput["matches"])),
  );

/**
 * Factory function to create grepSearchTool with token budget awareness
 * Uses MEDIUM priority - up to 25% of remaining budget
 * Implements bounded concurrency for file reading
 */
export const createGrepSearchTool = (budget: TokenBudgetService) =>
  tool({
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
        .default(SEARCH_LIMITS.GREP_MAX_RESULTS)
        .describe(
          `Maximum number of results to return (default: ${SEARCH_LIMITS.GREP_MAX_RESULTS})`,
        ),
    }),
    execute: async ({
      pattern,
      path: searchPath,
      fileType,
      maxResults = SEARCH_LIMITS.GREP_MAX_RESULTS,
    }: GrepSearchInput): Promise<GrepSearchOutput> => {
      return Runtime.runPromise(Runtime.defaultRuntime)(
        Effect.gen(function* () {
          // Validate workspace
          yield* getWorkspaceRoot();

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

          // Find files using Effect
          const files = yield* findFilesEffect(
            includePattern,
            excludePattern,
            maxResults * SEARCH_LIMITS.FILE_SEARCH_MULTIPLIER,
          );

          const regex = new RegExp(pattern, "i"); // Case-insensitive regex

          // Process files with bounded concurrency
          // We need to track total matches across all files
          const allMatches: GrepSearchOutput["matches"] = [];

          // Process in batches with bounded concurrency
          const batchSize = TOOL_CONCURRENCY.FILE_READ;
          for (
            let i = 0;
            i < files.length && allMatches.length < maxResults;
            i += batchSize
          ) {
            const batch = files.slice(i, i + batchSize);

            const batchResults = yield* Effect.all(
              batch.map((fileUri) =>
                searchFileForPattern(
                  fileUri,
                  regex,
                  maxResults,
                  allMatches.length,
                ),
              ),
              { concurrency: TOOL_CONCURRENCY.FILE_READ },
            );

            // Flatten and add to results
            for (const matches of batchResults) {
              for (const match of matches) {
                if (allMatches.length < maxResults) {
                  allMatches.push(match);
                }
              }
            }
          }

          // Format results as a string for token counting
          const resultsText = JSON.stringify(allMatches, null, 2);

          // Apply budget-aware truncation (MEDIUM priority)
          const { content: truncated, wasTruncated } =
            yield* budget.truncateToFit(resultsText, "medium");

          // Consume tokens for the truncated content
          const tokens = countTokensInText(truncated);
          yield* budget.consume(tokens);

          // Parse back to matches array if truncated
          let finalMatches = allMatches;
          if (wasTruncated) {
            try {
              finalMatches = JSON.parse(truncated);
            } catch {
              // If parsing fails, return original matches but truncated
              finalMatches = allMatches.slice(
                0,
                Math.floor(allMatches.length * 0.5),
              );
            }
          }

          return {
            matches: finalMatches,
            pattern,
            totalMatches: finalMatches.length,
            wasTruncated,
          };
        }).pipe(
          Effect.catchAll((error) =>
            Effect.fail(
              new Error(
                `Grep search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              ),
            ),
          ),
        ),
      );
    },
  });
