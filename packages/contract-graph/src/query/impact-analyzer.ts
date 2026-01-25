/**
 * Impact Analyzer - Deep analysis of contract changes and their ripple effects
 * Specialized analysis for breaking changes, deployment ordering, and migration planning
 */

import type { Contract } from "../graph/contract.js";
import { formatLocation } from "../graph/contract.js";
import type { ContractGraph } from "../graph/graph.js";
import type { Relationship } from "../graph/relationship.js";

/**
 * Severity of a breaking change
 */
export type BreakingSeverity = "critical" | "major" | "minor" | "patch";

/**
 * A detected breaking change
 */
export interface BreakingChange {
  /** Type of breaking change */
  type:
    | "schema_change"
    | "removed_contract"
    | "new_required_field"
    | "type_change"
    | "invariant_violation"
    | "endpoint_change";
  /** Severity level */
  severity: BreakingSeverity;
  /** Description of the change */
  description: string;
  /** Contract affected */
  contract: Contract;
  /** Contracts that will break */
  affectedContracts: Contract[];
  /** Suggested migration steps */
  migrationSteps: string[];
}

/**
 * Deployment ordering recommendation
 */
export interface DeploymentOrder {
  /** Groups of contracts that can be deployed together */
  phases: Array<{
    name: string;
    contracts: Contract[];
    description: string;
  }>;
  /** Contracts that need coordinated deployment */
  coordinatedDeployments: Array<{
    contracts: Contract[];
    reason: string;
  }>;
}

/**
 * Result of comparing two versions of a contract graph
 */
export interface GraphDiff {
  /** Contracts added */
  added: Contract[];
  /** Contracts removed */
  removed: Contract[];
  /** Contracts modified (with before/after) */
  modified: Array<{
    before: Contract;
    after: Contract;
    changes: string[];
  }>;
  /** Relationships added */
  addedRelationships: Relationship[];
  /** Relationships removed */
  removedRelationships: Relationship[];
}

/**
 * Impact Analyzer for detailed change analysis
 */
export class ImpactAnalyzer {
  constructor(private graph: ContractGraph) {}

  /**
   * Detect potential breaking changes if a contract is modified
   */
  detectBreakingChanges(
    contractId: string,
    proposedChanges: Partial<Contract>,
  ): BreakingChange[] {
    const contract = this.graph.getContract(contractId);
    if (!contract) return [];

    const breakingChanges: BreakingChange[] = [];
    const consumers = this.graph.findConsumers(contractId);
    const dependents = this.graph.findDependents(contractId);

    // Check schema changes
    if (proposedChanges.schema && contract.schema) {
      const schemaChange = this.analyzeSchemaChange(
        contract,
        proposedChanges.schema,
      );
      if (schemaChange) {
        breakingChanges.push({
          type: "schema_change",
          severity: schemaChange.severity,
          description: schemaChange.description,
          contract,
          affectedContracts: [...consumers, ...dependents],
          migrationSteps: schemaChange.migrationSteps,
        });
      }
    }

    // Check endpoint changes
    if (proposedChanges.exposes && contract.exposes.length > 0) {
      const removedEndpoints = contract.exposes.filter(
        (e) =>
          !proposedChanges.exposes?.some(
            (pe) => pe.method === e.method && pe.path === e.path,
          ),
      );

      if (removedEndpoints.length > 0) {
        breakingChanges.push({
          type: "endpoint_change",
          severity: "critical",
          description: `Removing ${removedEndpoints.length} endpoint(s): ${removedEndpoints.map((e) => `${e.method} ${e.path}`).join(", ")}`,
          contract,
          affectedContracts: dependents,
          migrationSteps: [
            "1. Deprecate endpoints in current version",
            "2. Provide migration guide to consumers",
            "3. Wait for consumers to migrate",
            "4. Remove endpoints in new version",
          ],
        });
      }
    }

    // Check invariant changes
    if (proposedChanges.invariants) {
      const newInvariants = proposedChanges.invariants.filter(
        (inv) =>
          !contract.invariants.some((ci) => ci.description === inv.description),
      );

      if (newInvariants.length > 0) {
        const errorInvariants = newInvariants.filter(
          (i) => i.severity === "error",
        );
        if (errorInvariants.length > 0) {
          breakingChanges.push({
            type: "invariant_violation",
            severity: "major",
            description: `Adding ${errorInvariants.length} new invariant(s) that may break existing data`,
            contract,
            affectedContracts: dependents,
            migrationSteps: [
              "1. Audit existing data for invariant violations",
              "2. Fix or migrate violating data",
              "3. Apply new invariants",
            ],
          });
        }
      }
    }

    return breakingChanges;
  }

