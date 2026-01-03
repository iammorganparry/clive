import * as path from "node:path";
import { Uri } from "vscode";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Data, Effect } from "effect";
import { VSCodeService } from "./vs-code.js";
import { SettingsService } from "./settings-service.js";

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

        // Check user-configured base branch first (optional dependency)
        const settingsServiceOption = yield* Effect.serviceOption(SettingsService);
        const userConfigured =
          settingsServiceOption._tag === "Some"
            ? yield* settingsServiceOption.value.getBaseBranch()
            : null;
        
        if (userConfigured) {
          yield* Effect.logDebug(
            `[GitService] Using user-configured base branch: ${userConfigured}`,
          );
          return userConfigured;
        }

        // Fall back to auto-detection
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
     * Helper to parse git diff output into ChangedFile array
     */
    const parseGitDiffOutput = (
      stdout: string,
      workspaceRoot: string,
      vscodeWorkspace: typeof import("vscode").workspace,
    ): ChangedFile[] => {
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
          const relativePath = vscodeWorkspace.asRelativePath(
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
      return files;
    };

    /**
     * Helper to get changed files (committed branch changes + uncommitted changes)
     */
    const getChangedFilesHelper = (workspaceRoot: string, baseBranch: string) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[GitService] Getting changed files: ${baseBranch}...HEAD in ${workspaceRoot}`,
        );
        const vscode = yield* VSCodeService;

        // Get committed changes between branches
        const committedStdout = yield* executeGitCommand(
          `git diff --name-status ${baseBranch}...HEAD`,
          workspaceRoot,
        ).pipe(Effect.catchAll(() => Effect.succeed("")));

        // Get uncommitted changes (unstaged)
        const unstagedStdout = yield* executeGitCommand(
          "git diff --name-status",
          workspaceRoot,
        ).pipe(Effect.catchAll(() => Effect.succeed("")));

        // Get staged changes
        const stagedStdout = yield* executeGitCommand(
          "git diff --name-status --cached",
          workspaceRoot,
        ).pipe(Effect.catchAll(() => Effect.succeed("")));

        // Parse all outputs
        const committedFiles = parseGitDiffOutput(committedStdout, workspaceRoot, vscode.workspace);
        const unstagedFiles = parseGitDiffOutput(unstagedStdout, workspaceRoot, vscode.workspace);
        const stagedFiles = parseGitDiffOutput(stagedStdout, workspaceRoot, vscode.workspace);

        // Merge and deduplicate (uncommitted changes take precedence)
        const fileMap = new Map<string, ChangedFile>();
        
        // Add committed files first
        for (const file of committedFiles) {
          fileMap.set(file.path, file);
        }
        
        // Add staged files (overwrite if exists)
        for (const file of stagedFiles) {
          fileMap.set(file.path, file);
        }
        
        // Add unstaged files (overwrite if exists)
        for (const file of unstagedFiles) {
          fileMap.set(file.path, file);
        }

        const files = Array.from(fileMap.values());

        yield* Effect.logDebug(
          `[GitService] Found ${files.length} changed file(s) (${committedFiles.length} committed, ${stagedFiles.length} staged, ${unstagedFiles.length} unstaged)`,
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

    /**
     * Helper to get all tracked files (respects .gitignore)
     */
    const getTrackedFilesHelper = (workspaceRoot: string) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[GitService] Getting tracked files for workspace: ${workspaceRoot}`,
        );
        const stdout = yield* executeGitCommand(
          "git ls-files",
          workspaceRoot,
        ).pipe(Effect.catchAll(() => Effect.succeed("")));

        const files = stdout
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => line.trim());

        yield* Effect.logDebug(
          `[GitService] Found ${files.length} tracked file(s)`,
        );
        return files;
      });

    /**
     * Helper to get only uncommitted changes (staged + unstaged, no committed branch changes)
     */
    const getUncommittedFilesHelper = (workspaceRoot: string) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[GitService] Getting uncommitted changes in ${workspaceRoot}`,
        );
        const vscode = yield* VSCodeService;

        // Get uncommitted changes (unstaged)
        const unstagedStdout = yield* executeGitCommand(
          "git diff --name-status",
          workspaceRoot,
        ).pipe(Effect.catchAll(() => Effect.succeed("")));

        // Get staged changes
        const stagedStdout = yield* executeGitCommand(
          "git diff --name-status --cached",
          workspaceRoot,
        ).pipe(Effect.catchAll(() => Effect.succeed("")));

        // Parse outputs
        const unstagedFiles = parseGitDiffOutput(unstagedStdout, workspaceRoot, vscode.workspace);
        const stagedFiles = parseGitDiffOutput(stagedStdout, workspaceRoot, vscode.workspace);

        // Merge and deduplicate (unstaged changes take precedence)
        const fileMap = new Map<string, ChangedFile>();
        
        // Add staged files first
        for (const file of stagedFiles) {
          fileMap.set(file.path, file);
        }
        
        // Add unstaged files (overwrite if exists)
        for (const file of unstagedFiles) {
          fileMap.set(file.path, file);
        }

        const files = Array.from(fileMap.values());

        yield* Effect.logDebug(
          `[GitService] Found ${files.length} uncommitted file(s) (${stagedFiles.length} staged, ${unstagedFiles.length} unstaged)`,
        );
        return files;
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
       * Get uncommitted changes (staged + unstaged files only)
       */
      getUncommittedChanges: () =>
        Effect.gen(function* () {
          yield* Effect.logDebug("[GitService] Getting uncommitted changes");
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
          const files = yield* getUncommittedFilesHelper(workspaceRoot);

          yield* Effect.logDebug(
            `[GitService] Uncommitted changes: ${files.length} file(s)`,
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

      /**
       * Get current HEAD commit hash
       * Returns null if no workspace folder is open
       */
      getCurrentCommitHash: () =>
        Effect.gen(function* () {
          yield* Effect.logDebug("[GitService] Getting current HEAD commit hash");
          const vscode = yield* VSCodeService;
          const workspaceFolders = vscode.workspace.workspaceFolders;

          if (!workspaceFolders || workspaceFolders.length === 0) {
            yield* Effect.logDebug("[GitService] No workspace folders found");
            return null;
          }

          const workspaceRoot = workspaceFolders[0].uri.fsPath;
          const commitHash = yield* executeGitCommand(
            "git rev-parse HEAD",
            workspaceRoot,
          ).pipe(Effect.catchAll(() => Effect.succeed(null)));

          if (commitHash) {
            yield* Effect.logDebug(
              `[GitService] Current commit hash: ${commitHash.substring(0, 7)}...`,
            );
          }
          return commitHash;
        }),

      /**
       * Get all tracked files (respects .gitignore)
       * Returns empty array if not a git repo or on error
       */
      getTrackedFiles: (workspaceRoot: string) =>
        getTrackedFilesHelper(workspaceRoot),
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
