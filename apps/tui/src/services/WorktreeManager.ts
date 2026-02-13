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

    // Install branch protection and git safety defaults
    this.installPrePushHook(worktreePath);
    this.configureGitDefaults(worktreePath);

    // Symlink node_modules from main repo to avoid expensive reinstalls
    this.symlinkNodeModules(worktreePath);

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

  /** Get the worktree path for a session (without creating it) */
  getWorktreePath(sessionId: string): string {
    const safeName = sessionId.replace(/[^a-zA-Z0-9.-]/g, "-");
    return path.join(this.worktreeBaseDir, safeName);
  }

  /** Get the branch name for a session */
  getBranchName(sessionId: string): string {
    const safeName = sessionId.replace(/[^a-zA-Z0-9.-]/g, "-");
    return `clive/${safeName}`;
  }

  /** Install pre-push hook that blocks pushes to protected branches */
  private installPrePushHook(worktreePath: string): void {
    // Worktrees use a .git *file* pointing to the main repo's worktree dir.
    // The actual hooks dir is at the path in the .git file + /hooks
    const gitFile = fs.readFileSync(
      path.join(worktreePath, ".git"),
      "utf-8",
    );
    const gitDirRelative = gitFile.replace("gitdir: ", "").trim();
    const gitDir = path.resolve(worktreePath, gitDirRelative);
    const hooksDir = path.join(gitDir, "hooks");

    fs.mkdirSync(hooksDir, { recursive: true });

    const hookScript = `#!/bin/sh
# Branch protection — blocks pushes to main/master/production
# Installed by Clive WorktreeManager

PROTECTED_BRANCHES="main master production prod"

while read local_ref local_sha remote_ref remote_sha; do
  remote_branch=$(echo "$remote_ref" | sed 's|refs/heads/||')
  for protected in $PROTECTED_BRANCHES; do
    if [ "$remote_branch" = "$protected" ]; then
      echo "BLOCKED: Push to protected branch '$protected' is not allowed."
      echo "Push to your clive/* feature branch and create a PR instead."
      exit 1
    fi
  done
done

exit 0
`;

    const hookPath = path.join(hooksDir, "pre-push");
    fs.writeFileSync(hookPath, hookScript, { mode: 0o755 });
  }

  /** Configure git defaults for safety */
  private configureGitDefaults(worktreePath: string): void {
    // Set push.default=current so `git push` only pushes the current branch
    // Prevents accidental pushes to a different remote branch
    execSync("git config push.default current", {
      cwd: worktreePath,
      stdio: "pipe",
    });
  }

  /** Symlink node_modules from the main repo to avoid reinstalling per-worktree */
  private symlinkNodeModules(worktreePath: string): void {
    const mainNodeModules = path.join(this.repoPath, "node_modules");
    const wtNodeModules = path.join(worktreePath, "node_modules");

    if (fs.existsSync(mainNodeModules) && !fs.existsSync(wtNodeModules)) {
      try {
        fs.symlinkSync(mainNodeModules, wtNodeModules, "dir");
        console.log(
          `[WorktreeManager] Symlinked node_modules from main repo`,
        );
      } catch (error) {
        console.warn(
          `[WorktreeManager] Failed to symlink node_modules:`,
          error,
        );
      }
    }
  }

  /** Prune stale worktrees */
  prune(): void {
    execSync("git worktree prune", { cwd: this.repoPath, stdio: "pipe" });
  }
}
