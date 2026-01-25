import { Effect } from "effect";
import type { BuildConfig, PromptBuildError } from "../types";

/**
 * Conversation context section
 * Provides context from previous conversation turns
 */
export const conversationContext = (
  config: BuildConfig,
): Effect.Effect<string, PromptBuildError> =>
  Effect.gen(function* () {
    const { previousContext } = config;

    if (!previousContext) {
      return "";
    }

    return `
CONVERSATION CONTEXT: Previous conversation summary:
${previousContext}
`;
  });
