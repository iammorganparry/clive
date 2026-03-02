/**
 * Linear Client
 *
 * Wraps Linear API operations for the conductor.
 * Uses the `gh` CLI or direct HTTP for issue queries.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  state: { name: string };
  url: string;
}

export class LinearClient {
  /** Extract issue identifier from a Linear URL */
  static parseUrl(url: string): string | null {
    const match = url.match(/\/issue\/([A-Z]+-\d+)/);
    return match?.[1] || null;
  }

  /** Fetch issue details via Linear CLI or API */
  async getIssue(identifier: string): Promise<LinearIssue | null> {
    try {
      const { stdout } = await execFileAsync(
        "linear",
        ["issue", "view", identifier, "--json"],
        { timeout: 15_000 },
      );
      return JSON.parse(stdout);
    } catch {
      console.warn(`[LinearClient] Failed to fetch issue ${identifier}`);
      return null;
    }
  }

  /** Check if a Linear issue has been marked as Done */
  async isIssueDone(identifier: string): Promise<boolean> {
    const issue = await this.getIssue(identifier);
    if (!issue) return false;
    return issue.state.name.toLowerCase() === "done";
  }

  /** Check status of multiple issues */
  async checkIssueStatuses(
    identifiers: string[],
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    for (const id of identifiers) {
      results.set(id, await this.isIssueDone(id));
    }
    return results;
  }

  /** Extract Linear identifiers from URLs */
  static parseUrls(urls: string[]): string[] {
    return urls
      .map((u) => LinearClient.parseUrl(u))
      .filter((id): id is string => id !== null);
  }
}
