/**
 * Type-safe JSON serialization utilities
 */

/**
 * Usage event type for progress callbacks
 */
export type UsageEvent = {
  type: "usage";
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
  };
};

/**
 * Type guard to check if an object is a UsageEvent
 */
export function isUsageEvent(value: unknown): value is UsageEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "usage" &&
    "usage" in value &&
    typeof value.usage === "object" &&
    value.usage !== null &&
    "inputTokens" in value.usage &&
    "outputTokens" in value.usage &&
    "totalTokens" in value.usage &&
    "reasoningTokens" in value.usage &&
    "cachedInputTokens" in value.usage
  );
}

/**
 * Creates a type-safe UsageEvent from partial usage data
 */
export function createUsageEvent(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}): UsageEvent {
  return {
    type: "usage",
    usage: {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      totalTokens: usage.totalTokens ?? 0,
      reasoningTokens: usage.reasoningTokens ?? 0,
      cachedInputTokens: usage.cachedInputTokens ?? 0,
    },
  };
}

/**
 * Type-safe JSON stringify that handles errors gracefully
 * Returns a string representation of the value, or a fallback string on error
 *
 * @param value - The value to stringify
 * @param fallback - Optional fallback string if stringification fails (default: "{}")
 * @returns JSON string representation of the value
 *
 * @example
 * ```typescript
 * safeStringify({ type: "usage", usage: { inputTokens: 100 } })
 * // Returns: '{"type":"usage","usage":{"inputTokens":100}}'
 *
 * safeStringify(circularObject, "error")
 * // Returns: "error" (if circular reference detected)
 * ```
 */
export function safeStringify<T>(value: T, fallback: string = "{}"): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    // Handle circular references and other serialization errors
    if (error instanceof Error) {
      console.warn(
        `[safeStringify] Failed to stringify value: ${error.message}`,
        value,
      );
    }
    return fallback;
  }
}

/**
 * Type-safe JSON stringify for event objects
 * Ensures the value is serializable and returns a properly formatted JSON string
 *
 * @param value - The event object to stringify
 * @returns JSON string representation of the event
 * @throws Never throws - always returns a valid string
 *
 * @example
 * ```typescript
 * stringifyEvent({ type: "usage", usage: { inputTokens: 100 } })
 * // Returns: '{"type":"usage","usage":{"inputTokens":100}}'
 * ```
 */
export function stringifyEvent<T extends Record<string, unknown> | UsageEvent>(
  value: T,
): string {
  return safeStringify(
    value as Record<string, unknown>,
    JSON.stringify({ type: "error", message: "Failed to serialize event" }),
  );
}
