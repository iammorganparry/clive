import { Effect } from "effect";
import type { BuildConfig, PromptBuildError } from "../types";

/**
 * Issue tracker context section
 * Provides Linear or Beads integration instructions
 */
export const issueTrackerContext = (
  config: BuildConfig,
): Effect.Effect<string, PromptBuildError> =>
  Effect.gen(function* () {
    const { issueTracker } = config;

    if (!issueTracker) {
      return "";
    }

    const trackerName = issueTracker === "linear" ? "Linear" : "Beads";

    return `
IMPORTANT: This project uses ${trackerName} for issue tracking. When creating tasks or issues in your plan, use the ${trackerName} CLI commands and tools.
`;
  });