  /**
   * Analyze schema changes for breaking potential
   */
  private analyzeSchemaChange(
    contract: Contract,
    newSchema: Contract["schema"],
  ): {
    severity: BreakingSeverity;
    description: string;
    migrationSteps: string[];
  } | null {
    if (!contract.schema || !newSchema) return null;

    const oldInput = contract.schema.input;
    const newInput = newSchema.input;
    const oldOutput = contract.schema.output;
    const newOutput = newSchema.output;

    // Simple heuristic: if schemas are different, it's potentially breaking
    if (JSON.stringify(oldInput) !== JSON.stringify(newInput)) {
      return {
        severity: "major",
        description: "Input schema has changed",
        migrationSteps: [
          "1. Add new input fields as optional first",
          "2. Update all callers to provide new fields",
          "3. Make fields required once all callers are updated",
        ],
      };
    }

    if (JSON.stringify(oldOutput) !== JSON.stringify(newOutput)) {
      return {
        severity: "major",
        description: "Output schema has changed",
        migrationSteps: [
          "1. Add new output fields (non-breaking)",
          "2. Notify consumers of new fields",
          "3. If removing fields, deprecate first",
        ],
      };
    }

    return null;
  }

  /**
   * Calculate optimal deployment order for a set of contracts
   */
  calculateDeploymentOrder(contractIds: string[]): DeploymentOrder {
    const phases: DeploymentOrder["phases"] = [];
    const coordinatedDeployments: DeploymentOrder["coordinatedDeployments"] =
      [];

    // Build dependency levels
    const levels = new Map<string, number>();
    const visited = new Set<string>();

    const calculateLevel = (id: string): number => {
      if (levels.has(id)) return levels.get(id)!;
      if (visited.has(id)) return 0; // Cycle detected

      visited.add(id);

      const dependencies = this.graph.findDependencies(id);
      let maxDependencyLevel = -1;

      for (const dep of dependencies) {
        if (contractIds.includes(dep.id)) {
          const depLevel = calculateLevel(dep.id);
          maxDependencyLevel = Math.max(maxDependencyLevel, depLevel);
        }
      }

      const level = maxDependencyLevel + 1;
      levels.set(id, level);
      return level;
    };

    for (const id of contractIds) {
      calculateLevel(id);
    }

    // Group by level
    const levelGroups = new Map<number, string[]>();
    for (const [id, level] of levels) {
      const group = levelGroups.get(level) || [];
      group.push(id);
      levelGroups.set(level, group);
    }

    // Create phases
    const sortedLevels = Array.from(levelGroups.keys()).sort((a, b) => a - b);
    for (const level of sortedLevels) {
      const ids = levelGroups.get(level)!;
      const contracts = ids
        .map((id) => this.graph.getContract(id))
        .filter((c): c is Contract => c !== undefined);

      phases.push({
        name: `Phase ${level + 1}`,
        contracts,
        description:
          level === 0
            ? "Base layer - no dependencies on other changed contracts"
            : `Depends on contracts from Phase ${level}`,
      });
    }

    // Find contracts that need coordinated deployment (same event bus, etc.)
    const eventGroups = new Map<string, Contract[]>();

    for (const id of contractIds) {
      const contract = this.graph.getContract(id);
      if (!contract) continue;

      for (const event of [...contract.publishes, ...contract.consumes]) {
        const group = eventGroups.get(event) || [];
        group.push(contract);
        eventGroups.set(event, group);
      }
    }

    for (const [event, contracts] of eventGroups) {
      if (contracts.length > 1) {
        coordinatedDeployments.push({
          contracts,
          reason: `Share event: ${event}`,
        });
      }
    }

    return { phases, coordinatedDeployments };
  }

