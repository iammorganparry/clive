import { Data } from "effect";

/**
 * Error thrown when prompt building fails
 */
export class PromptBuildError extends Data.TaggedError("PromptBuildError")<{
  message: string;
  sectionId?: string;
  cause?: unknown;
}> {}
