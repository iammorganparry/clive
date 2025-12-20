import * as vscode from "vscode";
import * as path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import type { ReadFileInput, ReadFileOutput } from "../types.js";
import {
  countTokensInText,
  MAX_FILE_TOKENS,
  calculateTruncationLines,
} from "../token-utils.js";

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
      // Check if path exists and is a file (not a directory)
      const stat = await vscode.workspace.fs.stat(fileUri);
      if (stat.type === vscode.FileType.Directory) {
        const relativePath = vscode.workspace.asRelativePath(fileUri, false);
        throw new Error(
          `Path is a directory, not a file: ${relativePath}. Use listFiles tool to list directory contents.`,
        );
      }

      const content = await vscode.workspace.fs.readFile(fileUri);
      const text = Buffer.from(content).toString("utf-8");
      const relativePath = vscode.workspace.asRelativePath(fileUri, false);

      // Count actual tokens using Anthropic tokenizer
      const tokenCount = countTokensInText(text);
      const lines = text.split("\n");
      const totalLines = lines.length;

      if (tokenCount > MAX_FILE_TOKENS) {
        // Truncate the file - keep beginning and end
        const { keepFromStart, keepFromEnd } = calculateTruncationLines(lines);
        const startLines = lines.slice(0, keepFromStart);
        const endLines = lines.slice(-keepFromEnd);
        const truncatedContent = [
          ...startLines,
          "",
          `// ... [File truncated: ${totalLines - keepFromStart - keepFromEnd} lines omitted] ...`,
          "",
          ...endLines,
        ].join("\n");

        // Count tokens in truncated content
        const truncatedTokenCount = countTokensInText(truncatedContent);

        return {
          content: truncatedContent,
          filePath: relativePath,
          exists: true,
          wasTruncated: true,
          totalLines,
          returnedLines: keepFromStart + keepFromEnd,
          truncationNote: `File was truncated from ${totalLines} lines (${tokenCount} tokens) to ${keepFromStart + keepFromEnd} lines (${truncatedTokenCount} tokens, max ${MAX_FILE_TOKENS}). Showing first ${keepFromStart} and last ${keepFromEnd} lines.`,
        };
      }

      return {
        content: text,
        filePath: relativePath,
        exists: true,
        wasTruncated: false,
        totalLines,
        returnedLines: totalLines,
      };
    } catch (error: unknown) {
      console.error("Error reading file:", error);
      // Re-throw directory errors so the AI knows what went wrong
      if (
        error instanceof Error &&
        (error.message.includes("directory") ||
          (error as { code?: string }).code === "EISDIR" ||
          (error as { code?: string }).code === "FileIsADirectory")
      ) {
        throw error;
      }
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
