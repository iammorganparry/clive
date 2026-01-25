/**
 * Section Registry
 * Exports all prompt sections and defines their default order
 *
 * Shared sections are imported from @clive/prompts
 * Extension-specific sections are defined locally
 */

// Shared sections from @clive/prompts package
import {
  conversation,
  frameworkGuides,
  iterativeTesting,
  knowledgeBase,
  patternDiscovery,
  qualityRules,
  sandbox,
  testEvaluation,
  testExecution,
  testUpdateDetection,
  verification,
  workflow,
} from "@clive/prompts/sections";
import { SectionId, type SectionRegistry } from "../types.js";

// Extension-specific sections (local)
import { agentRole } from "./agent-role.js";
import { agentRules } from "./agent-rules.js";
import { completionSignal } from "./completion-signal.js";
import { fileOperations } from "./file-operations.js";
import { regressionDetection } from "./regression-detection.js";
import { taskInstructions } from "./task-instructions.js";
import { workspaceContext } from "./workspace-context.js";

/**
 * Registry mapping section IDs to their builder functions
 */
export const sectionRegistry: SectionRegistry = {
  [SectionId.AgentRole]: agentRole,
  [SectionId.KnowledgeBase]: knowledgeBase,
  [SectionId.Workflow]: workflow,
  [SectionId.PatternDiscovery]: patternDiscovery,
  [SectionId.IterativeTesting]: iterativeTesting,
  [SectionId.TestUpdateDetection]: testUpdateDetection,
  [SectionId.RegressionDetection]: regressionDetection,
  [SectionId.TaskInstructions]: taskInstructions,
  [SectionId.AgentRules]: agentRules,
  [SectionId.CompletionSignal]: completionSignal,
  [SectionId.TestEvaluation]: testEvaluation,
  [SectionId.Conversation]: conversation,
  [SectionId.FrameworkGuides]: frameworkGuides,
  [SectionId.QualityRules]: qualityRules,
  [SectionId.WorkspaceContext]: workspaceContext,
  [SectionId.TestExecution]: testExecution,
  [SectionId.Sandbox]: sandbox,
  [SectionId.Verification]: verification,
  [SectionId.FileOperations]: fileOperations,
};

/**
 * Default order of sections in the test agent prompt
 */
export const testAgentSectionOrder: (typeof SectionId)[keyof typeof SectionId][] =
  [
    SectionId.AgentRole,
    SectionId.KnowledgeBase,
    SectionId.Workflow,
    SectionId.PatternDiscovery,
    SectionId.IterativeTesting,
    SectionId.TestUpdateDetection,
    SectionId.RegressionDetection,
    SectionId.TaskInstructions,
    SectionId.AgentRules,
    SectionId.CompletionSignal,
    SectionId.TestEvaluation,
    SectionId.Conversation,
    SectionId.FrameworkGuides,
    SectionId.QualityRules,
    SectionId.WorkspaceContext,
    SectionId.TestExecution,
    SectionId.Sandbox,
    SectionId.Verification,
    SectionId.FileOperations,
  ];
