/**
 * Builds Contract objects from parsed Mermaid diagrams with metadata.
 * Combines mermaid-parser and metadata-extractor to create the full graph.
 */

import {
  type Contract,
  type ContractType,
  createContract,
  parseLocation,
} from "../graph/contract.js";
import { ContractGraph } from "../graph/graph.js";
import {
  createRelationship,
  type RelationshipType,
} from "../graph/relationship.js";
import {
  extractAnnotations,
  groupCommentBlocks,
  extractNodeId,
  parseSchema,
  parseEndpointExposure,
  parseInvariants,
  parseErrors,
} from "./metadata-extractor.js";
import { parseMermaid, type MermaidEdge } from "./mermaid-parser.js";

/**
 * Result of building contracts from a file
 */
export interface BuildResult {
  graph: ContractGraph;
  errors: BuildError[];
  sourceFile: string;
}

/**
 * Error encountered during contract building
 */
export interface BuildError {
  message: string;
  line?: number;
  severity: "error" | "warning";
}

/**
 * Options for building contracts
 */
export interface BuildOptions {
  /** Base repository URL for @repo annotations */
  defaultRepo?: string;
  /** Validate that @location files exist */
  validateLocations?: boolean;
  /** Source file path for error reporting */
  sourceFile?: string;
}

/**
 * Infer contract type from metadata and node shape
 */
function inferContractType(
  nodeShape: string,
  metadata: ReturnType<typeof extractAnnotations>,
): ContractType {
  // Check for explicit type indicators in metadata
  if (metadata.exposes.length > 0) return "endpoint";
  if (metadata.publishes.length > 0 || metadata.consumes.length > 0)
    return "event";
  if (metadata.queue) return "queue";

  // Check for calls to external services
  if (metadata.calls.length > 0) return "service";

  // Infer from node shape
  switch (nodeShape) {
    case "cylinder":
      return "table";
    case "hexagon":
      return "event";
    case "stadium":
    case "subroutine":
      return "service";
    default:
      return "function";
  }
}

/**
 * Build a Contract from metadata and node info
 */
function buildContract(
  metadata: ReturnType<typeof extractAnnotations>,
  nodeId: string,
  nodeShape: string,
  _lineNum: number,
  options: BuildOptions,
): Contract {
  const contractId = metadata.contract || nodeId;
  const type = inferContractType(nodeShape, metadata);

  const contract = createContract(contractId, {
    type,
    nodeId,
    sourceFile: options.sourceFile,
  });

  // Parse location
  if (metadata.location) {
    contract.location = parseLocation(
      metadata.location,
      metadata.repo || options.defaultRepo,
    );
  }

  // Parse schema
  if (metadata.schema) {
    contract.schema = parseSchema(metadata.schema);
  }

  // Parse invariants
  contract.invariants = parseInvariants(metadata.invariants);

  // Parse errors
  contract.errors = parseErrors(metadata.errors);

  // Set version
  contract.version = metadata.version;

  // Set distributed system properties
  contract.publishes = metadata.publishes;
  contract.consumes = metadata.consumes;
  contract.calls = metadata.calls;
  contract.reads = metadata.reads;
  contract.writes = metadata.writes;
  contract.queue = metadata.queue;
  contract.repo = metadata.repo || options.defaultRepo;

  // Parse endpoint exposures
  for (const exposeStr of metadata.exposes) {
    const exposure = parseEndpointExposure(exposeStr);
    if (exposure) {
      contract.exposes.push(exposure);
    }
  }

  return contract;
}

/**
 * Determine relationship type from edge label
 */
function inferRelationshipType(label?: string): RelationshipType {
  if (!label) return "depends";

  const normalized = label.toLowerCase().trim();

  if (
    normalized.includes("write") ||
    normalized.includes("insert") ||
    normalized.includes("update")
  ) {
    return "writes";
  }
  if (
    normalized.includes("read") ||
    normalized.includes("select") ||
    normalized.includes("query")
  ) {
    return "reads";
  }
  if (
    normalized.includes("publish") ||
    normalized.includes("emit") ||
    normalized.includes("send")
  ) {
    return "publishes";
  }
  if (
    normalized.includes("consume") ||
    normalized.includes("subscribe") ||
    normalized.includes("receive")
  ) {
    return "consumes";
  }
  if (
    normalized.includes("call") ||
    normalized.includes("invoke") ||
    normalized.includes("request")
  ) {
    return "calls";
  }
  if (normalized.includes("expose")) {
    return "exposes";
  }

  return "depends";
}

/**
 * Build relationships from Mermaid edges
 */
function buildRelationships(
  edges: MermaidEdge[],
  nodeToContract: Map<string, string>,
): Array<{
  relationship: ReturnType<typeof createRelationship>;
  errors: BuildError[];
}> {
  const results: Array<{
    relationship: ReturnType<typeof createRelationship>;
    errors: BuildError[];
  }> = [];

  for (const edge of edges) {
    const errors: BuildError[] = [];
    const fromContract = nodeToContract.get(edge.from);
    const toContract = nodeToContract.get(edge.to);

    if (!fromContract) {
      errors.push({
        message: `Edge references unknown node: ${edge.from}`,
        line: edge.line,
        severity: "warning",
      });
    }

    if (!toContract) {
      errors.push({
        message: `Edge references unknown node: ${edge.to}`,
        line: edge.line,
        severity: "warning",
      });
    }

    if (fromContract && toContract) {
      const type = inferRelationshipType(edge.label);
      const relationship = createRelationship(
        fromContract,
        toContract,
        type,
        edge.label,
      );
      results.push({ relationship, errors });
    } else {
      results.push({
        relationship: createRelationship(edge.from, edge.to, "depends"),
        errors,
      });
    }
  }

  return results;
}

