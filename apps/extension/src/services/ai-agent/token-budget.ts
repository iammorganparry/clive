/**
 * Token Budget Service for managing token consumption during AI agent operations
 * Uses Effect.Service pattern with Ref for mutable state tracking
 */

import { Effect, Ref, pipe } from "effect";
import { countTokensInText } from "../../utils/token-utils.js";

export type Priority = "high" | "medium" | "low";

const PRIORITY_ALLOCATION: Record<Priority, number> = {
  high: 0.5, // 50% of remaining
  medium: 0.25, // 25% of remaining
  low: 0.1, // 10% of remaining
};

/**
 * Truncate lines to fit within a token limit
 * Uses the same strategy as calculateTruncationLines but applies it
 */
function truncateLinesToTokenLimit(lines: string[], maxTokens: number): string {
  if (lines.length === 0) {
    return "";
  }

  // Sample first 10 lines to estimate tokens per line
  const sampleSize = Math.min(10, lines.length);
  let totalSampleTokens = 0;
  for (let i = 0; i < sampleSize; i++) {
    totalSampleTokens += countTokensInText(lines[i] || "");
  }

  const avgTokensPerLine = sampleSize > 0 ? totalSampleTokens / sampleSize : 20;
  const maxLines = Math.floor(maxTokens / Math.max(avgTokensPerLine, 1));

  if (maxLines >= lines.length) {
    return lines.join("\n");
  }

  // Keep 60% from start, 40% from end
  const keepFromStart = Math.floor(maxLines * 0.6);
  const keepFromEnd = Math.floor(maxLines * 0.4);

  const startLines = lines.slice(0, keepFromStart);
  const endLines = lines.slice(-keepFromEnd);
  const truncatedContent = [
    ...startLines,
    "",
    `// ... [Content truncated: ${lines.length - keepFromStart - keepFromEnd} lines omitted to fit token budget] ...`,
    "",
    ...endLines,
  ].join("\n");

  return truncatedContent;
}

/**
 * Token Budget Service for tracking and managing token consumption
 * Creates a fresh instance per request to track token usage
 */
export class TokenBudgetService extends Effect.Service<TokenBudgetService>()(
  "TokenBudgetService",
  {
    effect: Effect.gen(function* () {
      const consumedRef = yield* Ref.make(0);
      const maxBudget = 120_000; // Leave 80k for system prompt + response

      return {
        /**
         * Get remaining tokens in the budget
         */
        remaining: () =>
          pipe(
            Ref.get(consumedRef),
            Effect.map((consumed) => maxBudget - consumed),
          ),

        /**
         * Consume tokens from the budget
         */
        consume: (tokens: number) =>
          Ref.update(consumedRef, (current) => current + tokens),

        /**
         * Get the current consumed token count
         */
        getConsumed: () => Ref.get(consumedRef),

        /**
         * Truncate content to fit within the budget based on priority
         * Returns the truncated content and whether it was truncated
         */
        truncateToFit: (content: string, priority: Priority) =>
          Effect.gen(function* () {
            const remaining = yield* pipe(
              Ref.get(consumedRef),
              Effect.map((consumed) => maxBudget - consumed),
            );

            const allocation = Math.floor(
              remaining * PRIORITY_ALLOCATION[priority],
            );
            const contentTokens = countTokensInText(content);

            if (contentTokens <= allocation) {
              return { content, wasTruncated: false };
            }

            // Truncate to fit allocation using line-based truncation
            const lines = content.split("\n");
            const truncated = truncateLinesToTokenLimit(lines, allocation);
            return { content: truncated, wasTruncated: true };
          }),

        /**
         * Get the maximum budget value
         */
        getMaxBudget: () => Effect.succeed(maxBudget),
      };
    }),
  },
) {}

/**
 * Create a fresh TokenBudgetService instance for each request
 * This ensures each planning request has its own isolated budget
 */
export const makeTokenBudget = () =>
  Effect.gen(function* () {
    return yield* TokenBudgetService;
  }).pipe(Effect.provide(TokenBudgetService.Default));

/**
 * Type alias for TokenBudgetService instance
 * Use this type when accepting a budget as a parameter
 */
export type TokenBudget = Effect.Effect.Success<ReturnType<typeof makeTokenBudget>>;
