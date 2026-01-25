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

export {
  type AnnotateOptions,
  type AnnotationResult,
  annotateSourceFiles,
  formatAnnotationResults,
  injectAnnotation,
} from "./generators/code-annotator.js";
// Generators
export {
  generateClaudeMd,
  generateMarkdownDocs,
} from "./generators/markdown.js";
// Core graph types and utilities
export {
  type CodeLocation,
  type Contract,
  type ContractSchema,
  type ContractType,
  createContract,
  type EndpointExposure,
  type ErrorContract,
  formatLocation,
  type Invariant,
  parseLocation,
} from "./graph/contract.js";
export {
  ContractGraph,
  type TraversalOptions,
  type TraversalResult,
} from "./graph/graph.js";
export {
  createRelationship,
  describeRelationship,
  inverseRelationship,
  isConsumerRelationship,
  isProducerRelationship,
  type Relationship,
  type RelationshipType,
} from "./graph/relationship.js";

export {
  type BuildError,
  type BuildOptions,
  type BuildResult,
  buildFromMarkdown,
  buildFromMermaid,
  buildFromMultipleSources,
  extractMermaidFromMarkdown,
} from "./parser/contract-builder.js";
// Parser
export {
  type MermaidEdge,
  type MermaidNode,
  type MermaidSubgraph,
  type ParsedMermaid,
  parseMermaid,
} from "./parser/mermaid-parser.js";
export {
  extractAnnotations,
  parseEndpointExposure,
  parseErrors,
  parseInvariants,
  parseSchema,
  type RawContractMetadata,
} from "./parser/metadata-extractor.js";
// Query engine
export {
  type ImpactAnalysis,
  type ImpactOptions,
  type LocationQueryResult,
  QueryEngine,
} from "./query/engine.js";
export {
  type BreakingChange,
  type BreakingSeverity,
  type DeploymentOrder,
  type GraphDiff,
  ImpactAnalyzer,
} from "./query/impact-analyzer.js";
export {
  type BreakingChangeSeverity,
  type BreakingChangeType,
  detectBreakingChanges,
  formatBreakingChange,
  generateBreakingChangesReport,
  hasCriticalBreakingChanges,
} from "./validators/breaking-changes.js";
// Validators
export {
  quickValidate,
  type ValidationError,
  type ValidationErrorType,
  type ValidationOptions,
  type ValidationResult,
  validateContracts,
} from "./validators/contract-validator.js";
