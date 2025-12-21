import { tool } from "ai";
import { z } from "zod";
import { Effect, Runtime } from "effect";
import type { GlobSearchInput, GlobSearchOutput } from "../types.js";
import type { TokenBudgetService } from "../token-budget.js";
import { countTokensInText } from "../../../utils/token-utils.js";
import {
  findFilesEffect,
  getRelativePath,
  getWorkspaceRoot,
} from "../../../lib/vscode-effects.js";
import { SEARCH_LIMITS } from "../../../consts/tool-constants.js";

/**
 * Factory function to create globSearchTool with token budget awareness
 * Uses LOW priority - up to 10% of remaining budget (just file paths)
 */
export const createGlobSearchTool = (budget: TokenBudgetService) =>
  tool({
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
      return Runtime.runPromise(Runtime.defaultRuntime)(
        Effect.gen(function* () {
          // Validate workspace
          yield* getWorkspaceRoot();

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

          // Find files using Effect
          const files = yield* findFilesEffect(
            pattern,
            exclude,
            SEARCH_LIMITS.LIST_FILES_MAX,
          );

          // Map files to output format (no parallel ops needed, just sync mapping)
          const fileListEffects = files.map((fileUri) =>
            Effect.gen(function* () {
              const relativePath = yield* getRelativePath(fileUri);
              return {
                path: fileUri.fsPath,
                relativePath,
              };
            }),
          );

          const fileList = yield* Effect.all(fileListEffects, {
            concurrency: "unbounded", // getRelativePath is sync, safe to run all at once
          });

          // Format results as a string for token counting
          const resultsText = JSON.stringify(
            { files: fileList, pattern },
            null,
            2,
          );

          // Apply budget-aware truncation (LOW priority - just file paths)
          const { content: truncated, wasTruncated } =
            yield* budget.truncateToFit(resultsText, "low");

          // Consume tokens for the truncated content
          const tokens = countTokensInText(truncated);
          yield* budget.consume(tokens);

          // Parse back to output format if truncated
          let finalOutput: GlobSearchOutput;
          if (wasTruncated) {
            try {
              const parsed = JSON.parse(truncated);
              finalOutput = {
                files: parsed.files || fileList.slice(0, 50),
                pattern: parsed.pattern || pattern,
              };
            } catch {
              // If parsing fails, return truncated list
              finalOutput = {
                files: fileList.slice(0, 50),
                pattern,
              };
            }
          } else {
            finalOutput = {
              files: fileList,
              pattern,
            };
          }

          return finalOutput;
        }).pipe(
          Effect.catchAll((error) =>
            Effect.fail(
              new Error(
                `Glob search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              ),
            ),
          ),
        ),
      );
    },
  });
