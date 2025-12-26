import * as path from "node:path";
import { Effect } from "effect";
import type { ChangedFile } from "./git-service.js";

export interface EligibleFile extends ChangedFile {
  isEligible: boolean;
  reason?: string;
}

/**
 * Service for filtering source files eligible for automated testing across all languages
 */
export class SourceFileFilter extends Effect.Service<SourceFileFilter>()(
  "SourceFileFilter",
  {
    effect: Effect.gen(function* () {
      const sourceExtensions = [
        // Web/Frontend
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".vue",
        ".svelte",
        // Backend
        ".py", // Python
        ".java",
        ".kt", // Java, Kotlin
        ".go", // Go
        ".rs", // Rust
        ".rb", // Ruby
        ".php", // PHP
        ".cs", // C#
        ".cpp",
        ".cc",
        ".c",
        ".h",
        ".hpp", // C/C++
        ".swift", // Swift
      ] as const;
      const excludedDirs = [
        "node_modules",
        "dist",
        "build",
        ".next",
        "out",
        "target",
        "bin",
        "obj",
        "vendor",
        "__pycache__",
        ".git",
        ".vscode",
        ".idea",
      ] as const;
      const testPatterns = [
        /\.test\./,
        /\.spec\./,
        /\.test$/,
        /\.spec$/,
        /_test\./,
        /_spec\./,
      ] as const;

      // Helper function to check eligibility with reason
      const checkEligibilityWithReason = (file: ChangedFile) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[SourceFileFilter] Checking eligibility for: ${file.path}`,
          );
          // Check extension
          const ext = path.extname(file.path);
          if (
            !sourceExtensions.includes(
              ext as (typeof sourceExtensions)[number],
            )
          ) {
            yield* Effect.logDebug(
              `[SourceFileFilter] File ${file.path} not eligible: wrong extension (${ext})`,
            );
            return { isEligible: false, reason: `File extension ${ext} is not supported` };
          }

          // Check if file is in excluded directories
          const pathParts = file.path.split(path.sep);
          for (const excludedDir of excludedDirs) {
            if (pathParts.includes(excludedDir)) {
              yield* Effect.logDebug(
                `[SourceFileFilter] File ${file.path} not eligible: in excluded directory (${excludedDir})`,
              );
              return { isEligible: false, reason: `File is in excluded directory: ${excludedDir}` };
            }
          }

          // Check if it's a test file
          for (const pattern of testPatterns) {
            if (pattern.test(file.path)) {
              yield* Effect.logDebug(
                `[SourceFileFilter] File ${file.path} not eligible: matches test pattern`,
              );
              return { isEligible: false, reason: "File matches test file pattern" };
            }
          }

          // File is eligible if it passes extension, directory, and test file checks
          yield* Effect.logDebug(
            `[SourceFileFilter] File ${file.path} eligibility: eligible`,
          );
          return { isEligible: true, reason: undefined };
        });

      // Helper function to check if a file is eligible (returns boolean for backward compatibility)
      const checkEligibility = (file: ChangedFile) =>
        Effect.gen(function* () {
          const result = yield* checkEligibilityWithReason(file);
          return result.isEligible;
        });

      return {
        /**
         * Check if a file is eligible for testing
         */
        isEligible: checkEligibility,

        /**
         * Filter files to only include those eligible for testing
         */
        filterEligibleFiles: (files: ChangedFile[]) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              `[SourceFileFilter] Filtering ${files.length} file(s) for eligibility`,
            );
            const eligibleFiles = yield* Effect.forEach(
              files,
              (file) =>
                Effect.gen(function* () {
                  const result = yield* checkEligibilityWithReason(file);
                  return {
                    ...file,
                    isEligible: result.isEligible,
                    reason: result.reason,
                  } as EligibleFile;
                }),
              { concurrency: "unbounded" },
            );

            // Return all files with their eligibility status
            const eligibleCount = eligibleFiles.filter((file) => file.isEligible).length;
            yield* Effect.logDebug(
              `[SourceFileFilter] Found ${eligibleCount} eligible file(s) out of ${eligibleFiles.length} total`,
            );
            return eligibleFiles;
          }),
      };
    }),
    // No dependencies - allows test injection via Layer.provide()
  },
) {}

/**
 * Production layer with all dependencies composed.
 * Use this in production code; use SourceFileFilter.Default in tests with mocked deps.
 */
export const SourceFileFilterLive = SourceFileFilter.Default;

