/**
 * Breaking Changes Detector - Compares contract versions to detect breaking changes
 * Designed for CI integration to catch breaking changes before merge
 */

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContracts } from "../cli/loader.js";
import type { ContractGraph } from "../graph/graph.js";
import { ImpactAnalyzer } from "../query/impact-analyzer.js";

/**
 * Types of breaking changes
 */
export type BreakingChangeType =
  | "contract_removed"
  | "endpoint_removed"
  | "endpoint_changed"
  | "schema_breaking"
  | "event_schema_changed"
  | "invariant_added"
  | "required_field_added";

/**
 * Severity of breaking changes
 */
export type BreakingChangeSeverity = "critical" | "major" | "minor";

/**
 * A detected breaking change
 */
export interface BreakingChange {
  type: BreakingChangeType;
  severity: BreakingChangeSeverity;
  contractId: string;
  description: string;
  affectedConsumers: string[];
  crossRepoImpact: boolean;
  migrationHint?: string;
}

/**
 * Detect breaking changes between current contracts and a git ref
 */
export async function detectBreakingChanges(
  currentDir: string,
  baseRef: string,
): Promise<BreakingChange[]> {
  const breakingChanges: BreakingChange[] = [];

  // Load current contracts
  const currentResult = await loadContracts(currentDir);
  const currentGraph = currentResult.graph;

  // Load contracts from base ref
  const baseGraph = await loadContractsFromGitRef(currentDir, baseRef);

  if (!baseGraph) {
    return breakingChanges;
  }

  // Compare graphs
  const diff = ImpactAnalyzer.diffGraphs(baseGraph, currentGraph);

  // Check removed contracts
  for (const removed of diff.removed) {
    const consumers = baseGraph.findConsumers(removed.id);
    const dependents = baseGraph.findDependents(removed.id);
    const affected = [...consumers, ...dependents];

    breakingChanges.push({
      type: "contract_removed",
      severity: affected.length > 0 ? "critical" : "major",
      contractId: removed.id,
      description: `Contract ${removed.id} was removed`,
      affectedConsumers: affected.map((c) => c.id),
      crossRepoImpact: affected.some((c) => c.repo !== removed.repo),
      migrationHint:
        "Ensure all consumers are migrated before removing this contract",
    });
  }

  // Check modified contracts for breaking changes
  for (const { before, after } of diff.modified) {
    // Check endpoint changes
    if (before.exposes.length > 0) {
      for (const endpoint of before.exposes) {
        const stillExists = after.exposes.some(
          (e) => e.method === endpoint.method && e.path === endpoint.path,
        );
        if (!stillExists) {
          const dependents = currentGraph.findDependents(after.id);
          breakingChanges.push({
            type: "endpoint_removed",
            severity: "critical",
            contractId: after.id,
            description: `Endpoint ${endpoint.method} ${endpoint.path} was removed from ${after.id}`,
            affectedConsumers: dependents.map((c) => c.id),
            crossRepoImpact: dependents.some((c) => c.repo !== after.repo),
            migrationHint:
              "Deprecate endpoint before removing, or provide a migration path",
          });
        }
      }
    }

    // Check event schema changes
    if (
      (before.type === "event" || before.publishes.length > 0) &&
      JSON.stringify(before.schema) !== JSON.stringify(after.schema)
    ) {
      const consumers = currentGraph.findConsumers(after.id);
      breakingChanges.push({
        type: "event_schema_changed",
        severity: "critical",
        contractId: after.id,
        description: `Event schema changed for ${after.id}`,
        affectedConsumers: consumers.map((c) => c.id),
        crossRepoImpact: consumers.some((c) => c.repo !== after.repo),
        migrationHint:
          "Add new fields as optional, coordinate deployment with consumers, or version the event",
      });
    }

    // Check for new strict invariants
    const newInvariants = after.invariants.filter(
      (inv) =>
        inv.severity === "error" &&
        !before.invariants.some((bi) => bi.description === inv.description),
    );

    if (newInvariants.length > 0) {
      breakingChanges.push({
        type: "invariant_added",
        severity: "major",
        contractId: after.id,
        description: `New error-level invariants added to ${after.id}: ${newInvariants.map((i) => i.description).join(", ")}`,
        affectedConsumers: currentGraph
          .findDependents(after.id)
          .map((c) => c.id),
        crossRepoImpact: false,
        migrationHint:
          "Ensure existing data complies with new invariants before deploying",
      });
    }
  }

  // Check removed relationships (could indicate broken dependencies)
  for (const removedRel of diff.removedRelationships) {
    if (removedRel.type === "consumes" || removedRel.type === "reads") {
      // This might not be breaking, but worth noting
    }
  }

  return breakingChanges;
}

