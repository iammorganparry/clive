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
 * Add cache control to the last message for incremental caching
 * 
 * Per Anthropic's best practice: "Mark the final block of the final message 
 * with cache_control so the conversation can be incrementally cached."
 * 
 * For non-Anthropic models, messages pass through unchanged.
 */
export function addCacheControlToMessages<
  T extends { role: "user" | "assistant" | "system"; content: string },
>(messages: T[], model: LanguageModel): MessageWithCache[] {
  if (messages.length === 0) return messages as MessageWithCache[];
  if (!isAnthropicModel(model)) return messages as MessageWithCache[];

  return messages.map((message, index) => {
    if (index === messages.length - 1) {
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
