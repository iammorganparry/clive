/**
 * Dynamic Prompt Caching Utility
 *
 * Adds provider-specific cache control to messages.
 * Anthropic: marks last message with ephemeral cache control.
 * Extensible to other providers/strategies.
 */

import type { LanguageModel } from "ai";

/**
 * Message with optional provider options for caching
 */
interface MessageWithCache {
  role: "user" | "assistant" | "system";
  content: string;
  providerOptions?: {
    anthropic?: {
      cacheControl?: { type: "ephemeral" };
    };
  };
}

/**
 * Check if the model is an Anthropic model
 */
function isAnthropicModel(model: LanguageModel): boolean {
  if (typeof model === "string") {
    return model.includes("anthropic") || model.includes("claude");
  }
  return (
    model.provider === "anthropic" ||
    model.provider.includes("anthropic") ||
    model.modelId.includes("anthropic") ||
    model.modelId.includes("claude")
  );
}

/**
 * Add cache control to stable messages for efficient caching
 *
 * Caches only:
 * 1. System prompt (first message) - Stable across conversation
 * 2. proposeTestPlan tool results - Referenced in subsequent turns
 *
 * This avoids expensive cache writes on frequently changing content
 * (user messages, other assistant responses) while maximizing cache hits
 * on stable, reusable content.
 *
 * For non-Anthropic models, messages pass through unchanged.
 */
export function addCacheControlToMessages<
  T extends { role: "user" | "assistant" | "system"; content: string },
>(messages: T[], model: LanguageModel): MessageWithCache[] {
  if (messages.length === 0) return messages as MessageWithCache[];
  if (!isAnthropicModel(model)) return messages as MessageWithCache[];

  return messages.map((message, index) => {
    // Cache the system prompt (first message)
    const isSystemPrompt = index === 0;

    // Cache proposeTestPlan tool results (contain stable plan data)
    const isProposeTestPlanOutput =
      typeof message.content === "string" &&
      message.content.includes('"planId"') &&
      message.content.includes('"success"');

    if (isSystemPrompt || isProposeTestPlanOutput) {
      return {
        ...message,
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      } as MessageWithCache;
    }
    return message as MessageWithCache;
  });
}