/**
 * Build contracts from a single Mermaid source
 */
export function buildFromMermaid(
  source: string,
  options: BuildOptions = {},
): BuildResult {
  const graph = new ContractGraph();
  const errors: BuildError[] = [];
  const sourceFile = options.sourceFile || "unknown";

  // Parse Mermaid
  const parsed = parseMermaid(source);

  // Group comment blocks with their following nodes
  const commentBlocks = groupCommentBlocks(parsed.lines);

  // Map node IDs to contract IDs for relationship building
  const nodeToContract = new Map<string, string>();

  // Process each comment block
  for (const block of commentBlocks) {
    const metadata = extractAnnotations(block.comments);

    // Skip blocks without @contract annotation
    if (!metadata.contract) continue;

    // Find the node this block is attached to
    const nodeLine = parsed.lines[block.nodeLineIndex];
    const nodeId = extractNodeId(nodeLine);

    if (!nodeId) {
      errors.push({
        message: `Could not find node ID for contract: ${metadata.contract}`,
        line: block.nodeLineIndex + 1,
        severity: "error",
      });
      continue;
    }

    // Find node shape from parsed nodes
    const parsedNode = parsed.nodes.find((n) => n.id === nodeId);
    const nodeShape = parsedNode?.shape || "rectangle";

    // Build the contract
    const contract = buildContract(
      metadata,
      nodeId,
      nodeShape,
      block.nodeLineIndex + 1,
      options,
    );

    graph.addContract(contract);
    nodeToContract.set(nodeId, contract.id);
  }

  // Also add implicit contracts for nodes referenced in edges but not explicitly defined
  for (const edge of parsed.edges) {
    for (const nodeId of [edge.from, edge.to]) {
      if (!nodeToContract.has(nodeId)) {
        // Check if there's a parsed node for this
        const parsedNode = parsed.nodes.find((n) => n.id === nodeId);
        if (parsedNode) {
          const contract = createContract(nodeId, {
            type: parsedNode.shape === "cylinder" ? "table" : "function",
            nodeId,
            sourceFile,
          });
          graph.addContract(contract);
          nodeToContract.set(nodeId, nodeId);
        }
      }
    }
  }

  // Build relationships from edges
  const relationshipResults = buildRelationships(parsed.edges, nodeToContract);

  for (const { relationship, errors: relErrors } of relationshipResults) {
    errors.push(...relErrors);

    // Only add relationship if both contracts exist
    if (
      graph.hasContract(relationship.from) &&
      graph.hasContract(relationship.to)
    ) {
      graph.addRelationship(relationship);
    }
  }

  // Also create relationships from contract metadata (publishes, consumes, etc.)
  for (const contract of graph.getAllContracts()) {
    // Create relationships for reads/writes
    for (const table of contract.reads) {
      if (graph.hasContract(table)) {
        graph.addRelationship(createRelationship(contract.id, table, "reads"));
      }
    }
    for (const table of contract.writes) {
      if (graph.hasContract(table)) {
        graph.addRelationship(createRelationship(contract.id, table, "writes"));
      }
    }
    // Create relationships for publishes/consumes
    for (const event of contract.publishes) {
      if (graph.hasContract(event)) {
        graph.addRelationship(
          createRelationship(contract.id, event, "publishes"),
        );
      }
    }
    for (const event of contract.consumes) {
      if (graph.hasContract(event)) {
        graph.addRelationship(
          createRelationship(contract.id, event, "consumes"),
        );
      }
    }
    // Create relationships for calls
    for (const service of contract.calls) {
      if (graph.hasContract(service)) {
        graph.addRelationship(
          createRelationship(contract.id, service, "calls"),
        );
      }
    }
  }

  return { graph, errors, sourceFile };
}

/**
 * Build contracts from multiple Mermaid sources
 */
export function buildFromMultipleSources(
  sources: Array<{ content: string; file: string }>,
  options: BuildOptions = {},
): BuildResult {
  const combinedGraph = new ContractGraph();
  const allErrors: BuildError[] = [];

  for (const { content, file } of sources) {
    const result = buildFromMermaid(content, { ...options, sourceFile: file });
    combinedGraph.merge(result.graph);
    allErrors.push(
      ...result.errors.map((e) => ({
        ...e,
        message: `[${file}] ${e.message}`,
      })),
    );
  }

  return {
    graph: combinedGraph,
    errors: allErrors,
    sourceFile: sources.map((s) => s.file).join(", "),
  };
}

/**
 * Extract Mermaid code blocks from a markdown file
 */
export function extractMermaidFromMarkdown(markdown: string): string[] {
  const blocks: string[] = [];
  const pattern = /```mermaid\n([\s\S]*?)```/g;
  let match;

  while ((match = pattern.exec(markdown)) !== null) {
    blocks.push(match[1]);
  }

  return blocks;
}

/**
 * Build contracts from a markdown file containing Mermaid blocks
 */
export function buildFromMarkdown(
  markdown: string,
  options: BuildOptions = {},
): BuildResult {
  const mermaidBlocks = extractMermaidFromMarkdown(markdown);

  if (mermaidBlocks.length === 0) {
    return {
      graph: new ContractGraph(),
      errors: [
        { message: "No Mermaid blocks found in markdown", severity: "warning" },
      ],
      sourceFile: options.sourceFile || "unknown",
    };
  }

  // Build from each block and merge
  const results = mermaidBlocks.map((block) =>
    buildFromMermaid(block, options),
  );

  const combinedGraph = new ContractGraph();
  const allErrors: BuildError[] = [];

  for (const result of results) {
    combinedGraph.merge(result.graph);
    allErrors.push(...result.errors);
  }

  return {
    graph: combinedGraph,
    errors: allErrors,
    sourceFile: options.sourceFile || "unknown",
  };
}
