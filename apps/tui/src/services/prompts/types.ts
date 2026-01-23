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
   * Mode: plan or build
   */
  readonly mode?: "plan" | "build";

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