  /**
   * Compare two contract graphs and find differences
   */
  static diffGraphs(before: ContractGraph, after: ContractGraph): GraphDiff {
    const beforeContracts = new Map(
      before.getAllContracts().map((c) => [c.id, c]),
    );
    const afterContracts = new Map(
      after.getAllContracts().map((c) => [c.id, c]),
    );

    const added: Contract[] = [];
    const removed: Contract[] = [];
    const modified: GraphDiff["modified"] = [];

    // Find added and modified
    for (const [id, afterContract] of afterContracts) {
      const beforeContract = beforeContracts.get(id);
      if (!beforeContract) {
        added.push(afterContract);
      } else {
        const changes = ImpactAnalyzer.detectContractChanges(
          beforeContract,
          afterContract,
        );
        if (changes.length > 0) {
          modified.push({
            before: beforeContract,
            after: afterContract,
            changes,
          });
        }
      }
    }

    // Find removed
    for (const [id, beforeContract] of beforeContracts) {
      if (!afterContracts.has(id)) {
        removed.push(beforeContract);
      }
    }

    // Compare relationships
    const beforeRels = new Set(
      before.getAllRelationships().map((r) => `${r.from}:${r.to}:${r.type}`),
    );
    const afterRels = new Set(
      after.getAllRelationships().map((r) => `${r.from}:${r.to}:${r.type}`),
    );

    const addedRelationships = after
      .getAllRelationships()
      .filter((r) => !beforeRels.has(`${r.from}:${r.to}:${r.type}`));

    const removedRelationships = before
      .getAllRelationships()
      .filter((r) => !afterRels.has(`${r.from}:${r.to}:${r.type}`));

    return {
      added,
      removed,
      modified,
      addedRelationships,
      removedRelationships,
    };
  }

  /**
   * Detect changes between two versions of a contract
   */
  static detectContractChanges(before: Contract, after: Contract): string[] {
    const changes: string[] = [];

    if (before.version !== after.version) {
      changes.push(`Version: ${before.version} → ${after.version}`);
    }

    if (JSON.stringify(before.schema) !== JSON.stringify(after.schema)) {
      changes.push("Schema changed");
    }

    if (before.invariants.length !== after.invariants.length) {
      changes.push(
        `Invariants: ${before.invariants.length} → ${after.invariants.length}`,
      );
    }

    if (before.exposes.length !== after.exposes.length) {
      changes.push(
        `Endpoints: ${before.exposes.length} → ${after.exposes.length}`,
      );
    }

    if (before.publishes.length !== after.publishes.length) {
      changes.push(
        `Published events: ${before.publishes.length} → ${after.publishes.length}`,
      );
    }

    if (before.consumes.length !== after.consumes.length) {
      changes.push(
        `Consumed events: ${before.consumes.length} → ${after.consumes.length}`,
      );
    }

    return changes;
  }

  /**
   * Generate a migration plan for breaking changes
   */
  generateMigrationPlan(breakingChanges: BreakingChange[]): string {
    const lines: string[] = [];

    lines.push("# Migration Plan");
    lines.push("");

    // Group by severity
    const critical = breakingChanges.filter((c) => c.severity === "critical");
    const major = breakingChanges.filter((c) => c.severity === "major");
    const minor = breakingChanges.filter((c) => c.severity === "minor");

    if (critical.length > 0) {
      lines.push("## 🔴 Critical Changes (Requires Immediate Attention)");
      lines.push("");
      for (const change of critical) {
        lines.push(`### ${change.contract.id}`);
        lines.push(`**Issue:** ${change.description}`);
        lines.push("");
        lines.push("**Affected:**");
        for (const affected of change.affectedContracts) {
          const loc = affected.location
            ? ` (${formatLocation(affected.location)})`
            : "";
          lines.push(`- ${affected.id}${loc}`);
        }
        lines.push("");
        lines.push("**Migration Steps:**");
        for (const step of change.migrationSteps) {
          lines.push(step);
        }
        lines.push("");
      }
    }

    if (major.length > 0) {
      lines.push("## 🟠 Major Changes");
      lines.push("");
      for (const change of major) {
        lines.push(`### ${change.contract.id}`);
        lines.push(`**Issue:** ${change.description}`);
        lines.push("");
        lines.push("**Migration Steps:**");
        for (const step of change.migrationSteps) {
          lines.push(step);
        }
        lines.push("");
      }
    }

    if (minor.length > 0) {
      lines.push("## 🟡 Minor Changes");
      lines.push("");
      for (const change of minor) {
        lines.push(`- **${change.contract.id}:** ${change.description}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}
