/**
 * Prompt System - Main Exports
 * Modular Effect-based prompt building system
 */

// Core services
export { PromptService, PromptServiceLive } from "./prompt-service.js";
export { RulesService, RulesServiceLive } from "./rules-service.js";

// Types
export { SectionId, type BuildConfig, type Section, type SectionRegistry } from "./types.js";

// Errors
export { PromptBuildError, RulesLoadError } from "./errors.js";

// Utilities
export { resolveTemplate, extractPlaceholders } from "./template-resolver.js";

// Section registry
export { sectionRegistry, testAgentSectionOrder } from "./sections/index.js";

// Template
export { testAgentTemplate } from "./templates/test-agent-template.js";

// Re-export KnowledgeBasePromptFactory and PromptFactory
export { KnowledgeBasePromptFactory } from "./knowledge-base-prompts.js";
export { PromptFactory } from "./prompt-factory.js";


