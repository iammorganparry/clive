import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Metadata stored in .claude/epics/{epicId}/worktree.json
 * Written by the plan agent or auto-created by the TUI build flow.
 */
export interface WorktreeMetadata {
  worktreePath: string;
  branchName: string;
  epicId: string;
  epicIdentifier: string;
  createdAt: string;
}

export interface WorktreeCreationResult {
  success: boolean;
  metadata?: WorktreeMetadata;
  error?: string;
}

/**
 * Info about a git worktree, enriched with epic metadata if available.
 */
export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
  epicId?: string;
  epicIdentifier?: string;
  metadata: WorktreeMetadata | null;
}

/**
 * WorktreeService - manages worktree metadata for epic-based builds
 *
 * Reads existing worktree metadata and creates new worktrees when needed.
 * Metadata is stored in .claude/epics/{epicId}/worktree.json in the main repo.
 */
export class WorktreeService {
  /**
   * Get worktree metadata for an epic.
   * Returns null if no worktree exists, metadata is invalid, or the directory was deleted.
   */
  static getWorktreeForEpic(
    mainWorkspaceRoot: string,
    epicId: string,
  ): WorktreeMetadata | null {
    const metadataPath = path.join(
      mainWorkspaceRoot,
      ".claude",
      "epics",
      epicId,
      "worktree.json",
    );

    try {
      const raw = fs.readFileSync(metadataPath, "utf-8");
      const metadata: WorktreeMetadata = JSON.parse(raw);

      // Validate required fields
      if (!metadata.worktreePath || !metadata.branchName || !metadata.epicId) {
        return null;
      }

      // Verify the worktree directory still exists
      if (!fs.existsSync(metadata.worktreePath)) {
        return null;
      }

      return metadata;
    } catch {
      return null;
    }
  }

  /**
   * Create a git worktree for an epic.
   * - Derives branch name: clive/{epicIdentifier}
   * - Derives worktree dir: ../{repoName}-worktrees/{epicIdentifier}
   * - If worktree dir exists but metadata is missing, reconstructs metadata only
   * - Writes metadata to main repo and state files in worktree
   */
  static createWorktreeForEpic(
    mainWorkspaceRoot: string,
    epicId: string,
    epicIdentifier: string,
  ): WorktreeCreationResult {
    const repoName = path.basename(mainWorkspaceRoot);
    const branchName = `clive/${epicIdentifier}`;
    const worktreeDir = path.resolve(
      mainWorkspaceRoot,
      "..",
      `${repoName}-worktrees`,
      epicIdentifier,
    );

    try {
      const worktreeDirExists = fs.existsSync(worktreeDir);

      if (!worktreeDirExists) {
        // Determine if the branch already exists
        const branchExists = WorktreeService.branchExists(
          mainWorkspaceRoot,
          branchName,
        );

        if (branchExists) {
          execSync(`git worktree add ${worktreeDir} ${branchName}`, {
            cwd: mainWorkspaceRoot,
            stdio: "pipe",
          });
        } else {
          execSync(
            `git worktree add -b ${branchName} ${worktreeDir} HEAD`,
            {
              cwd: mainWorkspaceRoot,
              stdio: "pipe",
            },
          );
        }
      }

      const metadata: WorktreeMetadata = {
        worktreePath: worktreeDir,
        branchName,
        epicId,
        epicIdentifier,
        createdAt: new Date().toISOString(),
      };

      // Write metadata to main repo
      WorktreeService.writeMetadata(mainWorkspaceRoot, epicId, metadata);

      // Write state files inside the worktree
      WorktreeService.writeStateFiles(
        worktreeDir,
        branchName,
        mainWorkspaceRoot,
      );

      return { success: true, metadata };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error creating worktree";
      return { success: false, error: message };
    }
  }

