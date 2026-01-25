/**
 * In-memory directed graph representing contract relationships.
 * Provides efficient traversal for impact analysis and dependency queries.
 */

import type { Contract } from "./contract.js";
import type { Relationship, RelationshipType } from "./relationship.js";

/**
 * Result of traversing the graph
 */
export interface TraversalResult {
  /** Contracts visited in order */
  contracts: Contract[];
  /** Relationships traversed */
  relationships: Relationship[];
  /** Depth at which each contract was found */
  depths: Map<string, number>;
}

/**
 * Options for graph traversal
 */
export interface TraversalOptions {
  /** Maximum depth to traverse (default: Infinity) */
  maxDepth?: number;
  /** Relationship types to follow (default: all) */
  relationshipTypes?: RelationshipType[];
  /** Direction of traversal */
  direction?: "outgoing" | "incoming" | "both";
  /** Filter function for contracts */
  filter?: (contract: Contract) => boolean;
}

/**
 * The Contract Graph - stores contracts and their relationships
 */
export class ContractGraph {
  private contracts: Map<string, Contract> = new Map();
  private outgoing: Map<string, Relationship[]> = new Map();
  private incoming: Map<string, Relationship[]> = new Map();

  /**
   * Add a contract to the graph
   */
  addContract(contract: Contract): void {
    this.contracts.set(contract.id, contract);
    if (!this.outgoing.has(contract.id)) {
      this.outgoing.set(contract.id, []);
    }
    if (!this.incoming.has(contract.id)) {
      this.incoming.set(contract.id, []);
    }
  }

  /**
   * Get a contract by ID
   */
  getContract(id: string): Contract | undefined {
    return this.contracts.get(id);
  }

  /**
   * Check if a contract exists
   */
  hasContract(id: string): boolean {
    return this.contracts.has(id);
  }

  /**
   * Get all contracts
   */
  getAllContracts(): Contract[] {
    return Array.from(this.contracts.values());
  }

  /**
   * Add a relationship between contracts
   */
  addRelationship(relationship: Relationship): void {
    // Ensure both contracts exist
    if (!this.contracts.has(relationship.from)) {
      throw new Error(`Contract not found: ${relationship.from}`);
    }
    if (!this.contracts.has(relationship.to)) {
      throw new Error(`Contract not found: ${relationship.to}`);
    }

    // Add to outgoing edges
    const outEdges = this.outgoing.get(relationship.from) || [];
    outEdges.push(relationship);
    this.outgoing.set(relationship.from, outEdges);

    // Add to incoming edges
    const inEdges = this.incoming.get(relationship.to) || [];
    inEdges.push(relationship);
    this.incoming.set(relationship.to, inEdges);
  }

  /**
   * Get outgoing relationships from a contract
   */
  getOutgoing(contractId: string): Relationship[] {
    return this.outgoing.get(contractId) || [];
  }

  /**
   * Get incoming relationships to a contract
   */
  getIncoming(contractId: string): Relationship[] {
    return this.incoming.get(contractId) || [];
  }

  /**
   * Get all relationships
   */
  getAllRelationships(): Relationship[] {
    const relationships: Relationship[] = [];
    for (const edges of this.outgoing.values()) {
      relationships.push(...edges);
    }
    return relationships;
  }

  /**
   * Traverse the graph starting from a contract
   */
  traverse(startId: string, options: TraversalOptions = {}): TraversalResult {
    const {
      maxDepth = Infinity,
      relationshipTypes,
      direction = "outgoing",
      filter,
    } = options;

    const visited = new Set<string>();
    const depths = new Map<string, number>();
    const contracts: Contract[] = [];
    const relationships: Relationship[] = [];

    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;

      if (visited.has(id) || depth > maxDepth) {
        continue;
      }

      const contract = this.contracts.get(id);
      if (!contract) {
        continue;
      }

      if (filter && !filter(contract)) {
        continue;
      }

      visited.add(id);
      depths.set(id, depth);
      contracts.push(contract);

      // Get edges based on direction
      let edges: Relationship[] = [];
      if (direction === "outgoing" || direction === "both") {
        edges = edges.concat(this.outgoing.get(id) || []);
      }
      if (direction === "incoming" || direction === "both") {
        edges = edges.concat(this.incoming.get(id) || []);
      }

      // Filter by relationship type if specified
      if (relationshipTypes) {
        edges = edges.filter((e) => relationshipTypes.includes(e.type));
      }

      for (const edge of edges) {
        relationships.push(edge);
        const nextId = edge.from === id ? edge.to : edge.from;
        if (!visited.has(nextId)) {
          queue.push({ id: nextId, depth: depth + 1 });
        }
      }
    }

    return { contracts, relationships, depths };
  }

  /**
   * Find all contracts that depend on the given contract
   */
  findDependents(contractId: string): Contract[] {
    const result = this.traverse(contractId, { direction: "incoming" });
    return result.contracts.filter((c) => c.id !== contractId);
  }

  /**
   * Find all contracts that the given contract depends on
   */
  findDependencies(contractId: string): Contract[] {
    const result = this.traverse(contractId, { direction: "outgoing" });
    return result.contracts.filter((c) => c.id !== contractId);
  }

  /**
   * Find contracts by file path
   */
  findByFile(filePath: string): Contract[] {
    return this.getAllContracts().filter(
      (c) => c.location?.file === filePath || c.location?.file.endsWith(filePath)
    );
  }

  /**
   * Find contracts by repository
   */
  findByRepo(repo: string): Contract[] {
    return this.getAllContracts().filter((c) => c.repo === repo);
  }

  /**
   * Find producers of an event/resource
   */
  findProducers(resourceId: string): Contract[] {
    const incoming = this.getIncoming(resourceId);
    return incoming
      .filter((r) => r.type === "publishes" || r.type === "writes")
      .map((r) => this.contracts.get(r.from))
      .filter((c): c is Contract => c !== undefined);
  }

  /**
   * Find consumers of an event/resource
   */
  findConsumers(resourceId: string): Contract[] {
    const incoming = this.getIncoming(resourceId);
    return incoming
      .filter((r) => r.type === "consumes" || r.type === "reads")
      .map((r) => this.contracts.get(r.from))
      .filter((c): c is Contract => c !== undefined);
  }

  /**
   * Get graph statistics
   */
  getStats(): {
    contractCount: number;
    relationshipCount: number;
    byType: Record<string, number>;
    byRepo: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    const byRepo: Record<string, number> = {};

    for (const contract of this.contracts.values()) {
      byType[contract.type] = (byType[contract.type] || 0) + 1;
      if (contract.repo) {
        byRepo[contract.repo] = (byRepo[contract.repo] || 0) + 1;
      }
    }

    return {
      contractCount: this.contracts.size,
      relationshipCount: this.getAllRelationships().length,
      byType,
      byRepo,
    };
  }

  /**
   * Clear all data from the graph
   */
  clear(): void {
    this.contracts.clear();
    this.outgoing.clear();
    this.incoming.clear();
  }

  /**
   * Merge another graph into this one
   */
  merge(other: ContractGraph): void {
    for (const contract of other.getAllContracts()) {
      this.addContract(contract);
    }
    for (const relationship of other.getAllRelationships()) {
      try {
        this.addRelationship(relationship);
      } catch {
        // Ignore duplicate relationships
      }
    }
  }
}
