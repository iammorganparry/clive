import * as vscode from "vscode";
import * as path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import type { ReadFileInput, ReadFileOutput } from "../types.js";

/**
 * Tool for reading file contents from the workspace
 */
export const readFileTool = tool({
  description:
    "Read the contents of a file from the workspace. Use relative paths from the workspace root or absolute paths.",
  inputSchema: z.object({
    filePath: z
      .string()
      .describe(
        "The path to the file to read. Can be relative to workspace root or absolute.",
      ),
  }),
  execute: async ({ filePath }: ReadFileInput): Promise<ReadFileOutput> => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error("No workspace folder found");
    }

    const workspaceRoot = workspaceFolders[0].uri;

    // Resolve path relative to workspace root if not absolute
    let fileUri: vscode.Uri;
    if (path.isAbsolute(filePath)) {
      fileUri = vscode.Uri.file(filePath);
    } else {
      fileUri = vscode.Uri.joinPath(workspaceRoot, filePath);
    }

    try {
      const content = await vscode.workspace.fs.readFile(fileUri);
      const text = Buffer.from(content).toString("utf-8");
      const relativePath = vscode.workspace.asRelativePath(fileUri, false);

      return {
        content: text,
        filePath: relativePath,
        exists: true,
      };
    } catch (error: unknown) {
      console.error("Error reading file:", error);
      // File doesn't exist or can't be read
      const relativePath = vscode.workspace.asRelativePath(fileUri, false);
      return {
        content: "",
        filePath: relativePath,
        exists: false,
      };
    }
  },
});
