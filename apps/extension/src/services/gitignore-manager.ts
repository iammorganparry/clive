/**
 * Service for managing .gitignore file updates
 * Ensures .clive/knowledge/ and .clive/.env.test are ignored
 */

import { Data, Effect } from "effect";
import type * as vscode from "vscode";
import { VSCodeService } from "./vs-code.js";
import { extractErrorMessage } from "../utils/error-utils.js";

/**
 * Error types for gitignore operations
 */
export class GitignoreError extends Data.TaggedError("GitignoreError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * Patterns to add to .gitignore
 */
const CLIVE_PATTERNS = [".clive/knowledge/", ".clive/.env.test"] as const;

/**
 * Comment section header for Clive patterns
 */
const CLIVE_SECTION_HEADER = "# Clive AI Assistant";

/**
 * Service for managing .gitignore file updates
 */
export class GitignoreManager extends Effect.Service<GitignoreManager>()(
  "GitignoreManager",
  {
    effect: Effect.gen(function* () {
      const vsCodeService = yield* VSCodeService;

      /**
       * Check if a pattern exists in gitignore content
       */
      const patternExists = (content: string, pattern: string): boolean => {
        const lines = content.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          // Check for exact match or match with leading/trailing whitespace
          if (trimmed === pattern || trimmed.endsWith(pattern)) {
            return true;
          }
        }
        return false;
      };

      /**
       * Read .gitignore file, returning empty string if it doesn't exist
       */
      const readGitignore = (workspaceRoot: vscode.Uri) =>
        Effect.gen(function* () {
          const gitignoreUri = vsCodeService.joinPath(
            workspaceRoot,
            ".gitignore",
          );

          // Check if file exists
          const exists = yield* vsCodeService
            .isFile(gitignoreUri)
            .pipe(Effect.catchAll(() => Effect.succeed(false)));

          if (!exists) {
            return "";
          }

          return yield* vsCodeService
            .readFileAsString(gitignoreUri)
            .pipe(Effect.catchAll(() => Effect.succeed("")));
        });

      /**
       * Write .gitignore file
       */
      const writeGitignore = (workspaceRoot: vscode.Uri, content: string) =>
        Effect.gen(function* () {
          const gitignoreUri = vsCodeService.joinPath(
            workspaceRoot,
            ".gitignore",
          );
          yield* vsCodeService
            .writeFile(gitignoreUri, Buffer.from(content, "utf-8"))
            .pipe(
              Effect.mapError(
                (error) =>
                  new GitignoreError({
                    message: `Failed to write .gitignore: ${extractErrorMessage(error)}`,
                    cause: error,
                  }),
              ),
            );
        });

      /**
       * Ensure Clive patterns are in .gitignore
       * Optionally checks a flag first to avoid repeated file reads
       * Returns true if patterns were added, false if they already existed
       */
      const ensureCliveIgnored = (options?: {
        checkFlag?: () => Effect.Effect<boolean>;
        setFlag?: () => Effect.Effect<void>;
      }) =>
        Effect.gen(function* () {
          // Check flag first if provided (optimization to avoid file reads)
          if (options?.checkFlag) {
            const flagSet = yield* options.checkFlag();
            if (flagSet) {
              return false; // Already updated, skip
            }
          }

          const workspaceRoot = yield* vsCodeService.getWorkspaceRoot();
          const existingContent = yield* readGitignore(workspaceRoot);

          // Check if all patterns already exist
          const allPatternsExist = CLIVE_PATTERNS.every((pattern) =>
            patternExists(existingContent, pattern),
          );

          if (allPatternsExist) {
            // Patterns already exist, set flag if provided
            if (options?.setFlag) {
              yield* options.setFlag();
            }
            return false; // Patterns already exist, nothing to do
          }

          // Build new content
          let newContent = existingContent;

          // Add newline if content doesn't end with one
          if (newContent && !newContent.endsWith("\n")) {
            newContent += "\n";
          }

          // Add Clive section if it doesn't exist
          if (!newContent.includes(CLIVE_SECTION_HEADER)) {
            newContent += `\n${CLIVE_SECTION_HEADER}\n`;
          }

          // Add missing patterns
          for (const pattern of CLIVE_PATTERNS) {
            if (!patternExists(newContent, pattern)) {
              newContent += `${pattern}\n`;
            }
          }

          // Write updated content
          yield* writeGitignore(workspaceRoot, newContent);

          // Set flag if provided
          if (options?.setFlag) {
            yield* options.setFlag();
          }

          return true; // Patterns were added
        });

      return {
        ensureCliveIgnored,
      };
    }),
  },
) {}

/**
 * Production layer - dependencies provided at composition site
 * Use Layer.merge(GitignoreManager.Default, VSCodeService.Default) when providing
 */
export const GitignoreManagerLive = GitignoreManager.Default;
