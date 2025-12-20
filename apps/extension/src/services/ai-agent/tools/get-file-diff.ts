import * as vscode from "vscode";
import * as path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import type { GetFileDiffInput, GetFileDiffOutput } from "../types.js";
import { GitService } from "../../git-service.js";
import { VSCodeService } from "../../vs-code.js";
import { Effect, Runtime, Layer } from "effect";

/**
 * Tool for getting git diff for a specific file
 * Shows what changed in the file compared to the base branch
 */
export const getFileDiffTool = tool({
  description:
    "Get the git diff for a specific file showing what changed compared to the base branch (main/master). This helps understand what functionality was added or modified.",
  inputSchema: z.object({
    filePath: z
      .string()
      .describe(
        "The path to the file to get the diff for. Can be relative to workspace root or absolute.",
      ),
  }),
  execute: async ({
    filePath,
  }: GetFileDiffInput): Promise<GetFileDiffOutput> => {
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

    const absolutePath = fileUri.fsPath;
    const relativePath = vscode.workspace.asRelativePath(fileUri, false);

    // Get diff using GitService with proper dependencies
    const diff = await Runtime.runPromise(Runtime.defaultRuntime)(
      Effect.gen(function* () {
        const gitService = yield* GitService;
        return yield* gitService.getFileDiff(absolutePath);
      }).pipe(
        Effect.provide(Layer.merge(GitService.Default, VSCodeService.Default)),
      ),
    );

    return {
      diff: diff || "",
      filePath: relativePath,
      hasChanges: (diff || "").length > 0,
    };
  },
});
