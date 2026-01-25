/**
 * Query Engine - API for querying contract information
 * Provides methods for contract lookup, impact analysis, and dependency traversal
 */

import type {
  Contract,
  CodeLocation,
  Invariant,
  ErrorContract,
} from "../graph/contract.js";
import { formatLocation } from "../graph/contract.js";
import type { ContractGraph } from "../graph/graph.js";
import type { RelationshipType } from "../graph/relationship.js";

/**
 * Result of an impact analysis
 */
export interface ImpactAnalysis {
  /** The contract being analyzed */
  contract: Contract;
  /** Direct dependents (contracts that directly depend on this one) */
  directDependents: Contract[];
  /** Transitive dependents (all contracts affected by changes) */
  transitiveDependents: Contract[];
  /** Producers of this contract (for events/tables) */
  producers: Contract[];
  /** Consumers of this contract (for events/tables) */
  consumers: Contract[];
  /** Cross-repo impacts */
  crossRepoImpacts: Map<string, Contract[]>;
  /** Breaking change warnings */
  warnings: string[];
  /** Invariants that must be maintained */
  invariantsToMaintain: Invariant[];
}

/**
 * Result of querying contracts for a code location
 */
export interface LocationQueryResult {
  /** Contracts defined at this location */
  contracts: Contract[];
  /** Invariants applicable to this location */
  invariants: Invariant[];
  /** Errors that can be produced */
  errors: ErrorContract[];
  /** Contracts that depend on code at this location */
  dependents: Contract[];
}

/**
 * Options for impact analysis
 */
export interface ImpactOptions {
  /** Maximum depth for transitive analysis (default: Infinity) */
  maxDepth?: number;
  /** Include invariants in analysis */
  includeInvariants?: boolean;
  /** Include cross-repo impacts */
  includeCrossRepo?: boolean;
}

/**
 * Query Engine for the Contract Graph
 */
export class QueryEngine {
  constructor(private graph: ContractGraph) {}

  /**
   * Get all contracts for a code location (file path)
   */
  contractsFor(location: string | CodeLocation): LocationQueryResult {
    const filePath = typeof location === "string" ? location : location.file;
    const contracts = this.graph.findByFile(filePath);

    // Collect all invariants and errors from matching contracts
    const invariants: Invariant[] = [];
    const errors: ErrorContract[] = [];

    for (const contract of contracts) {
      invariants.push(...contract.invariants);
      errors.push(...contract.errors);
    }

    // Find dependents of all contracts at this location
    const dependentSet = new Set<string>();
    for (const contract of contracts) {
      const deps = this.graph.findDependents(contract.id);
      for (const dep of deps) {
        dependentSet.add(dep.id);
      }
    }

    const dependents = Array.from(dependentSet)
      .map((id) => this.graph.getContract(id))
      .filter((c): c is Contract => c !== undefined);

    return { contracts, invariants, errors, dependents };
  }

  /**
   * Analyze the impact of changing a contract
   */
  impactOf(
    contractId: string,
    options: ImpactOptions = {},
  ): ImpactAnalysis | null {
    const contract = this.graph.getContract(contractId);
    if (!contract) return null;

    const {
      maxDepth = Infinity,
      includeInvariants = true,
      includeCrossRepo = true,
    } = options;

    // Find direct dependents
    const directDependents = this.graph.findDependents(contractId);

    // Find transitive dependents
    const traversalResult = this.graph.traverse(contractId, {
      direction: "incoming",
      maxDepth,
    });
    const transitiveDependents = traversalResult.contracts.filter(
      (c) => c.id !== contractId,
    );

    // Find producers and consumers
    const producers = this.graph.findProducers(contractId);
    const consumers = this.graph.findConsumers(contractId);

    // Group by repository for cross-repo impacts
    const crossRepoImpacts = new Map<string, Contract[]>();
    if (includeCrossRepo) {
      for (const dep of transitiveDependents) {
        if (dep.repo && dep.repo !== contract.repo) {
          const existing = crossRepoImpacts.get(dep.repo) || [];
          existing.push(dep);
          crossRepoImpacts.set(dep.repo, existing);
        }
      }
    }

    // Collect invariants that must be maintained
    const invariantsToMaintain: Invariant[] = [];
    if (includeInvariants) {
      invariantsToMaintain.push(...contract.invariants);
      // Also include invariants from direct dependents
      for (const dep of directDependents) {
        invariantsToMaintain.push(...dep.invariants);
      }
    }

    // Generate warnings
    const warnings: string[] = [];

    if (crossRepoImpacts.size > 0) {
      warnings.push(
        `⚠️  CROSS-SERVICE IMPACT: Changes affect ${crossRepoImpacts.size} other repositories`,
      );
    }

    if (consumers.length > 0 && contract.type === "event") {
      warnings.push(
        `⚠️  EVENT SCHEMA CHANGE: ${consumers.length} consumers depend on this event's schema`,
      );
    }

    if (contract.exposes.length > 0) {
      warnings.push(
        `⚠️  PUBLIC API: This contract exposes ${contract.exposes.length} public endpoint(s)`,
      );
    }

    return {
      contract,
      directDependents,
      transitiveDependents,
      producers,
      consumers,
      crossRepoImpacts,
      warnings,
      invariantsToMaintain,
    };
  }

  /**
   * Get all invariants for a code location
   */
  invariantsFor(location: string | CodeLocation): Invariant[] {
    const result = this.contractsFor(location);
    return result.invariants;
  }

