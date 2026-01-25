/**
 * Extracts contract metadata from Mermaid diagram comments.
 * Parses @annotations embedded in %% comments.
 */

import type {
  ContractSchema,
  EndpointExposure,
  ErrorContract,
  Invariant,
} from "../graph/contract.js";

/**
 * Raw metadata extracted from a Mermaid comment block
 */
export interface RawContractMetadata {
  contract?: string;
  location?: string;
  schema?: string;
  invariants: string[];
  errors: string[];
  version?: string;
  publishes: string[];
  consumes: string[];
  exposes: string[];
  calls: string[];
  reads: string[];
  writes: string[];
  queue?: string;
  repo?: string;
}

/**
 * Annotation pattern: @annotation value
 * Supports multi-word values and JSON
 */
const ANNOTATION_PATTERN = /^%%\s*@(\w+)\s+(.+)$/;

/**
 * Extract all annotations from a block of Mermaid comments
 */
export function extractAnnotations(lines: string[]): RawContractMetadata {
  const metadata: RawContractMetadata = {
    invariants: [],
    errors: [],
    publishes: [],
    consumes: [],
    exposes: [],
    calls: [],
    reads: [],
    writes: [],
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(ANNOTATION_PATTERN);
    if (!match) continue;

    const [, annotation, value] = match;
    const key = annotation.toLowerCase();

    switch (key) {
      case "contract":
        metadata.contract = value.trim();
        break;
      case "location":
        metadata.location = value.trim();
        break;
      case "schema":
        metadata.schema = value.trim();
        break;
      case "invariant":
        metadata.invariants.push(value.trim());
        break;
      case "error":
        // Can be comma-separated list
        metadata.errors.push(...value.split(",").map((e) => e.trim()));
        break;
      case "version":
        metadata.version = value.trim();
        break;
      case "publishes":
        metadata.publishes.push(value.trim());
        break;
      case "consumes":
        metadata.consumes.push(value.trim());
        break;
      case "exposes":
        metadata.exposes.push(value.trim());
        break;
      case "calls":
        metadata.calls.push(value.trim());
        break;
      case "reads":
        // Can be comma-separated list
        metadata.reads.push(...value.split(",").map((e) => e.trim()));
        break;
      case "writes":
        // Can be comma-separated list
        metadata.writes.push(...value.split(",").map((e) => e.trim()));
        break;
      case "queue":
        metadata.queue = value.trim();
        break;
      case "repo":
        metadata.repo = value.trim();
        break;
    }
  }

  return metadata;
}

/**
 * Parse a schema string (JSON or simple type reference)
 */
export function parseSchema(schemaStr: string): ContractSchema | undefined {
  if (!schemaStr) return undefined;

  // Try to parse as JSON
  try {
    const parsed = JSON.parse(schemaStr);
    return parsed as ContractSchema;
  } catch {
    // Not JSON, treat as simple type reference
    return { output: schemaStr };
  }
}

/**
 * Parse an endpoint exposure string like "POST /api/users"
 */
export function parseEndpointExposure(
  exposeStr: string,
): EndpointExposure | undefined {
  const parts = exposeStr.split(/\s+/);
  if (parts.length < 2) return undefined;

  const method = parts[0].toUpperCase() as EndpointExposure["method"];
  const validMethods = [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "HEAD",
    "OPTIONS",
  ];
  if (!validMethods.includes(method)) return undefined;

  const path = parts.slice(1).join(" ");
  return { method, path };
}

/**
 * Parse invariant strings into structured invariants
 */
export function parseInvariants(invariantStrs: string[]): Invariant[] {
  return invariantStrs.map((str) => {
    // Check for severity prefix like "[error]" or "[warning]"
    const severityMatch = str.match(/^\[(error|warning|info)\]\s*/i);
    let severity: Invariant["severity"] = "error";
    let description = str;

    if (severityMatch) {
      severity = severityMatch[1].toLowerCase() as Invariant["severity"];
      description = str.slice(severityMatch[0].length);
    }

    return { description, severity };
  });
}

/**
 * Parse error strings into structured error contracts
 */
export function parseErrors(errorStrs: string[]): ErrorContract[] {
  return errorStrs.map((str) => {
    // Check for description after colon
    const colonIndex = str.indexOf(":");
    if (colonIndex > 0) {
      return {
        name: str.slice(0, colonIndex).trim(),
        description: str.slice(colonIndex + 1).trim(),
      };
    }
    return { name: str.trim() };
  });
}

/**
 * Group consecutive comment lines that belong to the same contract
 */
export function groupCommentBlocks(
  lines: string[],
): Array<{ comments: string[]; nodeLineIndex: number }> {
  const blocks: Array<{ comments: string[]; nodeLineIndex: number }> = [];
  let currentComments: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("%%")) {
      currentComments.push(line);
    } else if (currentComments.length > 0) {
      // Check if this line contains a node definition
      if (
        line &&
        !line.startsWith("%%") &&
        !line.startsWith("subgraph") &&
        !line.startsWith("end")
      ) {
        blocks.push({
          comments: [...currentComments],
          nodeLineIndex: i,
        });
      }
      currentComments = [];
    }
  }

  return blocks;
}

/**
 * Extract the node ID from a Mermaid node definition line
 */
export function extractNodeId(line: string): string | undefined {
  // Match various node syntaxes:
  // - nodeName[label]
  // - nodeName([label])
  // - nodeName{label}
  // - nodeName{{label}}
  // - nodeName[(label)]
  // - nodeName((label))
  // - nodeName>label]
  // - nodeName
  const nodeMatch = line.match(/^\s*(\w+)[\s\[\(\{<>]/);
  if (nodeMatch) {
    return nodeMatch[1];
  }

  // Just a bare node name
  const bareMatch = line.match(/^\s*(\w+)\s*$/);
  if (bareMatch) {
    return bareMatch[1];
  }

  return undefined;
}
