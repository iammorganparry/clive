import * as path from "node:path";
import { Uri } from "vscode";
import { Data, Effect, Layer, Runtime } from "effect";
import { VSCodeService } from "./vs-code.js";

class FileReadError extends Data.TaggedError("FileReadError")<{
  message: string;
  filePath: string;
}> {}

class FileSearchError extends Data.TaggedError("FileSearchError")<{
  message: string;
}> {}

/**
 * Service for reading and parsing gitignore files
 */
export class GitignoreReader extends Effect.Service<GitignoreReader>()(
  "GitignoreReader",
  {
    effect: Effect.gen(function* () {
      /**
       * Read and parse a gitignore file
       */
      const readGitignoreFile = (gitignorePath: string, workspaceRoot: Uri) =>
        Effect.gen(function* () {
          const vscode = yield* VSCodeService;
          const fullPath = Uri.joinPath(workspaceRoot, gitignorePath);
          const content = yield* Effect.tryPromise({
            try: () => vscode.workspace.fs.readFile(fullPath),
            catch: (error) =>
              new FileReadError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                filePath: gitignorePath,
              }),
          });

          const text = Buffer.from(content).toString("utf-8");

          // Parse gitignore patterns
          const lines = text.split("\n");
          const patterns: string[] = [];

          for (const line of lines) {
            // Remove comments and empty lines
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) {
              continue;
            }

            // Remove leading ! (negation patterns - we'll handle these separately if needed)
            // For now, we'll include all ignore patterns
            if (trimmed.startsWith("!")) {
              continue; // Skip negation patterns for now
            }

            patterns.push(trimmed);
          }

          return patterns;
        });

      /**
       * Convert gitignore patterns to Cypress excludeSpecPattern glob patterns
       * Cypress uses glob patterns, so we need to convert gitignore patterns appropriately
       */
      const convertToCypressPatterns = (
        gitignorePatterns: string[],
        gitignoreDir: string,
      ): string[] => {
        const cypressPatterns: string[] = [];

        for (const pattern of gitignorePatterns) {
          // Skip empty patterns
          if (!pattern) {
            continue;
          }

          // Handle directory patterns
          // If pattern ends with /, it's a directory
          // If pattern doesn't have a /, it could be a file or directory
          let cypressPattern = pattern;

          // Remove leading slash (gitignore patterns are relative to the gitignore file location)
          if (cypressPattern.startsWith("/")) {
            cypressPattern = cypressPattern.slice(1);
          }

          // If pattern ends with /, add ** to match all files in directory
          if (cypressPattern.endsWith("/")) {
            cypressPattern = `${cypressPattern}**`;
          } else if (!cypressPattern.includes("*")) {
            // If it's a simple pattern without wildcards, check if it's likely a directory
            // Common build directories that should be ignored
            const commonDirs = [
              ".next",
              "dist",
              "build",
              "out",
              ".cache",
              "coverage",
              ".turbo",
              ".vercel",
            ];
            if (commonDirs.includes(cypressPattern)) {
              cypressPattern = `${cypressPattern}/**`;
            }
          }

          // Prepend the gitignore directory path if it's not at root
          if (gitignoreDir && gitignoreDir !== ".") {
            const gitignoreParent = path.dirname(gitignoreDir);
            if (gitignoreParent !== ".") {
              cypressPattern = path.join(gitignoreParent, cypressPattern);
            }
          }

          // Normalize path separators
          cypressPattern = cypressPattern.replace(/\\/g, "/");

          cypressPatterns.push(cypressPattern);
        }

        return cypressPatterns;
      };

      // Helper function to find gitignore files
      const findGitignoreFilesHelper = (_workspaceRoot: Uri) =>
        Effect.gen(function* () {
          const vscode = yield* VSCodeService;
          const gitignoreFiles = yield* Effect.tryPromise({
            try: () =>
              vscode.workspace.findFiles("**/.gitignore", "**/node_modules/**"),
            catch: (error) =>
              new FileSearchError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
              }),
          });

          return gitignoreFiles.map((uri) =>
            vscode.workspace.asRelativePath(uri, false),
          );
        });

      return {
        /**
         * Find all .gitignore files in the workspace
         * Returns paths relative to workspace root
         */
        findGitignoreFiles: findGitignoreFilesHelper,

        /**
         * Get all gitignore patterns from workspace and convert to Cypress excludeSpecPattern patterns
         */
        getGitignorePatternsForCypress: (workspaceRoot: Uri) =>
          Effect.gen(function* () {
            const gitignoreFiles =
              yield* findGitignoreFilesHelper(workspaceRoot);

            if (gitignoreFiles.length === 0) {
              return [];
            }

            const allPatterns: string[] = [];

            // Process each gitignore file
            const results = yield* Effect.forEach(
              gitignoreFiles,
              (gitignoreFile) =>
                Effect.gen(function* () {
                  const patterns = yield* readGitignoreFile(
                    gitignoreFile,
                    workspaceRoot,
                  );
                  return convertToCypressPatterns(patterns, gitignoreFile);
                }).pipe(Effect.catchAll(() => Effect.succeed([]))),
              { concurrency: "unbounded" },
            );

            // Flatten results
            for (const cypressPatterns of results) {
              allPatterns.push(...cypressPatterns);
            }

            // Remove duplicates
            return Array.from(new Set(allPatterns));
          }),
      };
    }),
    // No dependencies - allows test injection via Layer.provide()
  },
) {}

/**
 * Production layer with all dependencies composed.
 * Use this in production code; use GitignoreReader.Default in tests with mocked deps.
 */
export const GitignoreReaderLive = GitignoreReader.Default.pipe(
  Layer.provide(VSCodeService.Default),
);

// Export convenience functions for backward compatibility
export async function findGitignoreFiles(
  workspaceRoot: Uri,
): Promise<string[]> {
  return Runtime.runPromise(Runtime.defaultRuntime)(
    Effect.gen(function* () {
      const service = yield* GitignoreReader;
      return yield* service.findGitignoreFiles(workspaceRoot);
    }).pipe(
      Effect.provide(
        Layer.merge(GitignoreReader.Default, VSCodeService.Default),
      ),
    ),
  );
}

export async function getGitignorePatternsForCypress(
  workspaceRoot: Uri,
): Promise<string[]> {
  return Runtime.runPromise(Runtime.defaultRuntime)(
    Effect.gen(function* () {
      const service = yield* GitignoreReader;
      return yield* service.getGitignorePatternsForCypress(workspaceRoot);
    }).pipe(
      Effect.provide(
        Layer.merge(GitignoreReader.Default, VSCodeService.Default),
      ),
    ),
  );
}