  /**
   * Get all errors for a contract
   */
  errorsFor(contractId: string): ErrorContract[] {
    const contract = this.graph.getContract(contractId);
    return contract?.errors || [];
  }

  /**
   * Get the full dependency graph for a contract
   */
  dependencyGraph(
    contractId: string,
    options: { maxDepth?: number } = {},
  ): {
    contracts: Contract[];
    relationships: Array<{
      from: string;
      to: string;
      type: RelationshipType;
    }>;
  } | null {
    const contract = this.graph.getContract(contractId);
    if (!contract) return null;

    const result = this.graph.traverse(contractId, {
      direction: "both",
      maxDepth: options.maxDepth,
    });

    return {
      contracts: result.contracts,
      relationships: result.relationships,
    };
  }

  /**
   * Find contracts by various criteria
   */
  find(query: {
    type?: Contract["type"];
    repo?: string;
    hasInvariants?: boolean;
    publishes?: string;
    consumes?: string;
    reads?: string;
    writes?: string;
  }): Contract[] {
    let contracts = this.graph.getAllContracts();

    if (query.type) {
      contracts = contracts.filter((c) => c.type === query.type);
    }

    if (query.repo) {
      contracts = contracts.filter((c) => c.repo === query.repo);
    }

    if (query.hasInvariants) {
      contracts = contracts.filter((c) => c.invariants.length > 0);
    }

    if (query.publishes) {
      contracts = contracts.filter((c) =>
        c.publishes.includes(query.publishes!),
      );
    }

    if (query.consumes) {
      contracts = contracts.filter((c) => c.consumes.includes(query.consumes!));
    }

    if (query.reads) {
      contracts = contracts.filter((c) => c.reads.includes(query.reads!));
    }

    if (query.writes) {
      contracts = contracts.filter((c) => c.writes.includes(query.writes!));
    }

    return contracts;
  }

  /**
   * Get a summary of the graph
   */
  summary(): {
    totalContracts: number;
    totalRelationships: number;
    byType: Record<string, number>;
    byRepo: Record<string, number>;
    contractsWithInvariants: number;
    crossRepoRelationships: number;
  } {
    const stats = this.graph.getStats();
    const allContracts = this.graph.getAllContracts();

    const contractsWithInvariants = allContracts.filter(
      (c) => c.invariants.length > 0,
    ).length;

    // Count cross-repo relationships
    let crossRepoRelationships = 0;
    for (const rel of this.graph.getAllRelationships()) {
      const fromContract = this.graph.getContract(rel.from);
      const toContract = this.graph.getContract(rel.to);
      if (
        fromContract?.repo &&
        toContract?.repo &&
        fromContract.repo !== toContract.repo
      ) {
        crossRepoRelationships++;
      }
    }

    return {
      totalContracts: stats.contractCount,
      totalRelationships: stats.relationshipCount,
      byType: stats.byType,
      byRepo: stats.byRepo,
      contractsWithInvariants,
      crossRepoRelationships,
    };
  }

  /**
   * Format impact analysis as a human-readable string
   */
  formatImpactAnalysis(impact: ImpactAnalysis): string {
    const lines: string[] = [];

    lines.push(`Contract: ${impact.contract.id}`);
    lines.push(`Type: ${impact.contract.type}`);

    if (impact.contract.location) {
      lines.push(`Location: ${formatLocation(impact.contract.location)}`);
    }

    if (impact.contract.schema) {
      lines.push(`Schema: ${JSON.stringify(impact.contract.schema)}`);
    }

    lines.push("");

    // Warnings
    if (impact.warnings.length > 0) {
      for (const warning of impact.warnings) {
        lines.push(warning);
      }
      lines.push("");
    }

    // Producers
    if (impact.producers.length > 0) {
      lines.push(`Producers (${impact.producers.length}):`);
      for (const producer of impact.producers) {
        const loc = producer.location
          ? ` @ ${formatLocation(producer.location)}`
          : "";
        lines.push(`  - ${producer.id}${loc}`);
      }
      lines.push("");
    }

    // Consumers
    if (impact.consumers.length > 0) {
      lines.push(`Consumers (${impact.consumers.length}):`);
      for (const consumer of impact.consumers) {
        const loc = consumer.location
          ? ` @ ${formatLocation(consumer.location)}`
          : "";
        lines.push(`  - ${consumer.id}${loc}`);
        for (const inv of consumer.invariants) {
          lines.push(`    Invariant: ${inv.description}`);
        }
      }
      lines.push("");
    }

    // Direct dependents
    if (impact.directDependents.length > 0) {
      lines.push(`Direct Dependents (${impact.directDependents.length}):`);
      for (const dep of impact.directDependents) {
        const loc = dep.location ? ` @ ${formatLocation(dep.location)}` : "";
        lines.push(`  - ${dep.id}${loc}`);
      }
      lines.push("");
    }

    // Cross-repo impacts
    if (impact.crossRepoImpacts.size > 0) {
      lines.push(`Cross-Repository Impacts:`);
      for (const [repo, contracts] of impact.crossRepoImpacts) {
        lines.push(`  ${repo}:`);
        for (const contract of contracts) {
          lines.push(`    - ${contract.id}`);
        }
      }
      lines.push("");
    }

    // Invariants to maintain
    if (impact.invariantsToMaintain.length > 0) {
      lines.push(`Invariants to Maintain:`);
      for (const inv of impact.invariantsToMaintain) {
        const severity =
          inv.severity === "error"
            ? "🔴"
            : inv.severity === "warning"
              ? "🟡"
              : "🔵";
        lines.push(`  ${severity} ${inv.description}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}
