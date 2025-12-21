import * as vscode from "vscode";
import { tool } from "ai";
import { z } from "zod";
import { Effect, Runtime } from "effect";
import type {
  GetCypressConfigInput,
  GetCypressConfigOutput,
} from "../types.js";
import type { TokenBudgetService } from "../token-budget.js";
import { countTokensInText } from "../../../utils/token-utils.js";
import {
  readFileAsStringEffect,
  statFileEffect,
  getWorkspaceRoot,
} from "../../../lib/vscode-effects.js";

/**
 * Try to read a config file at the given URI
 * Returns the content and file type if successful, or null if file doesn't exist
 */
const tryReadConfigFile = (configUri: vscode.Uri, fileType: string) =>
  Effect.gen(function* () {
    // Check if file exists
    yield* statFileEffect(configUri);
    // Read content
    const text = yield* readFileAsStringEffect(configUri);
    const relativePath = vscode.workspace.asRelativePath(configUri, false);
    return {
      content: text,
      fileType,
      relativePath,
    };
  }).pipe(
    // Return null if file doesn't exist or can't be read
    Effect.catchAll(() => Effect.succeed(null)),
  );

/**
 * Factory function to create getCypressConfigTool with token budget awareness
 * Uses MEDIUM priority - up to 25% of remaining budget
 */
export const createGetCypressConfigTool = (budget: TokenBudgetService) =>
  tool({
    description:
      "Get Cypress configuration from cypress.config.ts, cypress.config.js, or cypress.config.mjs. Returns the config object and path.",
    inputSchema: z.object({
      workspaceRoot: z
        .string()
        .optional()
        .describe(
          "Optional workspace root path. Defaults to first workspace folder.",
        ),
    }),
    execute: async ({
      workspaceRoot: workspaceRootPath,
    }: GetCypressConfigInput): Promise<GetCypressConfigOutput> => {
      return Runtime.runPromise(Runtime.defaultRuntime)(
        Effect.gen(function* () {
          // Get workspace root
          const defaultRoot = yield* getWorkspaceRoot();
          const rootUri = workspaceRootPath
            ? vscode.Uri.file(workspaceRootPath)
            : defaultRoot;

          // Try to find Cypress config files in order of preference
          const configFiles: Array<{ name: string; type: string }> = [
            { name: "cypress.config.ts", type: "ts" },
            { name: "cypress.config.js", type: "js" },
            { name: "cypress.config.mjs", type: "mjs" },
          ];

          // Try each config file sequentially until one is found
          for (const { name, type } of configFiles) {
            const configUri = vscode.Uri.joinPath(rootUri, name);
            const result = yield* tryReadConfigFile(configUri, type);

            if (result) {
              const configOutput: GetCypressConfigOutput = {
                config: {
                  content: result.content,
                  fileType: result.fileType,
                },
                configPath: result.relativePath,
                exists: true,
              };

              // Apply budget-aware truncation (MEDIUM priority)
              const configText = JSON.stringify(configOutput, null, 2);
              const { content: truncated, wasTruncated } =
                yield* budget.truncateToFit(configText, "medium");

              // Consume tokens for the truncated content
              const tokens = countTokensInText(truncated);
              yield* budget.consume(tokens);

              if (wasTruncated) {
                try {
                  const parsed = JSON.parse(truncated);
                  return parsed as GetCypressConfigOutput;
                } catch {
                  // If parsing fails, return original but with truncated content
                  return {
                    ...configOutput,
                    config: configOutput.config
                      ? {
                          ...configOutput.config,
                          content: truncated.substring(0, 5000),
                        }
                      : null,
                  };
                }
              }

              return configOutput;
            }
          }

          // No config file found
          return {
            config: null,
            configPath: null,
            exists: false,
          };
        }).pipe(
          Effect.catchAll(() =>
            Effect.succeed({
              config: null,
              configPath: null,
              exists: false,
            }),
          ),
        ),
      );
    },
  });
