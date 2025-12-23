import * as path from "node:path";
import { Uri } from "vscode";
import { Data, Effect } from "effect";
import { VSCodeService } from "./vs-code.js";
import type { ChangedFile } from "./git-service.js";

export interface EligibleFile extends ChangedFile {
  isEligible: boolean;
  reason?: string;
}

class FileReadError extends Data.TaggedError("FileReadError")<{
  message: string;
  filePath: string;
}> {}

/**
 * Service for filtering React component files eligible for E2E testing
 */
export class ReactFileFilter extends Effect.Service<ReactFileFilter>()(
  "ReactFileFilter",
  {
    effect: Effect.gen(function* () {
      const reactExtensions = [".tsx", ".jsx"] as const;
      const excludedDirs = [
        "node_modules",
        "dist",
        "build",
        ".next",
        "out",
      ] as const;
      const testPatterns = [
        /\.test\./,
        /\.spec\./,
        /\.test$/,
        /\.spec$/,
      ] as const;

      // Helper function to check if a file is eligible
      const checkEligibility = (file: ChangedFile) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[ReactFileFilter] Checking eligibility for: ${file.path}`,
          );
          // Check extension
          const ext = path.extname(file.path);
          if (!reactExtensions.includes(ext as ".tsx" | ".jsx")) {
            yield* Effect.logDebug(
              `[ReactFileFilter] File ${file.path} not eligible: wrong extension (${ext})`,
            );
            return false;
          }

          // Check if file is in excluded directories
          const pathParts = file.path.split(path.sep);
          for (const excludedDir of excludedDirs) {
            if (pathParts.includes(excludedDir)) {
              yield* Effect.logDebug(
                `[ReactFileFilter] File ${file.path} not eligible: in excluded directory (${excludedDir})`,
              );
              return false;
            }
          }

          // Check if it's a test file
          for (const pattern of testPatterns) {
            if (pattern.test(file.path)) {
              yield* Effect.logDebug(
                `[ReactFileFilter] File ${file.path} not eligible: matches test pattern`,
              );
              return false;
            }
          }

          // Check if file contains React component patterns
          yield* Effect.logDebug(
            `[ReactFileFilter] Reading file content: ${file.path}`,
          );
          const vscode = yield* VSCodeService;
          const content = yield* Effect.tryPromise({
            try: () => vscode.workspace.fs.readFile(Uri.file(file.path)),
            catch: (error) =>
              new FileReadError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                filePath: file.path,
              }),
          });

          const text = Buffer.from(content).toString("utf-8");

          // Check for React component patterns:
          // - default export of function/const
          // - named export of component (PascalCase)
          // - JSX syntax
          const hasDefaultExport =
            /default\s+export\s+(?:function|const|class)\s+\w+/i.test(text) ||
            /export\s+default\s+(?:function|const|class)\s+\w+/i.test(text);
          const hasJSX =
            /<[A-Z]\w+/.test(text) || /return\s*\(?\s*</.test(text);
          const hasReactImport = /from\s+['"]react['"]/.test(text);

          const isEligible = (hasDefaultExport || hasJSX) && hasReactImport;
          yield* Effect.logDebug(
            `[ReactFileFilter] File ${file.path} eligibility: ${isEligible ? "eligible" : "not eligible"}`,
          );
          return isEligible;
        });

      return {
        /**
         * Check if a file is eligible for E2E testing
         */
        isEligibleForE2E: checkEligibility,

        /**
         * Filter files to only include those eligible for E2E testing
         */
        filterEligibleFiles: (files: ChangedFile[]) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              `[ReactFileFilter] Filtering ${files.length} file(s) for eligibility`,
            );
            const eligibleFiles = yield* Effect.forEach(
              files,
              (file) =>
                Effect.gen(function* () {
                  const isEligible = yield* checkEligibility(file);
                  return {
                    ...file,
                    isEligible,
                  } as EligibleFile;
                }),
              { concurrency: "unbounded" },
            );

            // Return only eligible files
            const filtered = eligibleFiles.filter((file) => file.isEligible);
            yield* Effect.logDebug(
              `[ReactFileFilter] Filtered to ${filtered.length} eligible file(s)`,
            );
            return filtered;
          }),
      };
    }),
    // No dependencies - allows test injection via Layer.provide()
  },
) {}

/**
 * Production layer with all dependencies composed.
 * Use this in production code; use ReactFileFilter.Default in tests with mocked deps.
 */
// ReactFileFilter depends on VSCodeService (context-specific)
// Provide VSCodeService at the composition site
export const ReactFileFilterLive = ReactFileFilter.Default;
