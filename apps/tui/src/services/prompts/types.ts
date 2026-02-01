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

  /**
   * Linear issue UUID of active epic
   */
  readonly epicId?: string;

  /**
   * Linear issue identifier (e.g. "CLIVE-123") for branch naming
   */
  readonly epicIdentifier?: string;

  /**
   * Current iteration number (1-based) for build loop
   */
  readonly iteration?: number;

  /**
   * Maximum iterations before stopping the build loop
   */
  readonly maxIterations?: number;
}

/**
 * Error during prompt building
 */
export class PromptBuildError extends Data.TaggedError("PromptBuildError")<{
  message: string;
}> {}