  /**
   * List all git worktrees for the repository, enriched with epic metadata.
   * Parses `git worktree list --porcelain` and cross-references .claude/epics/ metadata.
   */
  static listWorktrees(mainWorkspaceRoot: string): WorktreeInfo[] {
    try {
      const output = execSync("git worktree list --porcelain", {
        cwd: mainWorkspaceRoot,
        stdio: "pipe",
        encoding: "utf-8",
      });

      // Parse porcelain output: blocks separated by blank lines
      // Each block has: worktree <path>, HEAD <sha>, branch refs/heads/<name>
      const worktrees: WorktreeInfo[] = [];
      const blocks = output.split("\n\n").filter((b) => b.trim());

      for (const block of blocks) {
        const lines = block.split("\n");
        let wtPath = "";
        let head = "";
        let branch = "";
        let isBare = false;

        for (const line of lines) {
          if (line.startsWith("worktree ")) {
            wtPath = line.slice("worktree ".length);
          } else if (line.startsWith("HEAD ")) {
            head = line.slice("HEAD ".length);
          } else if (line.startsWith("branch ")) {
            branch = line.slice("branch refs/heads/".length);
          } else if (line === "bare") {
            isBare = true;
          }
        }

        if (!wtPath || isBare) continue;

        // Find matching epic metadata by scanning .claude/epics/*/worktree.json
        const metadata = WorktreeService.findMetadataForPath(
          mainWorkspaceRoot,
          wtPath,
        );

        worktrees.push({
          path: wtPath,
          branch: branch || "HEAD",
          head,
          isMain: path.resolve(wtPath) === path.resolve(mainWorkspaceRoot),
          epicId: metadata?.epicId,
          epicIdentifier: metadata?.epicIdentifier,
          metadata,
        });
      }

      // Sort: main worktree first, then alphabetically by branch
      worktrees.sort((a, b) => {
        if (a.isMain && !b.isMain) return -1;
        if (!a.isMain && b.isMain) return 1;
        return a.branch.localeCompare(b.branch);
      });

      return worktrees;
    } catch {
      // If git command fails, return just the main workspace
      return [
        {
          path: mainWorkspaceRoot,
          branch: WorktreeService.getCurrentBranch(mainWorkspaceRoot),
          head: "",
          isMain: true,
          metadata: null,
        },
      ];
    }
  }

