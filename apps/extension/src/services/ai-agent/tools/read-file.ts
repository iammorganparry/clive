import * as vscode from "vscode";
import { tool } from "ai";
import { z } from "zod";
import { Effect, Runtime, Data } from "effect";
import type { ReadFileInput, ReadFileOutput } from "../types.js";
import { countTokensInText } from "../../../utils/token-utils.js";
import type { TokenBudgetService } from "../token-budget.js";
import {
  readFileAsStringEffect,
  statFileEffect,
  getRelativePath,
  getWorkspaceRoot,
  resolvePathToUri,
} from "../../../lib/vscode-effects.js";

/**
 * Error for when a path is a directory instead of a file
 */
class IsDirectoryError extends Data.TaggedError("IsDirectoryError")<{
  path: string;
}> {}

/**
 * Factory function to create readFileTool with token budget awareness
 * When lineRange is provided, uses HIGH priority (focused context)
 * When reading full file, uses LOW priority (only when necessary)
 */
export const createReadFileTool = (budget: TokenBudgetService) =>
  tool({
    description:
      "Read the contents of a file from the workspace. Use relative paths from the workspace root or absolute paths. When you know specific line numbers from a diff, use lineRange to read only those lines for better token efficiency.",
    inputSchema: z.object({
      filePath: z
        .string()
        .describe(
          "The path to the file to read. Can be relative to workspace root or absolute.",
        ),
      lineRange: z
        .object({
          start: z.number().describe("Start line number (1-indexed)"),
          end: z.number().describe("End line number (1-indexed, inclusive)"),
        })
        .optional()
        .describe(
          "Optional line range to read. Use when you know specific lines from diff. This is more token-efficient than reading the entire file.",
        ),
    }),
    execute: async ({
      filePath,
      lineRange,
    }: ReadFileInput & {
      lineRange?: { start: number; end: number };
    }): Promise<ReadFileOutput> => {
      return Runtime.runPromise(Runtime.defaultRuntime)(
        Effect.gen(function* () {
          const workspaceRoot = yield* getWorkspaceRoot();
          const fileUri = yield* resolvePathToUri(filePath, workspaceRoot);
          const relativePath = yield* getRelativePath(fileUri);

          // Check if path exists and is a file (not a directory)
          const stat = yield* statFileEffect(fileUri);
          if (stat.type === vscode.FileType.Directory) {
            return yield* Effect.fail(
              new IsDirectoryError({ path: relativePath }),
            );
          }

          // Read file content
          const text = yield* readFileAsStringEffect(fileUri);
          const lines = text.split("\n");
          const totalLines = lines.length;

          let contentToProcess: string;
          let wasRangeLimited = false;

          // If lineRange is provided, extract only those lines
          if (lineRange) {
            const start = Math.max(0, lineRange.start - 1); // Convert to 0-indexed
            const end = Math.min(totalLines, lineRange.end); // End is inclusive
            const selectedLines = lines.slice(start, end);
            contentToProcess = selectedLines.join("\n");
            wasRangeLimited = true;
          } else {
            contentToProcess = text;
          }

          // Apply budget-aware truncation
          // Use HIGH priority if lineRange was provided (focused context)
          // Use LOW priority if reading full file (only when necessary)
          const priority = wasRangeLimited ? "high" : "low";
          const { content: truncated, wasTruncated } =
            yield* budget.truncateToFit(contentToProcess, priority);

          // Consume tokens for the truncated content
          const tokens = countTokensInText(truncated);
          yield* budget.consume(tokens);

          return {
            content: truncated,
            filePath: relativePath,
            exists: true,
            wasTruncated: wasTruncated || wasRangeLimited,
            totalLines,
            returnedLines: truncated.split("\n").length,
            ...(wasRangeLimited &&
              lineRange && {
                truncationNote: `Read lines ${lineRange.start}-${lineRange.end} from file (${totalLines} total lines).`,
              }),
          };
        }).pipe(
          Effect.catchTag("IsDirectoryError", (error) =>
            Effect.fail(
              new Error(
                `Path is a directory, not a file: ${error.path}. Use listFiles tool to list directory contents.`,
              ),
            ),
          ),
          Effect.catchAll((error) => {
            // For other errors (file not found, etc.), return exists: false
            if (error instanceof Error && error.message.includes("directory")) {
              return Effect.fail(error);
            }
            // Get relative path for error response
            return Effect.gen(function* () {
              const workspaceRoot = yield* getWorkspaceRoot();
              const fileUri = yield* resolvePathToUri(filePath, workspaceRoot);
              const relativePath = yield* getRelativePath(fileUri);
              return {
                content: "",
                filePath: relativePath,
                exists: false,
              };
            }).pipe(
              // If even this fails, return a basic error response
              Effect.catchAll(() =>
                Effect.succeed({
                  content: "",
                  filePath,
                  exists: false,
                }),
              ),
            );
          }),
        ),
      );
    },
  });
