#!/usr/bin/env bun
/**
 * Bidirectional Linear Sync
 * Called by stop-hook.sh to sync task statuses before session restart
 *
 * Reads:
 * - Linear API for current issue statuses
 * - Local plan file (.claude/work-plan*.md) for local statuses
 *
 * Reconciles:
 * - If local shows complete but Linear shows pending -> Update Linear
 * - If Linear shows complete but local shows pending -> Log warning (don't overwrite)
 * - If local shows in_progress but Linear shows unstarted -> Update Linear
 *
 * Usage: bun run linear-sync.ts <parent-issue-id> [plan-file]
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface LinearConfig {
  apiKey: string;
  teamID: string;
}

interface LinearState {
  id: string;
  name: string;
  type: "backlog" | "unstarted" | "started" | "completed" | "canceled";
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  state: LinearState | null;
}

type LocalStatus = "pending" | "in_progress" | "complete" | "blocked";

// Load config from environment or config file
function loadConfig(): LinearConfig | null {
  const apiKey = process.env.LINEAR_API_KEY;
  const teamID = process.env.LINEAR_TEAM_ID;

  if (apiKey && teamID) {
    return { apiKey, teamID };
  }

  // Try TUI config file
  const tuiConfigPath = path.join(process.cwd(), ".clive", "config.json");
  if (fs.existsSync(tuiConfigPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(tuiConfigPath, "utf-8"));
      if (raw.linear?.apiKey && raw.linear?.teamID) {
        return { apiKey: raw.linear.apiKey, teamID: raw.linear.teamID };
      }
    } catch {}
  }

  // Try app config file
  const appConfigPath = path.join(process.cwd(), ".claude", "config.json");
  if (fs.existsSync(appConfigPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(appConfigPath, "utf-8"));
      if (raw.linear?.apiKey && raw.linear?.teamID) {
        return { apiKey: raw.linear.apiKey, teamID: raw.linear.teamID };
      }
    } catch {}
  }

  return null;
}

// Parse plan file for task statuses
// Looks for patterns like:
// ### Task 1: Implement feature
// - [ ] **Status:** complete
function parseLocalStatuses(planFile: string): Map<string, LocalStatus> {
  const statuses = new Map<string, LocalStatus>();
  if (!fs.existsSync(planFile)) {
    console.error(`[linear-sync] Plan file not found: ${planFile}`);
    return statuses;
  }

  const content = fs.readFileSync(planFile, "utf-8");

  // Match task headers and their status lines
  // Pattern captures task title and status
  const taskRegex =
    /###\s+(?:Task\s+)?(?:\d+[:\s]+)?(.+?)[\n\r][\s\S]*?- \[ \] \*\*Status:\*\*\s+(pending|in_progress|complete|blocked)/g;

  let match;
  while ((match = taskRegex.exec(content)) !== null) {
    const [, title, status] = match;
    if (title && status) {
      // Normalize title - trim whitespace and clean up
      const normalizedTitle = title.trim().replace(/\*\*/g, "");
      statuses.set(normalizedTitle, status as LocalStatus);
    }
  }

  console.log(
    `[linear-sync] Parsed ${statuses.size} task statuses from ${planFile}`,
  );
  return statuses;
}

