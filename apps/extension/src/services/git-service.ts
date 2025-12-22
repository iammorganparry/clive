import * as path from "node:path";
import { Uri } from "vscode";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Data, Effect, Layer } from "effect";
import { VSCodeService } from "./vs-code.js";

const execAsync = promisify(exec);

export interface ChangedFile {
  path: string;
  relativePath: string;
  status: "M" | "A" | "D" | "R"; // Modified, Added, Deleted, Renamed
}

export interface BranchChanges {
  branchName: string;
  baseBranch: string;
  files: ChangedFile[];
  workspaceRoot: string;
}

class GitCommandError extends Data.TaggedError("GitCommandError")<{
  message: string;
  command: string;
  workspaceRoot: string;
}> {}

/**
 * Service for Git operations
 */
export class GitService extends Effect.Service<GitService>()("GitService", {
  effect: Effect.gen(function* () {
    /**
     * Execute a git command and return stdout
     */
    const executeGitCommand = (
      command: string,
      workspaceRoot: string,
    ): Effect.Effect<string, GitCommandError> =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[GitService] Executing git command: ${command}`,
        );
        const result = yield* Effect.tryPromise({
          try: () => execAsync(command, { cwd: workspaceRoot }),
          catch: (error) =>
            new GitCommandError({
              message: error instanceof Error ? error.message : "Unknown error",
              command,
              workspaceRoot,
            }),
        });
        yield* Effect.logDebug(
          `[GitService] Git command completed: ${command.substring(0, 50)}...`,
        );
        return result.stdout.trim();
      });

    /**
     * Helper to get current branch
     */
    const getCurrentBranchHelper = (workspaceRoot: string) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[GitService] Getting current branch for workspace: ${workspaceRoot}`,
        );
        const result = yield* executeGitCommand(
          "git rev-parse --abbrev-ref HEAD",
          workspaceRoot,
        ).pipe(Effect.catchAll(() => Effect.succeed("")));

        const branch = result || null;
        yield* Effect.logDebug(
          `[GitService] Current branch: ${branch || "none"}`,
        );
        return branch;
      });

    /**
     * Helper to get base branch
     */
    const getBaseBranchHelper = (workspaceRoot: string) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[GitService] Determining base branch for workspace: ${workspaceRoot}`,
        );
        // Try main first - command succeeds if branch exists
        const mainExists = yield* executeGitCommand(
          "git show-ref --verify --quiet refs/heads/main",
          workspaceRoot,
        ).pipe(
          Effect.map(() => true),
          Effect.catchAll(() => Effect.succeed(false)),
        );

        if (mainExists) {
          yield* Effect.logDebug("[GitService] Base branch: main");
          return "main";
        }

        // Try master - command succeeds if branch exists
        const masterExists = yield* executeGitCommand(
          "git show-ref --verify --quiet refs/heads/master",
          workspaceRoot,
        ).pipe(
          Effect.map(() => true),
          Effect.catchAll(() => Effect.succeed(false)),
        );

        if (masterExists) {
          yield* Effect.logDebug("[GitService] Base branch: master");
          return "master";
        }

        // Default to main
        yield* Effect.logDebug(
          "[GitService] No main/master branch found, defaulting to main",
        );
        return "main";
      });

    /**
     * Helper to get changed files
     */
    const getChangedFilesHelper = (workspaceRoot: string, baseBranch: string) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[GitService] Getting changed files: ${baseBranch}...HEAD in ${workspaceRoot}`,
        );
        const vscode = yield* VSCodeService;

        const stdout = yield* executeGitCommand(
          `git diff --name-status ${baseBranch}...HEAD`,
          workspaceRoot,
        ).pipe(Effect.catchAll(() => Effect.succeed("")));

        const files: ChangedFile[] = [];
        const lines = stdout
          .trim()
          .split("\n")
          .filter((line) => line.trim());

        for (const line of lines) {
          const match = line.match(/^([MADRC])\s+(.+)$/);
          if (match) {
            const [, statusChar, filePath] = match;
            const fullPath = path.join(workspaceRoot, filePath);
            const relativePath = vscode.workspace.asRelativePath(
              Uri.file(fullPath),
              false,
            );

            // Map git status to our status
            let status: "M" | "A" | "D" | "R";
            if (statusChar === "M") {
              status = "M";
            } else if (statusChar === "A") {
              status = "A";
            } else if (statusChar === "D") {
              status = "D";
            } else if (statusChar === "R" || statusChar === "C") {
              status = "R";
            } else {
              status = "M"; // Default to modified
            }

            files.push({
              path: fullPath,
              relativePath,
              status,
            });
          }
        }

        yield* Effect.logDebug(
          `[GitService] Found ${files.length} changed file(s)`,
        );
        return files;
      });

    /**
     * Helper to get git diff for a specific file
     */
    const getFileDiffHelper = (
      workspaceRoot: string,
      filePath: string,
      baseBranch: string,
    ) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[GitService] Getting diff for file: ${filePath} (${baseBranch}...HEAD)`,
        );

        // Get relative path for git command
        const vscode = yield* VSCodeService;
        const relativePath = vscode.workspace.asRelativePath(
          Uri.file(filePath),
          false,
        );

        // Get diff for the specific file
        const diff = yield* executeGitCommand(
          `git diff ${baseBranch}...HEAD -- "${relativePath}"`,
          workspaceRoot,
        ).pipe(Effect.catchAll(() => Effect.succeed("")));

        yield* Effect.logDebug(
          `[GitService] Got diff for ${relativePath} (${diff.length} chars)`,
        );
        return diff;
      });

    return {
      /**
       * Get the current branch name
       */
      getCurrentBranch: getCurrentBranchHelper,

      /**
       * Get the default base branch (main or master)
       */
      getBaseBranch: getBaseBranchHelper,

      /**
       * Get changed files between current branch and base branch
       */
      getChangedFiles: (workspaceRoot: string, baseBranch: string = "main") =>
        getChangedFilesHelper(workspaceRoot, baseBranch),

      /**
       * Get branch changes (branch name and changed files)
       */
      getBranchChanges: () =>
        Effect.gen(function* () {
          yield* Effect.logDebug("[GitService] Getting branch changes");
          const vscode = yield* VSCodeService;
          const workspaceFolders = vscode.workspace.workspaceFolders;

          if (!workspaceFolders || workspaceFolders.length === 0) {
            yield* Effect.logDebug("[GitService] No workspace folders found");
            return null;
          }

          const workspaceRoot = workspaceFolders[0].uri.fsPath;

          const branchName = yield* getCurrentBranchHelper(workspaceRoot);
          if (!branchName) {
            yield* Effect.logDebug("[GitService] No current branch found");
            return null;
          }

          const baseBranch = yield* getBaseBranchHelper(workspaceRoot);
          const files = yield* getChangedFilesHelper(workspaceRoot, baseBranch);

          yield* Effect.logDebug(
            `[GitService] Branch changes: ${branchName} vs ${baseBranch}, ${files.length} file(s)`,
          );
          return {
            branchName,
            baseBranch,
            files,
            workspaceRoot,
          };
        }),

      /**
       * Get git diff for a specific file compared to base branch
       */
      getFileDiff: (filePath: string) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(`[GitService] Getting file diff: ${filePath}`);
          const vscode = yield* VSCodeService;
          const workspaceFolders = vscode.workspace.workspaceFolders;

          if (!workspaceFolders || workspaceFolders.length === 0) {
            yield* Effect.logDebug("[GitService] No workspace folders found");
            return "";
          }

          const workspaceRoot = workspaceFolders[0].uri.fsPath;
          const baseBranch = yield* getBaseBranchHelper(workspaceRoot);
          const diff = yield* getFileDiffHelper(
            workspaceRoot,
            filePath,
            baseBranch,
          );

          return diff;
        }),
    };
  }),
  // No dependencies - allows test injection via Layer.provide()
}) {}

/**
 * Production layer with all dependencies composed.
 * Use this in production code; use GitService.Default in tests with mocked deps.
 */
// GitService depends on VSCodeService (context-specific)
// Provide VSCodeService at the composition site
export const GitServiceLive = GitService.Default;
