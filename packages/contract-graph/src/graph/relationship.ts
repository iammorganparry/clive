/**
 * Relationship types between contracts in the graph.
 * Edges represent how contracts depend on each other.
 */

/**
 * Types of relationships between contracts
 */
export type RelationshipType =
  /** Contract calls another contract/function */
  | "calls"
  /** Contract writes to a database/table */
  | "writes"
  /** Contract reads from a database/table */
  | "reads"
  /** Contract publishes an event/message */
  | "publishes"
  /** Contract consumes an event/message */
  | "consumes"
  /** Contract exposes an API endpoint */
  | "exposes"
  /** Generic dependency relationship */
  | "depends";

/**
 * An edge in the contract graph
 */
export interface Relationship {
  /** Source contract ID */
  from: string;
  /** Target contract ID */
  to: string;
  /** Type of relationship */
  type: RelationshipType;
  /** Optional label for the edge (displayed in diagrams) */
  label?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Create a relationship between two contracts
 */
export function createRelationship(
  from: string,
  to: string,
  type: RelationshipType,
  label?: string
): Relationship {
  return { from, to, type, label };
}

/**
 * Get the inverse relationship type (for bidirectional queries)
 */
export function inverseRelationship(type: RelationshipType): RelationshipType | null {
  switch (type) {
    case "publishes":
      return "consumes";
    case "consumes":
      return "publishes";
    case "writes":
      return "reads";
    case "reads":
      return "writes";
    case "calls":
      return "calls"; // bidirectional in terms of impact
    case "depends":
      return "depends";
    case "exposes":
      return null; // no inverse
    default:
      return null;
  }
}

/**
 * Check if a relationship type indicates a producer role
 */
export function isProducerRelationship(type: RelationshipType): boolean {
  return type === "publishes" || type === "writes" || type === "exposes";
}

/**
 * Check if a relationship type indicates a consumer role
 */
export function isConsumerRelationship(type: RelationshipType): boolean {
  return type === "consumes" || type === "reads" || type === "calls";
}

/**
 * Relationship type to human-readable description
 */
export function describeRelationship(type: RelationshipType): string {
  const descriptions: Record<RelationshipType, string> = {
    calls: "calls",
    writes: "writes to",
    reads: "reads from",
    publishes: "publishes",
    consumes: "consumes",
    exposes: "exposes",
    depends: "depends on",
  };
  return descriptions[type];
}