// Fetch Linear issue statuses for sub-issues of a parent
async function fetchLinearStatuses(
  config: LinearConfig,
  parentId: string,
): Promise<Map<string, LinearIssue>> {
  const query = `
    query($issueId: String!) {
      issue(id: $issueId) {
        children(first: 100) {
          nodes {
            id
            identifier
            title
            state {
              id
              name
              type
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: config.apiKey,
      },
      body: JSON.stringify({ query, variables: { issueId: parentId } }),
    });

    if (!response.ok) {
      console.error(
        `[linear-sync] Linear API error: ${response.status} ${response.statusText}`,
      );
      return new Map();
    }

    const json = (await response.json()) as any;

    if (json.errors) {
      console.error(
        "[linear-sync] GraphQL errors:",
        JSON.stringify(json.errors),
      );
      return new Map();
    }

    const issues = new Map<string, LinearIssue>();
    const nodes = json.data?.issue?.children?.nodes || [];

    for (const node of nodes) {
      // Store by title for matching with local plan
      issues.set(node.title, node);
    }

    console.log(`[linear-sync] Fetched ${issues.size} sub-issues from Linear`);
    return issues;
  } catch (error) {
    console.error("[linear-sync] Failed to fetch from Linear:", error);
    return new Map();
  }
}

// Get target state ID for a team by state type
async function getStateId(
  config: LinearConfig,
  stateType: string,
): Promise<string | null> {
  const query = `
    query($teamId: String!) {
      team(id: $teamId) {
        states {
          nodes {
            id
            name
            type
          }
        }
      }
    }
  `;

  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: config.apiKey,
      },
      body: JSON.stringify({ query, variables: { teamId: config.teamID } }),
    });

    const json = (await response.json()) as any;
    const states = json.data?.team?.states?.nodes || [];

    const targetState = states.find((s: any) => s.type === stateType);
    return targetState?.id || null;
  } catch (error) {
    console.error("[linear-sync] Failed to get team states:", error);
    return null;
  }
}

// Update Linear issue status
async function updateLinearStatus(
  config: LinearConfig,
  issueId: string,
  stateId: string,
  stateType: string,
): Promise<boolean> {
  const mutation = `
    mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue {
          id
          identifier
          state {
            name
          }
        }
      }
    }
  `;

  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: config.apiKey,
      },
      body: JSON.stringify({
        query: mutation,
        variables: { id: issueId, input: { stateId } },
      }),
    });

    const json = (await response.json()) as any;

    if (json.data?.issueUpdate?.success) {
      console.log(`[linear-sync] Updated issue ${issueId} to ${stateType}`);
      return true;
    } else {
      console.error(
        `[linear-sync] Failed to update issue ${issueId}:`,
        json.errors,
      );
      return false;
    }
  } catch (error) {
    console.error(`[linear-sync] Error updating issue ${issueId}:`, error);
    return false;
  }
}

// Map local status to Linear state type
function mapLocalToLinearStateType(localStatus: LocalStatus): string | null {
  switch (localStatus) {
    case "complete":
      return "completed";
    case "in_progress":
      return "started";
    case "pending":
      return "unstarted";
    case "blocked":
      return null; // Don't update blocked tasks
    default:
      return null;
  }
}

// Match local task title to Linear issue
// Uses fuzzy matching since titles may differ slightly
function findLinearIssue(
  localTitle: string,
  linearIssues: Map<string, LinearIssue>,
): LinearIssue | null {
  // Exact match first
  if (linearIssues.has(localTitle)) {
    return linearIssues.get(localTitle)!;
  }

  // Fuzzy match - check if Linear title contains local title or vice versa
  const normalizedLocal = localTitle.toLowerCase().trim();
  for (const [linearTitle, issue] of linearIssues) {
    const normalizedLinear = linearTitle.toLowerCase().trim();
    if (
      normalizedLinear.includes(normalizedLocal) ||
      normalizedLocal.includes(normalizedLinear)
    ) {
      return issue;
    }
  }

  return null;
}

// Main sync logic
async function main() {
  const parentId = process.argv[2];
  const planFile = process.argv[3] || ".claude/work-plan-latest.md";

  if (!parentId) {
    console.error("Usage: linear-sync.ts <parent-issue-id> [plan-file]");
    process.exit(1);
  }

  console.log("[linear-sync] Starting bidirectional sync");
  console.log(`[linear-sync] Parent issue: ${parentId}`);
  console.log(`[linear-sync] Plan file: ${planFile}`);

  const config = loadConfig();
  if (!config) {
    console.error(
      "[linear-sync] No Linear config found. Set LINEAR_API_KEY and LINEAR_TEAM_ID or configure in .clive/config.json",
    );
    process.exit(1);
  }

  // Fetch both local and Linear statuses
  const localStatuses = parseLocalStatuses(planFile);
  const linearIssues = await fetchLinearStatuses(config, parentId);

  if (localStatuses.size === 0) {
    console.log("[linear-sync] No local task statuses found");
    process.exit(0);
  }

  if (linearIssues.size === 0) {
    console.log("[linear-sync] No Linear sub-issues found");
    process.exit(0);
  }

  // Cache state IDs
  const stateIdCache = new Map<string, string>();

  // Reconcile statuses
  let updatedCount = 0;
  let skippedCount = 0;

  for (const [localTitle, localStatus] of localStatuses) {
    const linearIssue = findLinearIssue(localTitle, linearIssues);

    if (!linearIssue) {
      console.log(`[linear-sync] No Linear match for: "${localTitle}"`);
      skippedCount++;
      continue;
    }

    const linearStateType = linearIssue.state?.type;
    const targetStateType = mapLocalToLinearStateType(localStatus);

    if (!targetStateType) {
      // Blocked or unknown status - skip
      continue;
    }

    // Determine if update is needed
    let shouldUpdate = false;
    let reason = "";

    if (localStatus === "complete" && linearStateType !== "completed") {
      shouldUpdate = true;
      reason = `local=complete, linear=${linearStateType}`;
    } else if (
      localStatus === "in_progress" &&
      linearStateType === "unstarted"
    ) {
      shouldUpdate = true;
      reason = `local=in_progress, linear=${linearStateType}`;
    } else if (linearStateType === "completed" && localStatus !== "complete") {
      // Linear is ahead - log but don't overwrite
      console.log(
        `[linear-sync] WARNING: Linear shows completed but local shows ${localStatus}: "${localTitle}"`,
      );
      skippedCount++;
      continue;
    }

    if (shouldUpdate) {
      console.log(
        `[linear-sync] Syncing "${linearIssue.identifier}": ${reason}`,
      );

      // Get or cache the state ID
      if (!stateIdCache.has(targetStateType)) {
        const stateId = await getStateId(config, targetStateType);
        if (stateId) {
          stateIdCache.set(targetStateType, stateId);
        }
      }

      const stateId = stateIdCache.get(targetStateType);
      if (stateId) {
        const success = await updateLinearStatus(
          config,
          linearIssue.id,
          stateId,
          targetStateType,
        );
        if (success) {
          updatedCount++;
        }
      } else {
        console.error(
          `[linear-sync] Could not find state ID for type: ${targetStateType}`,
        );
      }
    }
  }

  console.log(
    `[linear-sync] Sync complete: ${updatedCount} updated, ${skippedCount} skipped`,
  );
}

main().catch((error) => {
  console.error("[linear-sync] Fatal error:", error);
  process.exit(1);
});
