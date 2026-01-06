import type { Effect } from "effect";
import type { PromptBuildError } from "./errors.js";

/**
 * Identifiers for shared prompt sections
 */
export const SectionId = {
  KnowledgeBase: "KNOWLEDGE_BASE",
  Workflow: "WORKFLOW",
  PatternDiscovery: "PATTERN_DISCOVERY",
  IterativeTesting: "ITERATIVE_TESTING",
  TestUpdateDetection: "TEST_UPDATE_DETECTION",
  TestEvaluation: "TEST_EVALUATION",
  Conversation: "CONVERSATION",
  FrameworkGuides: "FRAMEWORK_GUIDES",
  QualityRules: "QUALITY_RULES",
  TestExecution: "TEST_EXECUTION",
  Sandbox: "SANDBOX",
  Verification: "VERIFICATION",
} as const;

export type SectionId = (typeof SectionId)[keyof typeof SectionId];

/**
 * Configuration passed when building a prompt
 */
export interface BuildConfig {
  readonly workspaceRoot?: string;
  readonly mode?: "plan" | "act";
  readonly planFilePath?: string;
  readonly aiProvider?: "claude-cli" | "anthropic" | "gateway";
}

/**
 * A section returns an Effect yielding its content string
 */
export type Section = (
  config: BuildConfig,
) => Effect.Effect<string, PromptBuildError, never>;

/**
 * Registry mapping section IDs to their implementations
 */
export type SectionRegistry = Record<SectionId, Section>;
