/**
 * Contract Graph - AI-aware contract testing framework
 *
 * This package provides tools for defining, parsing, and querying contracts
 * between system components using Mermaid diagrams with embedded metadata.
 *
 * @example
 * ```typescript
 * import { buildFromMarkdown, QueryEngine } from '@clive/contract-graph';
 *
 * const markdown = `
 * \`\`\`mermaid
 * graph TB
 *     %% @contract User.create
 *     %% @location src/users/create.ts:10
 *     %% @invariant email must be unique
 *     createUser[createUser]
 * \`\`\`
 * `;
 *
 * const { graph } = buildFromMarkdown(markdown);
 * const engine = new QueryEngine(graph);
 *
 * // Query contracts for a file
 * const result = engine.contractsFor('src/users/create.ts');
 * console.log(result.invariants);
 *
 * // Analyze impact of changes
 * const impact = engine.impactOf('User.create');
 * console.log(impact?.warnings);
 * ```
 */

// Core graph types and utilities
export {
  type Contract,
  type CodeLocation,
  type ContractSchema,
  type Invariant,
  type ErrorContract,
  type ContractType,
  type EndpointExposure,
  createContract,
  parseLocation,
  formatLocation,
} from "./graph/contract.js";

export {
  type Relationship,
  type RelationshipType,
  createRelationship,
  inverseRelationship,
  isProducerRelationship,
  isConsumerRelationship,
  describeRelationship,
} from "./graph/relationship.js";

export {
  ContractGraph,
  type TraversalResult,
  type TraversalOptions,
} from "./graph/graph.js";

// Parser
export {
  parseMermaid,
  type ParsedMermaid,
  type MermaidNode,
  type MermaidEdge,
  type MermaidSubgraph,
} from "./parser/mermaid-parser.js";

export {
  extractAnnotations,
  parseSchema,
  parseEndpointExposure,
  parseInvariants,
  parseErrors,
  type RawContractMetadata,
} from "./parser/metadata-extractor.js";

export {
  buildFromMermaid,
  buildFromMarkdown,
  buildFromMultipleSources,
  extractMermaidFromMarkdown,
  type BuildResult,
  type BuildError,
  type BuildOptions,
} from "./parser/contract-builder.js";

// Query engine
export {
  QueryEngine,
  type ImpactAnalysis,
  type LocationQueryResult,
  type ImpactOptions,
} from "./query/engine.js";

export {
  ImpactAnalyzer,
  type BreakingChange,
  type BreakingSeverity,
  type DeploymentOrder,
  type GraphDiff,
} from "./query/impact-analyzer.js";

// Validators
export {
  validateContracts,
  quickValidate,
  type ValidationResult,
  type ValidationError,
  type ValidationErrorType,
  type ValidationOptions,
} from "./validators/contract-validator.js";

export {
  detectBreakingChanges,
  formatBreakingChange,
  hasCriticalBreakingChanges,
  generateBreakingChangesReport,
  type BreakingChangeType,
  type BreakingChangeSeverity,
} from "./validators/breaking-changes.js";

// Generators
export {
  generateMarkdownDocs,
  generateClaudeMd,
} from "./generators/markdown.js";

export {
  annotateSourceFiles,
  injectAnnotation,
  formatAnnotationResults,
  type AnnotateOptions,
  type AnnotationResult,
} from "./generators/code-annotator.js";
