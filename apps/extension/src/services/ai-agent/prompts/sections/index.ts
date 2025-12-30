/**
 * Section Registry
 * Exports all prompt sections and defines their default order
 */

import { SectionId, type SectionRegistry } from "../types.js";
import { agentRole } from "./agent-role.js";
import { agentRules } from "./agent-rules.js";
import { completionSignal } from "./completion-signal.js";
import { conversation } from "./conversation.js";
import { fileOperations } from "./file-operations.js";
import { frameworkGuides } from "./framework-guides.js";
import { iterativeTesting } from "./iterative-testing.js";
import { knowledgeBase } from "./knowledge-base.js";
import { patternDiscovery } from "./pattern-discovery.js";
import { qualityRules } from "./quality-rules.js";
import { sandbox } from "./sandbox.js";
import { taskInstructions } from "./task-instructions.js";
import { testEvaluation } from "./test-evaluation.js";
import { testExecution } from "./test-execution.js";
import { testUpdateDetection } from "./test-update-detection.js";
import { verification } from "./verification.js";
import { workflow } from "./workflow.js";
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
export const testAgentSectionOrder: typeof SectionId[keyof typeof SectionId][] =
  [
    SectionId.AgentRole,
    SectionId.KnowledgeBase,
    SectionId.Workflow,
    SectionId.PatternDiscovery,
    SectionId.IterativeTesting,
    SectionId.TestUpdateDetection,
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

