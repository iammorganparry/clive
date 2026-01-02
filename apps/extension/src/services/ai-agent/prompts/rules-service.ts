/**
 * RulesService - loads user-defined rules from .clive/rules/*.md
 * Effect Service following the codebase pattern
 */

import { Effect } from "effect";
import * as vscode from "vscode";
import * as path from "node:path";
import { VSCodeService } from "../../vs-code.js";

/**
 * Service for loading user-defined rules from the workspace
 */
export class RulesService extends Effect.Service<RulesService>()(
  "RulesService",
  {
    effect: Effect.gen(function* () {
      /**
       * Load all user rules from .clive/rules/*.md files
       * Returns combined markdown content from all rule files
       * Gracefully handles missing directory or files
       */
      const loadUserRules = () =>
        Effect.gen(function* () {
          const vsCodeService = yield* VSCodeService;
          const workspaceRoot = yield* vsCodeService.getWorkspaceRoot();
          const rulesDir = vsCodeService.joinPath(
            workspaceRoot,
            ".clive",
            "rules",
          );

          // Find all .md files in rules directory
          const pattern = new vscode.RelativePattern(rulesDir, "*.md");
          const files = yield* vsCodeService.findFiles(pattern).pipe(
            // If directory doesn't exist or search fails, return empty array
            Effect.catchAll(() => Effect.succeed([])),
          );

          if (files.length === 0) {
            return "";
          }

          // Read and combine all rule files
          const contents = yield* Effect.all(
            files.map((uri) =>
              vsCodeService.readFileAsString(uri).pipe(
                Effect.map((content) => ({
                  name: path.basename(uri.fsPath, ".md"),
                  content,
                })),
                // Skip files that fail to read
                Effect.catchAll(() => Effect.succeed(null)),
              ),
            ),
          );

          // Filter out failed reads and format as sections
          const validRules = contents.filter(
            (c): c is NonNullable<typeof c> => c !== null,
          );

          if (validRules.length === 0) {
            return "";
          }

          return validRules
            .map((r) => `## ${r.name}\n\n${r.content}`)
            .join("\n\n");
        });

      return { loadUserRules };
    }),
  },
) {}

/**
 * Default live layer for RulesService
 */
export const RulesServiceLive = RulesService.Default;
