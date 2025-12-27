import type { Effect } from "effect";
import type { PromptBuildError } from "./errors.js";

/**
 * Identifiers for each prompt section
 */
export const SectionId = {
  AgentRole: "AGENT_ROLE",
  KnowledgeBase: "KNOWLEDGE_BASE",
  Scratchpad: "SCRATCHPAD",
  Workflow: "WORKFLOW",
  IterativeTesting: "ITERATIVE_TESTING",
  TaskInstructions: "TASK_INSTRUCTIONS",
  AgentRules: "AGENT_RULES",
  CompletionSignal: "COMPLETION_SIGNAL",
  TestEvaluation: "TEST_EVALUATION",
  Conversation: "CONVERSATION",
  FrameworkGuides: "FRAMEWORK_GUIDES",
  QualityRules: "QUALITY_RULES",
  WorkspaceContext: "WORKSPACE_CONTEXT",
  TestExecution: "TEST_EXECUTION",
  Sandbox: "SANDBOX",
  Verification: "VERIFICATION",
  FileOperations: "FILE_OPERATIONS",
} as const;

export type SectionId = (typeof SectionId)[keyof typeof SectionId];

/**
 * Configuration passed when building a prompt
 */
export interface BuildConfig {
  readonly workspaceRoot?: string;
  readonly mode?: "plan" | "act";
  readonly includeUserRules?: boolean;
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

