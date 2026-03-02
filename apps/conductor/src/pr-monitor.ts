/**
 * PR Monitor
 *
 * Checks GitHub PR and review status via the `gh` CLI.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ReviewStatus } from "./types.js";

const execFileAsync = promisify(execFile);

export class PrMonitor {
  constructor(private readonly workspace: string) {}

  /** Check review status for a PR */
  async checkReview(prUrl: string): Promise<ReviewStatus> {
    try {
      const { stdout } = await execFileAsync(
        "gh",
        ["pr", "view", prUrl, "--json", "reviewDecision"],
        { cwd: this.workspace, timeout: 15_000 },
      );

      const data = JSON.parse(stdout);
      switch (data.reviewDecision) {
        case "APPROVED":
          return "approved";
        case "CHANGES_REQUESTED":
          return "changes_requested";
        default:
          return "pending";
      }
    } catch {
      return "pending";
    }
  }

  /** Create a PR for a branch */
  async createPr(opts: {
    branch: string;
    title: string;
    body: string;
    base?: string;
  }): Promise<string> {
    const args = [
      "pr",
      "create",
      "--head",
      opts.branch,
      "--base",
      opts.base || "main",
      "--title",
      opts.title,
      "--body",
      opts.body,
    ];

    const { stdout } = await execFileAsync("gh", args, {
      cwd: this.workspace,
      timeout: 30_000,
    });

    return stdout.trim();
  }
}
