import * as vscode from "vscode";
import * as path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import type { ListFilesInput, ListFilesOutput } from "../types.js";

/**
 * Tool for listing files in a directory
 */
export const listFilesTool = tool({
  description:
    "List files and directories in a given directory path. Respects gitignore patterns.",
  inputSchema: z.object({
    directoryPath: z
      .string()
      .describe(
        "The directory path to list. Can be relative to workspace root or absolute.",
      ),
    includePattern: z
      .string()
      .optional()
      .describe("Optional glob pattern to include only matching files"),
    excludePattern: z
      .string()
      .optional()
      .describe("Optional glob pattern to exclude matching files"),
  }),
  execute: async ({
    directoryPath,
    includePattern,
    excludePattern,
  }: ListFilesInput): Promise<ListFilesOutput> => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error("No workspace folder found");
    }

    const workspaceRoot = workspaceFolders[0].uri;

    // Resolve path relative to workspace root if not absolute
    let dirUri: vscode.Uri;
    if (path.isAbsolute(directoryPath)) {
      dirUri = vscode.Uri.file(directoryPath);
    } else {
      dirUri = vscode.Uri.joinPath(workspaceRoot, directoryPath);
    }

    try {
      // Build search pattern
      let searchPattern = includePattern || "**/*";
      if (directoryPath !== "." && directoryPath !== "") {
        const relativeDir = vscode.workspace.asRelativePath(dirUri, false);
        searchPattern = path.join(relativeDir, searchPattern);
      }

      // Build exclude pattern
      const excludePatterns = ["**/node_modules/**"];
      if (excludePattern) {
        excludePatterns.push(excludePattern);
      }

      const files = await vscode.workspace.findFiles(
        searchPattern,
        excludePatterns.join(","),
      );

      const fileList = await Promise.all(
        files.map(async (fileUri) => {
          try {
            const stat = await vscode.workspace.fs.stat(fileUri);
            const relativePath = vscode.workspace.asRelativePath(
              fileUri,
              false,
            );
            return {
              path: fileUri.fsPath,
              relativePath,
              isDirectory: stat.type === vscode.FileType.Directory,
            };
          } catch {
            return null;
          }
        }),
      );

      const validFiles = fileList.filter(
        (file): file is NonNullable<typeof file> => file !== null,
      );

      return {
        files: validFiles,
        directoryPath: vscode.workspace.asRelativePath(dirUri, false),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to list files: ${errorMessage}`);
    }
  },
});
