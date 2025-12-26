/**
 * Shared utilities for emitting error events from AI agents
 * Used to propagate errors to the frontend via progressCallback
 */

/**
 * Progress callback type for agent error emission
 * First parameter is the status/event type, second is the JSON stringified event data
 */
export type AgentProgressCallback = (status: string, message: string) => void;

/**
 * Extract detailed error message from various error types
 * Handles AI SDK errors, HTTP errors, and standard Error objects
 */
export const extractDetailedErrorMessage = (error: unknown): string => {
  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error occurred";

  // Extract more details from AI SDK errors
  let detailedMessage = errorMessage;
  if (error && typeof error === "object") {
    const errorObj = error as Record<string, unknown>;

    // Check for status code
    if (errorObj.statusCode) {
      detailedMessage = `[${errorObj.statusCode}] ${errorMessage}`;
    }

    // Check for nested cause
    if (errorObj.cause && typeof errorObj.cause === "object") {
      const cause = errorObj.cause as Record<string, unknown>;
      if (cause.message && typeof cause.message === "string") {
        detailedMessage = cause.message;
      }
    }

    // Check for AI_APICallError structure
    if (errorObj.name === "AI_APICallError" && errorObj.message) {
      detailedMessage = String(errorObj.message);
    }
  }

  return detailedMessage;
};

/**
 * Emit an error event via progressCallback
 * Formats the error and sends it as a JSON stringified event
 */
export const emitAgentError = (
  error: unknown,
  progressCallback?: AgentProgressCallback,
): void => {
  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error occurred";

  const detailedMessage = extractDetailedErrorMessage(error);

  progressCallback?.(
    "error",
    JSON.stringify({
      type: "error",
      message: detailedMessage,
      originalError: errorMessage,
    }),
  );
};
