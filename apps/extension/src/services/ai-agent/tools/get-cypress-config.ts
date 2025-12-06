import * as vscode from "vscode";
import { tool } from "ai";
import { z } from "zod";
import type {
  GetCypressConfigInput,
  GetCypressConfigOutput,
} from "../types.js";

/**
 * Tool for reading Cypress configuration file
 */
export const getCypressConfigTool = tool({
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
    workspaceRoot,
  }: GetCypressConfigInput): Promise<GetCypressConfigOutput> => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error("No workspace folder found");
    }

    const rootUri = workspaceRoot
      ? vscode.Uri.file(workspaceRoot)
      : workspaceFolders[0].uri;

    // Try to find Cypress config files
    const configFiles = [
      "cypress.config.ts",
      "cypress.config.js",
      "cypress.config.mjs",
    ];

    for (const configFile of configFiles) {
      try {
        const configUri = vscode.Uri.joinPath(rootUri, configFile);
        await vscode.workspace.fs.stat(configUri);

        // File exists, try to read it
        const content = await vscode.workspace.fs.readFile(configUri);
        const text = Buffer.from(content).toString("utf-8");

        // Try to parse as JSON or extract config object
        // For JS/TS files, we'll need to evaluate or parse
        // For now, return the raw content and let the agent parse it
        try {
          // If it's a JSON-like structure, try to extract
          // Otherwise return the content as-is
          const relativePath = vscode.workspace.asRelativePath(
            configUri,
            false,
          );

          return {
            config: {
              content: text,
              fileType: configFile.split(".").pop() || "unknown",
            },
            configPath: relativePath,
            exists: true,
          };
        } catch {
          // If parsing fails, return raw content
          const relativePath = vscode.workspace.asRelativePath(
            configUri,
            false,
          );
          return {
            config: {
              content: text,
              fileType: configFile.split(".").pop() || "unknown",
            },
            configPath: relativePath,
            exists: true,
          };
        }
      } catch {
        // File doesn't exist, try next
      }
    }

    // No config file found
    return {
      config: null,
      configPath: null,
      exists: false,
    };
  },
});
