import * as vscode from "vscode";
import * as path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { Effect, Runtime } from "effect";
import type { ListFilesInput, ListFilesOutput } from "../types.js";
import type { TokenBudgetService } from "../token-budget.js";
import { countTokensInText } from "../../../utils/token-utils.js";
import {
  findFilesEffect,
  statFileEffect,
  getRelativePath,
  getWorkspaceRoot,
  resolvePathToUri,
} from "../../../lib/vscode-effects.js";
import {
  TOOL_CONCURRENCY,
  SEARCH_LIMITS,
} from "../../../consts/tool-constants.js";

/**
 * Get file info for a single URI with stat
 */
const getFileInfo = (fileUri: vscode.Uri) =>
  Effect.gen(function* () {
    const stat = yield* statFileEffect(fileUri);
    const relativePath = yield* getRelativePath(fileUri);
    return {
      path: fileUri.fsPath,
      relativePath,
      isDirectory: stat.type === vscode.FileType.Directory,
    };
  }).pipe(
    // Return null for files that can't be stat'd
    Effect.catchAll(() => Effect.succeed(null)),
  );

/**
 * Factory function to create listFilesTool with token budget awareness
 * Uses LOW priority - up to 10% of remaining budget (just file paths)
 * Implements bounded concurrency for file stats
 */
export const createListFilesTool = (budget: TokenBudgetService) =>
  tool({
    description:
      "List files and directories in a given directory path. Respects gitignore patterns.",
    inputSchema: z.object({
      directoryPath: z
        .string()
        .describe(
          "The directory path to list. Can be relative to workspace root or absolute.",
        ),
      includePattern: z
        .string()
        .optional()
        .describe("Optional glob pattern to include only matching files"),
      excludePattern: z
        .string()
        .optional()
        .describe("Optional glob pattern to exclude matching files"),
    }),
    execute: async ({
      directoryPath,
      includePattern,
      excludePattern,
    }: ListFilesInput): Promise<ListFilesOutput> => {
      return Runtime.runPromise(Runtime.defaultRuntime)(
        Effect.gen(function* () {
          const workspaceRoot = yield* getWorkspaceRoot();
          const dirUri = yield* resolvePathToUri(directoryPath, workspaceRoot);
          const dirRelativePath = yield* getRelativePath(dirUri);

          // Build search pattern
          let searchPattern = includePattern || "**/*";
          if (directoryPath !== "." && directoryPath !== "") {
            searchPattern = path.join(dirRelativePath, searchPattern);
          }

          // Build exclude pattern
          const excludePatterns = ["**/node_modules/**"];
          if (excludePattern) {
            excludePatterns.push(excludePattern);
          }

          // Find files using Effect
          const files = yield* findFilesEffect(
            searchPattern,
            excludePatterns.join(","),
            SEARCH_LIMITS.LIST_FILES_MAX,
          );

          // Stat files with bounded concurrency
          const fileStats = yield* Effect.all(
            files.map((fileUri) => getFileInfo(fileUri)),
            { concurrency: TOOL_CONCURRENCY.FILE_STAT },
          );

          // Filter out nulls (files that couldn't be stat'd)
          const validFiles = fileStats.filter(
            (file): file is NonNullable<typeof file> => file !== null,
          );

          // Format results as a string for token counting
          const resultsText = JSON.stringify(
            {
              files: validFiles,
              directoryPath: dirRelativePath,
            },
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
          let finalOutput: ListFilesOutput;
          if (wasTruncated) {
            try {
              const parsed = JSON.parse(truncated);
              finalOutput = {
                files: parsed.files || validFiles.slice(0, 50),
                directoryPath: parsed.directoryPath || dirRelativePath,
              };
            } catch {
              // If parsing fails, return truncated list
              finalOutput = {
                files: validFiles.slice(0, 50),
                directoryPath: dirRelativePath,
              };
            }
          } else {
            finalOutput = {
              files: validFiles,
              directoryPath: dirRelativePath,
            };
          }

          return finalOutput;
        }).pipe(
          Effect.catchAll((error) =>
            Effect.fail(
              new Error(
                `Failed to list files: ${error instanceof Error ? error.message : "Unknown error"}`,
              ),
            ),
          ),
        ),
      );
    },
  });
