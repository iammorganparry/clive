/**
 * Contract Validator - Validates contract definitions and detects issues
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Contract } from "../graph/contract.js";
import type { ContractGraph } from "../graph/graph.js";

/**
 * Types of validation errors
 */
export type ValidationErrorType =
  | "parse"
  | "missing_location"
  | "invalid_location"
  | "missing_schema"
  | "orphan_contract"
  | "circular_dependency"
  | "duplicate_contract"
  | "invalid_relationship"
  | "breaking";

/**
 * A validation error or warning
 */
export interface ValidationError {
  type: ValidationErrorType;
  message: string;
  severity: "error" | "warning";
  contractId?: string;
  file?: string;
  line?: number;
}

/**
 * Result of validation
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  summary: {
    totalContracts: number;
    totalRelationships: number;
    contractsWithInvariants: number;
    contractsWithLocations: number;
    crossRepoContracts: number;
  };
}

/**
 * Options for validation
 */
export interface ValidationOptions {
  /** Check that @location file paths exist */
  checkLocations?: boolean;
  /** Base directory for location checks */
  baseDir?: string;
  /** Require all contracts to have schemas */
  requireSchemas?: boolean;
  /** Require all contracts to have locations */
  requireLocations?: boolean;
  /** Warn about orphan contracts (no relationships) */
  warnOrphans?: boolean;
}

/**
 * Validate a contract graph
 */
export async function validateContracts(
  graph: ContractGraph,
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const contracts = graph.getAllContracts();
  const relationships = graph.getAllRelationships();

  // Track contract IDs for duplicate detection
  const seenIds = new Map<string, Contract>();

  for (const contract of contracts) {
    // Check for duplicate contract IDs
    const existing = seenIds.get(contract.id);
    if (existing) {
      errors.push({
        type: "duplicate_contract",
        message: `Duplicate contract ID: ${contract.id} (also defined in ${existing.sourceFile})`,
        severity: "error",
        contractId: contract.id,
        file: contract.sourceFile,
      });
    }
    seenIds.set(contract.id, contract);

    // Check for missing locations
    if (options.requireLocations && !contract.location) {
      errors.push({
        type: "missing_location",
        message: `Contract ${contract.id} is missing @location annotation`,
        severity: "warning",
        contractId: contract.id,
      });
    }

    // Check for missing schemas
    if (options.requireSchemas && !contract.schema) {
      errors.push({
        type: "missing_schema",
        message: `Contract ${contract.id} is missing @schema annotation`,
        severity: "warning",
        contractId: contract.id,
      });
    }

    // Validate location paths exist
    if (options.checkLocations && contract.location && options.baseDir) {
      const fullPath = join(options.baseDir, contract.location.file);
      if (!existsSync(fullPath)) {
        errors.push({
          type: "invalid_location",
          message: `Contract ${contract.id} references non-existent file: ${contract.location.file}`,
          severity: "warning",
          contractId: contract.id,
          file: contract.location.file,
          line: contract.location.line,
        });
      }
    }

    // Check for orphan contracts
    if (options.warnOrphans) {
      const hasRelationships =
        graph.getOutgoing(contract.id).length > 0 ||
        graph.getIncoming(contract.id).length > 0;

      if (!hasRelationships) {
        errors.push({
          type: "orphan_contract",
          message: `Contract ${contract.id} has no relationships to other contracts`,
          severity: "warning",
          contractId: contract.id,
        });
      }
    }
  }

  // Check for circular dependencies
  const circularDeps = detectCircularDependencies(graph);
  for (const cycle of circularDeps) {
    errors.push({
      type: "circular_dependency",
      message: `Circular dependency detected: ${cycle.join(" → ")}`,
      severity: "warning",
    });
  }

  // Validate relationships
  for (const rel of relationships) {
    if (!graph.hasContract(rel.from)) {
      errors.push({
        type: "invalid_relationship",
        message: `Relationship references unknown contract: ${rel.from}`,
        severity: "error",
      });
    }
    if (!graph.hasContract(rel.to)) {
      errors.push({
        type: "invalid_relationship",
        message: `Relationship references unknown contract: ${rel.to}`,
        severity: "error",
      });
    }
  }

  // Calculate summary
  const contractsWithInvariants = contracts.filter(
    (c) => c.invariants.length > 0,
  ).length;
  const contractsWithLocations = contracts.filter((c) => c.location).length;
  const crossRepoContracts = contracts.filter((c) => c.repo).length;

  const hasErrors = errors.some((e) => e.severity === "error");

  return {
    valid: !hasErrors,
    errors,
    summary: {
      totalContracts: contracts.length,
      totalRelationships: relationships.length,
      contractsWithInvariants,
      contractsWithLocations,
      crossRepoContracts,
    },
  };
}

/**
 * Detect circular dependencies in the graph
 */
function detectCircularDependencies(graph: ContractGraph): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(contractId: string): void {
    visited.add(contractId);
    recursionStack.add(contractId);
    path.push(contractId);

    const outgoing = graph.getOutgoing(contractId);
    for (const rel of outgoing) {
      if (!visited.has(rel.to)) {
        dfs(rel.to);
      } else if (recursionStack.has(rel.to)) {
        // Found a cycle
        const cycleStart = path.indexOf(rel.to);
        const cycle = [...path.slice(cycleStart), rel.to];
        cycles.push(cycle);
      }
    }

    path.pop();
    recursionStack.delete(contractId);
  }

  for (const contract of graph.getAllContracts()) {
    if (!visited.has(contract.id)) {
      dfs(contract.id);
    }
  }

  return cycles;
}

/**
 * Quick validation that only checks for errors (faster for CI)
 */
export function quickValidate(graph: ContractGraph): boolean {
  const contracts = graph.getAllContracts();
  const seenIds = new Set<string>();

  for (const contract of contracts) {
    if (seenIds.has(contract.id)) {
      return false;
    }
    seenIds.add(contract.id);
  }

  for (const rel of graph.getAllRelationships()) {
    if (!graph.hasContract(rel.from) || !graph.hasContract(rel.to)) {
      return false;
    }
  }

  return true;
}
