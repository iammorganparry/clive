import { tool } from "ai";
import { z } from "zod";
import { Effect, Runtime, Layer } from "effect";
import type { GetFileDiffInput, GetFileDiffOutput } from "../types.js";
import { GitService } from "../../git-service.js";
import { VSCodeService } from "../../vs-code.js";
import type { TokenBudgetService } from "../token-budget.js";
import { countTokensInText } from "../../../utils/token-utils.js";
import {
  getWorkspaceRoot,
  resolvePathToUri,
  getRelativePath,
} from "../../../lib/vscode-effects.js";

/**
 * Factory function to create getFileDiffTool with token budget awareness
 * Diff is HIGH priority - uses up to 50% of remaining budget
 */
export const createGetFileDiffTool = (budget: TokenBudgetService) =>
  tool({
    description:
      "Get the git diff for a specific file showing what changed compared to the base branch (main/master). This helps understand what functionality was added or modified. ALWAYS use this tool first to understand what changed.",
    inputSchema: z.object({
      filePath: z
        .string()
        .describe(
          "The path to the file to get the diff for. Can be relative to workspace root or absolute.",
        ),
    }),
    execute: async ({
      filePath,
    }: GetFileDiffInput): Promise<GetFileDiffOutput> => {
      return Runtime.runPromise(Runtime.defaultRuntime)(
        Effect.gen(function* () {
          const workspaceRoot = yield* getWorkspaceRoot();
          const fileUri = yield* resolvePathToUri(filePath, workspaceRoot);
          const relativePath = yield* getRelativePath(fileUri);
          const absolutePath = fileUri.fsPath;

          // Get diff using GitService
          const gitService = yield* GitService;
          const rawDiff = yield* gitService.getFileDiff(absolutePath);
          const diffContent = rawDiff || "";

          // Diff is HIGH priority - use up to 50% of remaining budget
          const { content: truncated, wasTruncated } =
            yield* budget.truncateToFit(diffContent, "high");

          // Consume tokens for the truncated content
          const tokens = countTokensInText(truncated);
          yield* budget.consume(tokens);

          return {
            diff: truncated,
            filePath: relativePath,
            hasChanges: diffContent.length > 0,
            wasTruncated,
          };
        }).pipe(
          Effect.provide(
            Layer.merge(GitService.Default, VSCodeService.Default),
          ),
          Effect.catchAll((error) =>
            Effect.succeed({
              diff: "",
              filePath,
              hasChanges: false,
              wasTruncated: false,
              error:
                error instanceof Error ? error.message : "Failed to get diff",
            }),
          ),
        ),
      );
    },
  });
