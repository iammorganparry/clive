/**
 * TUI Prompt Service
 *
 * Single source of truth for building system prompts for Claude CLI execution.
 * Uses composable sections and mode-specific templates.
 */

export { PromptService, PromptServiceLive } from "./prompt-service";
export type { Section, SectionId as SectionIdType } from "./sections";
export { SectionId, sections } from "./sections";
export type { BuildConfig, PromptBuildError } from "./types";
