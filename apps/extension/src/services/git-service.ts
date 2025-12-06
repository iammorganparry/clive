import * as vscode from "vscode";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

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

/**
 * Service for Git operations
 */
export class GitService {
  /**
   * Get the current branch name
   */
  async getCurrentBranch(workspaceRoot: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", {
        cwd: workspaceRoot,
      });
      return stdout.trim() || null;
    } catch (error) {
      console.error("Error getting current branch:", error);
      return null;
    }
  }

  /**
   * Get the default base branch (main or master)
   */
  async getBaseBranch(workspaceRoot: string): Promise<string> {
    try {
      // Try main first - command succeeds if branch exists
      try {
        await execAsync("git show-ref --verify --quiet refs/heads/main", {
          cwd: workspaceRoot,
        });
        return "main";
      } catch {
        // main doesn't exist, try master
      }

      // Try master - command succeeds if branch exists
      try {
        await execAsync("git show-ref --verify --quiet refs/heads/master", {
          cwd: workspaceRoot,
        });
        return "master";
      } catch {
        // master doesn't exist either
      }

      // Default to main
      return "main";
    } catch {
      return "main";
    }
  }

  /**
   * Get changed files between current branch and base branch
   */
  async getChangedFiles(
    workspaceRoot: string,
    baseBranch: string = "main",
  ): Promise<ChangedFile[]> {
    try {
      // Get diff between current branch and base branch
      const { stdout } = await execAsync(
        `git diff --name-status ${baseBranch}...HEAD`,
        { cwd: workspaceRoot },
      );

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
            vscode.Uri.file(fullPath),
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
    } catch (error) {
      console.error("Error getting changed files:", error);
      return [];
    }
  }

  /**
   * Get branch changes (branch name and changed files)
   */
  async getBranchChanges(): Promise<BranchChanges | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return null;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    const branchName = await this.getCurrentBranch(workspaceRoot);
    if (!branchName) {
      return null;
    }

    const baseBranch = await this.getBaseBranch(workspaceRoot);
    const files = await this.getChangedFiles(workspaceRoot, baseBranch);

    return {
      branchName,
      baseBranch,
      files,
      workspaceRoot,
    };
  }
}