/**
 * Load contracts from a specific git ref
 */
async function loadContractsFromGitRef(
  repoDir: string,
  ref: string,
): Promise<ContractGraph | null> {
  // Create a temp directory
  const tempDir = mkdtempSync(join(tmpdir(), "contract-graph-"));

  try {
    // Get the list of contract files at the base ref
    const contractFiles = execSync(
      `git ls-tree -r --name-only ${ref} -- "**/contracts/**/*.md" "**/*.contracts.md" "**/CONTRACTS.md"`,
      { cwd: repoDir, encoding: "utf-8" },
    )
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);

    if (contractFiles.length === 0) {
      return null;
    }

    // Extract each file to temp directory
    for (const file of contractFiles) {
      try {
        const content = execSync(`git show ${ref}:${file}`, {
          cwd: repoDir,
          encoding: "utf-8",
        });
        const targetPath = join(tempDir, file);
        const targetDir = join(targetPath, "..");

        execSync(`mkdir -p "${targetDir}"`);
        writeFileSync(targetPath, content);
      } catch {}
    }

    // Load contracts from temp directory
    const result = await loadContracts(tempDir);
    return result.graph;
  } catch (_err) {
    // Git command failed, likely invalid ref
    return null;
  } finally {
    // Cleanup
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Format a breaking change for display
 */
export function formatBreakingChange(change: BreakingChange): string {
  const severity =
    change.severity === "critical"
      ? "🔴"
      : change.severity === "major"
        ? "🟠"
        : "🟡";

  let result = `${severity} [${change.type}] ${change.description}`;

  if (change.affectedConsumers.length > 0) {
    result += `\n   Affects: ${change.affectedConsumers.join(", ")}`;
  }

  if (change.crossRepoImpact) {
    result += "\n   ⚠️  Cross-repository impact!";
  }

  if (change.migrationHint) {
    result += `\n   💡 ${change.migrationHint}`;
  }

  return result;
}

/**
 * Check if any breaking changes are critical
 */
export function hasCriticalBreakingChanges(changes: BreakingChange[]): boolean {
  return changes.some((c) => c.severity === "critical");
}

/**
 * Generate a breaking changes report
 */
export function generateBreakingChangesReport(
  changes: BreakingChange[],
): string {
  const lines: string[] = [];

  lines.push("# Breaking Changes Report");
  lines.push("");

  if (changes.length === 0) {
    lines.push("No breaking changes detected.");
    return lines.join("\n");
  }

  const critical = changes.filter((c) => c.severity === "critical");
  const major = changes.filter((c) => c.severity === "major");
  const minor = changes.filter((c) => c.severity === "minor");

  if (critical.length > 0) {
    lines.push("## 🔴 Critical Breaking Changes");
    lines.push("");
    for (const change of critical) {
      lines.push(`### ${change.contractId}`);
      lines.push(`**${change.type}**: ${change.description}`);
      if (change.affectedConsumers.length > 0) {
        lines.push(`**Affected**: ${change.affectedConsumers.join(", ")}`);
      }
      if (change.crossRepoImpact) {
        lines.push("**⚠️ Cross-repository impact**");
      }
      if (change.migrationHint) {
        lines.push(`**Migration**: ${change.migrationHint}`);
      }
      lines.push("");
    }
  }

  if (major.length > 0) {
    lines.push("## 🟠 Major Breaking Changes");
    lines.push("");
    for (const change of major) {
      lines.push(`- **${change.contractId}**: ${change.description}`);
    }
    lines.push("");
  }

  if (minor.length > 0) {
    lines.push("## 🟡 Minor Breaking Changes");
    lines.push("");
    for (const change of minor) {
      lines.push(`- **${change.contractId}**: ${change.description}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
