/**
 * CI Monitor
 *
 * Checks GitHub Actions CI status for branches via the `gh` CLI.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CiStatus } from "./types.js";

const execFileAsync = promisify(execFile);

export class CiMonitor {
  constructor(private readonly workspace: string) {}

  /** Check CI status for a branch */
  async checkBranch(branch: string): Promise<CiStatus> {
    try {
      const { stdout } = await execFileAsync(
        "gh",
        [
          "run",
          "list",
          "--branch",
          branch,
          "--limit",
          "1",
          "--json",
          "status,conclusion",
        ],
        { cwd: this.workspace, timeout: 15_000 },
      );

      const runs = JSON.parse(stdout);
      if (!runs.length) return "pending";

      const latest = runs[0];
      if (latest.status === "completed") {
        return latest.conclusion === "success" ? "passing" : "failing";
      }
      return "pending";
    } catch {
      return "pending";
    }
  }
}
