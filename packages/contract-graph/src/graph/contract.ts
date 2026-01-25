/**
 * Core contract type definitions for the Contract Graph system.
 * These types represent the structure of contracts as defined in Mermaid diagrams.
 */

/**
 * Location in source code where a contract is implemented
 */
export interface CodeLocation {
  /** File path relative to repository root */
  file: string;
  /** Line number (1-indexed) */
  line?: number;
  /** Column number (1-indexed) */
  column?: number;
  /** Repository URL for cross-repo contracts */
  repo?: string;
}

/**
 * Schema definition for a contract's input/output
 */
export interface ContractSchema {
  /** Input type or schema */
  input?: string | Record<string, unknown>;
  /** Output type or schema */
  output?: string | Record<string, unknown>;
  /** For database tables */
  table?: string;
  /** Primary key field */
  pk?: string;
  /** Additional schema fields */
  [key: string]: unknown;
}

/**
 * An invariant that must be maintained by the contract
 */
export interface Invariant {
  /** Human-readable description of the invariant */
  description: string;
  /** Severity level */
  severity: "error" | "warning" | "info";
}

/**
 * Error that a contract can produce
 */
export interface ErrorContract {
  /** Error name/type */
  name: string;
  /** Description of when this error occurs */
  description?: string;
}

/**
 * Types of contracts in the system
 */
export type ContractType =
  | "function"
  | "endpoint"
  | "event"
  | "table"
  | "queue"
  | "service"
  | "external";

/**
 * HTTP/gRPC endpoint exposure
 */
export interface EndpointExposure {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
  path: string;
}

/**
 * A contract represents a documented agreement between system components
 */
export interface Contract {
  /** Unique identifier (e.g., "UserService.createUser") */
  id: string;
  /** Type of contract */
  type: ContractType;
  /** Source code location */
  location?: CodeLocation;
  /** Contract schema */
  schema?: ContractSchema;
  /** Business invariants */
  invariants: Invariant[];
  /** Possible errors */
  errors: ErrorContract[];
  /** Contract version */
  version?: string;

  // Distributed system properties
  /** Events/messages this contract publishes */
  publishes: string[];
  /** Events/messages this contract consumes */
  consumes: string[];
  /** HTTP endpoints this contract exposes */
  exposes: EndpointExposure[];
  /** External services this contract calls */
  calls: string[];
  /** Database tables/collections this contract reads */
  reads: string[];
  /** Database tables/collections this contract writes */
  writes: string[];
  /** Message queue this contract uses */
  queue?: string;
  /** Repository this contract belongs to */
  repo?: string;

  /** Mermaid node ID for linking back to diagram */
  nodeId?: string;
  /** Source file where contract is defined */
  sourceFile?: string;
}

/**
 * Create a new contract with default values
 */
export function createContract(
  id: string,
  partial?: Partial<Contract>,
): Contract {
  return {
    id,
    type: "function",
    invariants: [],
    errors: [],
    publishes: [],
    consumes: [],
    exposes: [],
    calls: [],
    reads: [],
    writes: [],
    ...partial,
  };
}

/**
 * Parse a location string like "src/file.ts:42:10" into a CodeLocation
 */
export function parseLocation(
  locationStr: string,
  repo?: string,
): CodeLocation {
  const parts = locationStr.split(":");
  const file = parts[0];
  const line = parts[1] ? parseInt(parts[1], 10) : undefined;
  const column = parts[2] ? parseInt(parts[2], 10) : undefined;

  return { file, line, column, repo };
}

/**
 * Format a CodeLocation as a string
 */
export function formatLocation(location: CodeLocation): string {
  let result = location.file;
  if (location.line !== undefined) {
    result += `:${location.line}`;
    if (location.column !== undefined) {
      result += `:${location.column}`;
    }
  }
  if (location.repo) {
    result = `${location.repo} → ${result}`;
  }
  return result;
}
