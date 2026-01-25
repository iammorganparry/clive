import { Data } from "effect";

/**
 * Configuration for building prompts
 */
export interface BuildConfig {
  /**
   * Workspace root directory
   */
  readonly workspaceRoot?: string;

  /**
   * Mode: plan, build, or review
   */
  readonly mode?: "plan" | "build" | "review";

  /**
   * Issue tracker integration
   */
  readonly issueTracker?: "linear" | "beads";

  /**
   * Previous conversation context
   */
  readonly previousContext?: string;
}

/**
 * Error during prompt building
 */
export class PromptBuildError extends Data.TaggedError("PromptBuildError")<{
  message: string;
}> {}
