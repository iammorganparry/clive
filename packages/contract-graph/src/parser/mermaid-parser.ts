/**
 * Parses Mermaid diagram syntax to extract graph structure.
 * Handles flowchart/graph, subgraphs, and edge definitions.
 */

/**
 * Types of Mermaid diagrams we support
 */
export type DiagramType = "graph" | "flowchart";

/**
 * Direction of the graph
 */
export type GraphDirection = "TB" | "TD" | "BT" | "RL" | "LR";

/**
 * Node shape types in Mermaid
 */
export type NodeShape =
  | "rectangle"
  | "rounded"
  | "stadium"
  | "subroutine"
  | "cylinder"
  | "circle"
  | "asymmetric"
  | "rhombus"
  | "hexagon"
  | "parallelogram"
  | "trapezoid"
  | "double_circle";

/**
 * A node in the Mermaid diagram
 */
export interface MermaidNode {
  id: string;
  label: string;
  shape: NodeShape;
  /** Line number in the source file (1-indexed) */
  line: number;
}

/**
 * An edge in the Mermaid diagram
 */
export interface MermaidEdge {
  from: string;
  to: string;
  label?: string;
  style?: "solid" | "dotted" | "thick";
  /** Line number in the source file */
  line: number;
}

/**
 * A subgraph grouping nodes
 */
export interface MermaidSubgraph {
  id: string;
  label: string;
  nodes: string[];
  /** Line number where subgraph starts */
  line: number;
}

/**
 * Parsed Mermaid diagram
 */
export interface ParsedMermaid {
  type: DiagramType;
  direction: GraphDirection;
  nodes: MermaidNode[];
  edges: MermaidEdge[];
  subgraphs: MermaidSubgraph[];
  /** Raw lines for comment extraction */
  lines: string[];
}

/**
 * Shape detection patterns
 */
const SHAPE_PATTERNS: Array<{
  pattern: RegExp;
  shape: NodeShape;
  extractLabel: (match: RegExpMatchArray) => string;
}> = [
  // Stadium shape: ([label])
  {
    pattern: /\(\[(.+)\]\)/,
    shape: "stadium",
    extractLabel: (m) => m[1],
  },
  // Cylinder: [(label)]
  {
    pattern: /\[\((.+)\)\]/,
    shape: "cylinder",
    extractLabel: (m) => m[1],
  },
  // Double circle: (((label)))
  {
    pattern: /\(\(\((.+)\)\)\)/,
    shape: "double_circle",
    extractLabel: (m) => m[1],
  },
  // Circle: ((label))
  {
    pattern: /\(\((.+)\)\)/,
    shape: "circle",
    extractLabel: (m) => m[1],
  },
  // Subroutine: [[label]]
  {
    pattern: /\[\[(.+)\]\]/,
    shape: "subroutine",
    extractLabel: (m) => m[1],
  },
  // Hexagon: {{label}}
  {
    pattern: /\{\{(.+)\}\}/,
    shape: "hexagon",
    extractLabel: (m) => m[1],
  },
  // Rhombus: {label}
  {
    pattern: /\{(.+)\}/,
    shape: "rhombus",
    extractLabel: (m) => m[1],
  },
  // Asymmetric: >label]
  {
    pattern: />(.+)\]/,
    shape: "asymmetric",
    extractLabel: (m) => m[1],
  },
  // Rounded: (label)
  {
    pattern: /\((.+)\)/,
    shape: "rounded",
    extractLabel: (m) => m[1],
  },
  // Rectangle: [label]
  {
    pattern: /\[(.+)\]/,
    shape: "rectangle",
    extractLabel: (m) => m[1],
  },
];

/**
 * Edge detection patterns
 */
const EDGE_PATTERNS = [
  // Arrow with label: A -->|label| B or A -- label --> B
  /^(\w+)\s*(--+>?|\.\.\.>?|===?>?|-\.->?)\|([^|]+)\|\s*(\w+)/,
  /^(\w+)\s*--\s*([^-]+)\s*-->\s*(\w+)/,
  // Simple arrows: A --> B, A --- B, A -.-> B, A ==> B
  /^(\w+)\s*(--+>?|\.\.\.>?|===?>?|-\.->?)\s*(\w+)/,
];

/**
 * Parse the graph/flowchart declaration line
 */
function parseDeclaration(line: string): {
  type: DiagramType;
  direction: GraphDirection;
} | null {
  const match = line.match(/^\s*(graph|flowchart)\s+(TB|TD|BT|RL|LR)?\s*$/i);
  if (!match) return null;

  return {
    type: match[1].toLowerCase() as DiagramType,
    direction: (match[2]?.toUpperCase() as GraphDirection) || "TB",
  };
}

/**
 * Parse a node definition from a line
 */
