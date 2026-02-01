/**
 * Worktree Manager
 *
 * Manages per-session git worktrees for isolated execution.
 * Each session gets its own worktree branched from the default branch.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export class WorktreeManager {
  constructor(
    private repoPath: string,
    private worktreeBaseDir: string,
  ) {}

  /** Create a worktree for a session, returns the worktree path */
  create(sessionId: string): string {
    const safeName = sessionId.replace(/[^a-zA-Z0-9.-]/g, "-");
    const branchName = `clive/${safeName}`;
    const worktreePath = path.join(this.worktreeBaseDir, safeName);

    // Fetch latest from origin
    execSync("git fetch origin", { cwd: this.repoPath, stdio: "pipe" });

    // Determine default branch
    const defaultBranch =
      execSync(
        "git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'",
        { cwd: this.repoPath, encoding: "utf-8" },
      ).trim() || "main";

    // Create worktree from origin's default branch
    execSync(
      `git worktree add -b "${branchName}" "${worktreePath}" "origin/${defaultBranch}"`,
      { cwd: this.repoPath, stdio: "pipe" },
    );

    console.log(
      `[WorktreeManager] Created worktree at ${worktreePath} on branch ${branchName}`,
    );
    return worktreePath;
  }

  /** Remove a session worktree */
  remove(sessionId: string): void {
    const safeName = sessionId.replace(/[^a-zA-Z0-9.-]/g, "-");
    const worktreePath = path.join(this.worktreeBaseDir, safeName);
    const branchName = `clive/${safeName}`;

    try {
      if (fs.existsSync(worktreePath)) {
        execSync(`git worktree remove "${worktreePath}" --force`, {
          cwd: this.repoPath,
          stdio: "pipe",
        });
      }
      // Clean up the branch
      execSync(`git branch -D "${branchName}" 2>/dev/null || true`, {
        cwd: this.repoPath,
        stdio: "pipe",
      });
      console.log(`[WorktreeManager] Removed worktree ${worktreePath}`);
    } catch (error) {
      console.warn(
        `[WorktreeManager] Cleanup warning for ${sessionId}:`,
        error,
      );
    }
  }

  /** Prune stale worktrees */
  prune(): void {
    execSync("git worktree prune", { cwd: this.repoPath, stdio: "pipe" });
  }
}
