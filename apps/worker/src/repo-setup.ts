/**
 * Repo Setup
 *
 * Runs at worker startup to clone the target repo and configure
 * git identity as clive[bot] via GitHub App authentication.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { GitHubAppAuth } from "@clive/github-app";
import type { WorkerConfig } from "./config.js";

const REPO_DIR =
  process.env.CLIVE_REPO_DIR || path.join(os.homedir(), ".clive", "repo");
const WORKTREE_DIR =
  process.env.CLIVE_WORKTREE_DIR ||
  path.join(os.homedir(), ".clive", "worktrees");

export interface RepoSetupResult {
  repoPath: string;
  worktreeBaseDir: string;
  refreshToken: () => Promise<string>;
}

export async function setupRepo(
  config: WorkerConfig,
): Promise<RepoSetupResult | null> {
  if (
    !config.repo ||
    !config.githubAppId ||
    !config.githubAppPrivateKey ||
    !config.githubAppInstallationId
  ) {
    console.log("[RepoSetup] No CLIVE_REPO configured, skipping repo setup");
    return null;
  }

  const auth = new GitHubAppAuth({
    appId: config.githubAppId,
    privateKey: config.githubAppPrivateKey,
    installationId: config.githubAppInstallationId,
  });

  const token = await auth.getToken();

  // Authenticate gh CLI via filesystem (survives env var filtering)
  execSync(`echo "${token}" | gh auth login --with-token`, { stdio: "pipe" });
  execSync("gh auth setup-git", { stdio: "pipe" });

  // Configure git identity globally as clive[bot]
  execSync('git config --global user.name "clive[bot]"');
  execSync(
    `git config --global user.email "${config.githubAppId}+clive[bot]@users.noreply.github.com"`,
  );

  // Clone if not already present
  if (!fs.existsSync(path.join(REPO_DIR, ".git"))) {
    console.log(`[RepoSetup] Cloning ${config.repo}...`);
    fs.mkdirSync(REPO_DIR, { recursive: true });
    execSync(`gh repo clone ${config.repo} ${REPO_DIR}`, {
      stdio: "inherit",
    });
  } else {
    console.log("[RepoSetup] Repo already cloned, pulling latest...");
    execSync("git fetch origin", { cwd: REPO_DIR, stdio: "inherit" });
    execSync("git pull --ff-only origin main || true", {
      cwd: REPO_DIR,
      stdio: "inherit",
    });
  }

  // Create worktree directory
  fs.mkdirSync(WORKTREE_DIR, { recursive: true });

  console.log(`[RepoSetup] Repo ready at ${REPO_DIR}`);

  return {
    repoPath: REPO_DIR,
    worktreeBaseDir: WORKTREE_DIR,
    refreshToken: () => auth.getToken(),
  };
}
