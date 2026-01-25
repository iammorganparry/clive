/**
 * Prompt System - Main Exports
 * Modular Effect-based prompt building system
 */

// Errors
export { PromptBuildError, RulesLoadError } from "./errors.js";
// Re-export KnowledgeBasePromptFactory and PromptFactory
export { KnowledgeBasePromptFactory } from "./knowledge-base-prompts.js";
export { PromptFactory } from "./prompt-factory.js";
// Core services
export { PromptService, PromptServiceLive } from "./prompt-service.js";
export { RulesService, RulesServiceLive } from "./rules-service.js";

// Section registry
export { sectionRegistry, testAgentSectionOrder } from "./sections/index.js";
// Utilities
export { extractPlaceholders, resolveTemplate } from "./template-resolver.js";
// Template
export { testAgentTemplate } from "./templates/test-agent-template.js";
// Types
export {
  type BuildConfig,
  type Section,
  SectionId,
  type SectionRegistry,
} from "./types.js";