  /**
   * Create a standalone git worktree without requiring an epicId.
   * Used when starting a new chat without a Linear issue context.
   * Branch defaults to clive/chat-<YYYYMMDD-HHmm>.
   */
  static createStandaloneWorktree(
    mainWorkspaceRoot: string,
    branchName?: string,
  ): WorktreeCreationResult {
    const repoName = path.basename(mainWorkspaceRoot);
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const effectiveBranch = branchName || `clive/chat-${timestamp}`;
    const slug = effectiveBranch.replace(/^clive\//, "");
    const worktreeDir = path.resolve(
      mainWorkspaceRoot,
      "..",
      `${repoName}-worktrees`,
      slug,
    );

    try {
      if (!fs.existsSync(worktreeDir)) {
        const branchExists = WorktreeService.branchExists(
          mainWorkspaceRoot,
          effectiveBranch,
        );

        if (branchExists) {
          execSync(`git worktree add ${worktreeDir} ${effectiveBranch}`, {
            cwd: mainWorkspaceRoot,
            stdio: "pipe",
          });
        } else {
          execSync(
            `git worktree add -b ${effectiveBranch} ${worktreeDir} HEAD`,
            {
              cwd: mainWorkspaceRoot,
              stdio: "pipe",
            },
          );
        }
      }

      // Write state files in worktree
      WorktreeService.writeStateFiles(
        worktreeDir,
        effectiveBranch,
        mainWorkspaceRoot,
      );

      // Sync config files from main repo
      WorktreeService.syncConfigToWorktree(mainWorkspaceRoot, worktreeDir);

      const metadata: WorktreeMetadata = {
        worktreePath: worktreeDir,
        branchName: effectiveBranch,
        epicId: "",
        epicIdentifier: slug,
        createdAt: now.toISOString(),
      };

      return { success: true, metadata };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error creating worktree";
      return { success: false, error: message };
    }
  }

  /**
   * Scan .claude/epics/{epicId}/worktree.json to find metadata matching a worktree path.
   */
  private static findMetadataForPath(
    mainWorkspaceRoot: string,
    worktreePath: string,
  ): WorktreeMetadata | null {
    const epicsDir = path.join(mainWorkspaceRoot, ".claude", "epics");
    if (!fs.existsSync(epicsDir)) return null;

    try {
      const epicDirs = fs.readdirSync(epicsDir, { withFileTypes: true });
      const resolvedPath = path.resolve(worktreePath);

      for (const entry of epicDirs) {
        if (!entry.isDirectory()) continue;
        const metaPath = path.join(epicsDir, entry.name, "worktree.json");
        if (!fs.existsSync(metaPath)) continue;

        try {
          const raw = fs.readFileSync(metaPath, "utf-8");
          const meta: WorktreeMetadata = JSON.parse(raw);
          if (path.resolve(meta.worktreePath) === resolvedPath) {
            return meta;
          }
        } catch {
          // Skip malformed metadata
        }
      }
    } catch {
      // Skip if epics dir can't be read
    }

    return null;
  }

  /** Get the current branch name for a repo */
  private static getCurrentBranch(cwd: string): string {
    try {
      return execSync("git rev-parse --abbrev-ref HEAD", {
        cwd,
        stdio: "pipe",
        encoding: "utf-8",
      }).trim();
    } catch {
      return "unknown";
    }
  }

  /** Check if a git branch exists locally */
  private static branchExists(cwd: string, branchName: string): boolean {
    try {
      execSync(`git rev-parse --verify ${branchName}`, {
        cwd,
        stdio: "pipe",
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Write worktree.json metadata to the main repo */
  private static writeMetadata(
    mainWorkspaceRoot: string,
    epicId: string,
    metadata: WorktreeMetadata,
  ): void {
    const metadataDir = path.join(
      mainWorkspaceRoot,
      ".claude",
      "epics",
      epicId,
    );
    fs.mkdirSync(metadataDir, { recursive: true });
    fs.writeFileSync(
      path.join(metadataDir, "worktree.json"),
      JSON.stringify(metadata, null, 2),
    );
  }

  /** Write state files inside the worktree's .claude/ directory */
  private static writeStateFiles(
    worktreeDir: string,
    branchName: string,
    mainWorkspaceRoot: string,
  ): void {
    const claudeDir = path.join(worktreeDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, ".worktree-branch"), branchName);
    fs.writeFileSync(path.join(worktreeDir, ".worktree-path"), worktreeDir);
    fs.writeFileSync(
      path.join(worktreeDir, ".worktree-origin"),
      mainWorkspaceRoot,
    );
  }

  /**
   * Sync configuration files from the main repo into a worktree.
   * Git worktrees share .git but NOT working directory files, so
   * .claude/ and .clive/ config must be copied explicitly.
   */
  static syncConfigToWorktree(
    mainWorkspaceRoot: string,
    worktreeDir: string,
  ): void {
    const filesToCopy = [
      ".claude/CLAUDE.md",
      ".claude/settings.json",
      ".claude/settings.local.json",
      ".clive/config.json",
      ".clive/.env",
    ];

    const dirsToCopy = [
      ".claude/skills",
      ".clive/knowledge",
      ".clive/rules",
    ];

    for (const file of filesToCopy) {
      const src = path.join(mainWorkspaceRoot, file);
      const dest = path.join(worktreeDir, file);
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }
    }

    for (const dir of dirsToCopy) {
      const src = path.join(mainWorkspaceRoot, dir);
      const dest = path.join(worktreeDir, dir);
      if (fs.existsSync(src)) {
        WorktreeService.copyDirSync(src, dest);
      }
    }
  }

  /**
   * Copy the plan file into the worktree as .claude/current-plan.md.
   * Searches multiple locations in priority order:
   * 1. Main repo's .claude/current-plan.md
   * 2. ~/.claude/plans/epics/{epicId}/ (most recent .md file)
   */
  static copyPlanFile(
    mainWorkspaceRoot: string,
    epicId: string,
    worktreeDir: string,
  ): void {
    let sourcePlan: string | null = null;

    // 1. Check main repo's .claude/current-plan.md
    const mainRepoPlan = path.join(
      mainWorkspaceRoot,
      ".claude",
      "current-plan.md",
    );
    if (fs.existsSync(mainRepoPlan)) {
      sourcePlan = mainRepoPlan;
    } else {
      // 2. Check ~/.claude/plans/epics/{epicId}/ for the most recent .md
      const homePlanDir = path.join(
        os.homedir(),
        ".claude",
        "plans",
        "epics",
        epicId,
      );
      if (fs.existsSync(homePlanDir)) {
        const files = fs
          .readdirSync(homePlanDir)
          .filter((f) => f.endsWith(".md"))
          .map((f) => ({
            name: f,
            mtime: fs.statSync(path.join(homePlanDir, f)).mtimeMs,
          }))
          .sort((a, b) => b.mtime - a.mtime);
        if (files.length > 0) {
          sourcePlan = path.join(homePlanDir, files[0]!.name);
        }
      }
    }

    if (sourcePlan) {
      const dest = path.join(worktreeDir, ".claude", "current-plan.md");
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(sourcePlan, dest);
    }
  }

  /** Recursively copy a directory */
  private static copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        WorktreeService.copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}
