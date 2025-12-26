/**
 * Context Tracker Service for estimating and tracking context window usage
 * Tracks conversation messages, tool results, and system prompts
 */

import { countTokensInText } from "../../utils/token-utils.js";

export interface ContextEstimate {
  messagesTokens: number;
  toolResultsTokens: number;
  systemPromptTokens: number;
  totalTokens: number;
  percentUsed: number;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Context window limits for Claude Haiku 4.5
 */
const CONTEXT_WINDOW_SIZE = 200_000; // ~200k tokens
const RESERVED_FOR_RESPONSE = 80_000; // Reserve 80k for system prompt + response generation
const USABLE_CONTEXT = CONTEXT_WINDOW_SIZE - RESERVED_FOR_RESPONSE; // ~120k usable
const SUMMARIZATION_THRESHOLD = 0.8; // Summarize at 80% usage (~96k tokens)
const TARGET_AFTER_SUMMARIZATION = 0.4; // Target 40% after summarization (~48k tokens)

/**
 * Estimate context size from messages and system prompt
 */
export function estimateContextSize(
  messages: Message[],
  systemPrompt: string,
): ContextEstimate {
  // Count tokens in all messages
  const messagesTokens = messages.reduce(
    (total, msg) => total + countTokensInText(msg.content),
    0,
  );

  // Count tokens in system prompt
  const systemPromptTokens = countTokensInText(systemPrompt);

  // Tool results are embedded in assistant messages, so they're already counted
  // For now, we'll estimate tool results separately if needed
  const toolResultsTokens = 0; // Can be extended later if we track tool results separately

  const totalTokens = messagesTokens + systemPromptTokens + toolResultsTokens;
  const percentUsed = totalTokens / USABLE_CONTEXT;

  return {
    messagesTokens,
    toolResultsTokens,
    systemPromptTokens,
    totalTokens,
    percentUsed,
  };
}

/**
 * Check if context should be summarized
 */
export function shouldSummarize(estimate: ContextEstimate): boolean {
  return estimate.percentUsed >= SUMMARIZATION_THRESHOLD;
}

/**
 * Get the number of messages to keep after summarization
 * Keeps the most recent messages for immediate context
 */
export function getMessagesToKeep(): number {
  return 3; // Keep last 3 messages for immediate context
}

/**
 * Get context window constants
 */
export function getContextLimits() {
  return {
    CONTEXT_WINDOW_SIZE,
    RESERVED_FOR_RESPONSE,
    USABLE_CONTEXT,
    SUMMARIZATION_THRESHOLD,
    TARGET_AFTER_SUMMARIZATION,
    SUMMARIZATION_THRESHOLD_TOKENS: Math.floor(
      USABLE_CONTEXT * SUMMARIZATION_THRESHOLD,
    ),
    TARGET_AFTER_SUMMARIZATION_TOKENS: Math.floor(
      USABLE_CONTEXT * TARGET_AFTER_SUMMARIZATION,
    ),
  };
}
