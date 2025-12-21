import * as vscode from "vscode";
import * as path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import type { WriteTestFileInput, WriteTestFileOutput } from "../types.js";
import { normalizeEscapedChars } from "../../../utils/string-utils.js";

/**
 * Tool for writing Cypress test files
 */
export const writeTestFileTool = tool({
  description:
    "Write or update a Cypress test file. Creates directories if needed. Can overwrite existing files.",
  inputSchema: z.object({
    testContent: z
      .string()
      .describe("The complete Cypress test file content to write"),
    targetPath: z
      .string()
      .describe(
        "The target file path. Can be relative to workspace root or absolute.",
      ),
    overwrite: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether to overwrite existing file (default: false)"),
  }),
  execute: async ({
    testContent,
    targetPath,
    overwrite = false,
  }: WriteTestFileInput): Promise<WriteTestFileOutput> => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error("No workspace folder found");
    }

    const workspaceRoot = workspaceFolders[0].uri;

    // Resolve path relative to workspace root if not absolute
    let fileUri: vscode.Uri;
    if (path.isAbsolute(targetPath)) {
      fileUri = vscode.Uri.file(targetPath);
    } else {
      fileUri = vscode.Uri.joinPath(workspaceRoot, targetPath);
    }

    try {
      // Check if file exists
      let fileExists = false;
      try {
        await vscode.workspace.fs.stat(fileUri);
        fileExists = true;
      } catch {
        // File doesn't exist, that's okay
      }

      if (fileExists && !overwrite) {
        const relativePath = vscode.workspace.asRelativePath(fileUri, false);
        return {
          success: false,
          filePath: relativePath,
          message: `File already exists. Set overwrite=true to replace it.`,
        };
      }

      // Ensure parent directory exists
      const parentDir = vscode.Uri.joinPath(fileUri, "..");
      try {
        await vscode.workspace.fs.stat(parentDir);
      } catch {
        // Directory doesn't exist, create it
        await vscode.workspace.fs.createDirectory(parentDir);
      }

      // Normalize escaped characters - convert literal escape sequences to actual characters
      const normalizedContent = normalizeEscapedChars(testContent);

      // Write file
      const content = Buffer.from(normalizedContent, "utf-8");
      await vscode.workspace.fs.writeFile(fileUri, content);

      const relativePath = vscode.workspace.asRelativePath(fileUri, false);

      return {
        success: true,
        filePath: relativePath,
        message: fileExists
          ? `Test file updated: ${relativePath}`
          : `Test file created: ${relativePath}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const relativePath = vscode.workspace.asRelativePath(fileUri, false);
      return {
        success: false,
        filePath: relativePath,
        message: `Failed to write test file: ${errorMessage}`,
      };
    }
  },
});
