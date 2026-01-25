/**
 * @clive/prompts - Shared prompt sections for Clive testing agents
 *
 * This package provides reusable prompt sections that can be used by:
 * - The VS Code extension's testing agent
 * - The Claude Code plugin
 * - Other AI-powered testing tools
 */

export { PromptBuildError } from "./errors.js";
// Re-export all sections
export * from "./sections/index.js";
// Re-export all types
export type { BuildConfig, Section } from "./types.js";
export { SectionId } from "./types.js";