function parseNode(line: string, lineNum: number): MermaidNode | null {
  const trimmed = line.trim();

  // Skip comments, subgraphs, ends, and empty lines
  if (
    !trimmed ||
    trimmed.startsWith("%%") ||
    trimmed.startsWith("subgraph") ||
    trimmed === "end"
  ) {
    return null;
  }

  // Skip lines that are only edges (contain --> or similar but no node def)
  if (/^\s*\w+\s*--/.test(trimmed) && !/\[|\(|\{|>/.test(trimmed.split("-->")[0])) {
    return null;
  }

  // Extract node ID (first word before any shape markers)
  const idMatch = trimmed.match(/^(\w+)/);
  if (!idMatch) return null;

  const id = idMatch[1];
  let label = id;
  let shape: NodeShape = "rectangle";

  // Try to match each shape pattern
  for (const { pattern, shape: s, extractLabel } of SHAPE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      shape = s;
      label = extractLabel(match);
      break;
    }
  }

  return { id, label, shape, line: lineNum };
}

/**
 * Parse an edge definition from a line
 */
function parseEdge(line: string, lineNum: number): MermaidEdge | null {
  const trimmed = line.trim();

  // Try each edge pattern
  for (const pattern of EDGE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      // Pattern with label in |label|
      if (match.length === 5) {
        const style = getEdgeStyle(match[2]);
        return {
          from: match[1],
          to: match[4],
          label: match[3],
          style,
          line: lineNum,
        };
      }
      // Pattern with label between -- label -->
      if (match.length === 4 && match[2].includes("label")) {
        return {
          from: match[1],
          to: match[3],
          label: match[2].trim(),
          style: "solid",
          line: lineNum,
        };
      }
      // Simple pattern without label
      if (match.length >= 3) {
        const style = getEdgeStyle(match[2]);
        return {
          from: match[1],
          to: match[match.length - 1],
          style,
          line: lineNum,
        };
      }
    }
  }

  return null;
}

/**
 * Determine edge style from the arrow syntax
 */
function getEdgeStyle(arrow: string): "solid" | "dotted" | "thick" {
  if (arrow.includes("=")) return "thick";
  if (arrow.includes(".")) return "dotted";
  return "solid";
}

/**
 * Parse subgraph definitions
 */
function parseSubgraph(
  lines: string[],
  startIndex: number
): { subgraph: MermaidSubgraph; endIndex: number } | null {
  const line = lines[startIndex].trim();
  const match = line.match(/^\s*subgraph\s+(\w+)(?:\[([^\]]+)\])?/);
  if (!match) return null;

  const id = match[1];
  const label = match[2] || id;
  const nodes: string[] = [];
  let endIndex = startIndex + 1;

  // Collect nodes until we hit "end"
  for (let i = startIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "end") {
      endIndex = i;
      break;
    }

    const node = parseNode(lines[i], i + 1);
    if (node) {
      nodes.push(node.id);
    }
  }

  return {
    subgraph: { id, label, nodes, line: startIndex + 1 },
    endIndex,
  };
}

/**
 * Parse a complete Mermaid diagram
 */
export function parseMermaid(source: string): ParsedMermaid {
  const lines = source.split("\n");
  const result: ParsedMermaid = {
    type: "graph",
    direction: "TB",
    nodes: [],
    edges: [],
    subgraphs: [],
    lines,
  };

  const nodeIds = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("%%")) continue;

    // Parse declaration
    const declaration = parseDeclaration(trimmed);
    if (declaration) {
      result.type = declaration.type;
      result.direction = declaration.direction;
      continue;
    }

    // Parse subgraph
    if (trimmed.startsWith("subgraph")) {
      const subgraphResult = parseSubgraph(lines, i);
      if (subgraphResult) {
        result.subgraphs.push(subgraphResult.subgraph);
        i = subgraphResult.endIndex;
        continue;
      }
    }

    // Parse edge (check before node to avoid false positives)
    const edge = parseEdge(trimmed, i + 1);
    if (edge) {
      result.edges.push(edge);
      // Also collect node IDs from edges
      nodeIds.add(edge.from);
      nodeIds.add(edge.to);
      continue;
    }

    // Parse node
    const node = parseNode(line, i + 1);
    if (node && !nodeIds.has(node.id)) {
      result.nodes.push(node);
      nodeIds.add(node.id);
    }
  }

  return result;
}

/**
 * Find the node definition that follows a comment block
 */
export function findNodeAfterComments(
  lines: string[],
  commentEndLine: number
): MermaidNode | null {
  for (let i = commentEndLine; i < lines.length; i++) {
    const node = parseNode(lines[i], i + 1);
    if (node) return node;

    // If we hit a non-comment, non-empty line that isn't a node, stop
    const trimmed = lines[i].trim();
    if (trimmed && !trimmed.startsWith("%%")) break;
  }
  return null;
}
