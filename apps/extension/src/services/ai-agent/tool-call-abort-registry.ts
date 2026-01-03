/**
 * ToolCallAbortRegistry
 *
 * Singleton registry for tracking running tool calls and their abort controllers.
 * Allows aborting individual tool calls without cancelling the entire stream.
 */

const runningToolCalls = new Map<string, AbortController>();

export const ToolCallAbortRegistry = {
  /**
   * Register a new tool call and return its abort controller
   * @param toolCallId - Unique identifier for the tool call
   * @returns AbortController for this tool call
   */
  register: (toolCallId: string): AbortController => {
    console.log("[ToolCallAbortRegistry] Registering toolCallId:", toolCallId);
    // Clean up any existing controller for this toolCallId (shouldn't happen, but safety)
    const existing = runningToolCalls.get(toolCallId);
    if (existing) {
      existing.abort();
      runningToolCalls.delete(toolCallId);
    }

    const abortController = new AbortController();
    runningToolCalls.set(toolCallId, abortController);
    console.log(
      "[ToolCallAbortRegistry] Registered toolCallId:",
      toolCallId,
      "Total running:",
      runningToolCalls.size,
    );
    return abortController;
  },

  /**
   * Abort a specific tool call by its ID
   * @param toolCallId - Unique identifier for the tool call to abort
   * @returns true if the tool call was found and aborted, false otherwise
   */
  abort: (toolCallId: string): boolean => {
    console.log(
      "[ToolCallAbortRegistry] Attempting to abort toolCallId:",
      toolCallId,
    );
    const abortController = runningToolCalls.get(toolCallId);
    console.log(
      "[ToolCallAbortRegistry] Found controller:",
      !!abortController,
      "Keys:",
      [...runningToolCalls.keys()],
    );
    if (abortController) {
      abortController.abort();
      runningToolCalls.delete(toolCallId);
      console.log(
        "[ToolCallAbortRegistry] Successfully aborted toolCallId:",
        toolCallId,
      );
      return true;
    }
    console.warn("[ToolCallAbortRegistry] ToolCallId not found:", toolCallId);
    return false;
  },

  /**
   * Clean up a tool call registration (called when execution completes normally)
   * @param toolCallId - Unique identifier for the tool call to clean up
   */
  cleanup: (toolCallId: string): void => {
    runningToolCalls.delete(toolCallId);
  },

  /**
   * Check if a tool call is currently running
   * @param toolCallId - Unique identifier for the tool call
   * @returns true if the tool call is registered and not aborted
   */
  isRunning: (toolCallId: string): boolean => {
    const abortController = runningToolCalls.get(toolCallId);
    return abortController !== undefined && !abortController.signal.aborted;
  },
};
