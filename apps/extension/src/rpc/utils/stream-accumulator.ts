/**
 * StreamAccumulator - Accumulates streaming content for conversation persistence
 *
 * This utility tracks text deltas and tool calls from progress events,
 * providing a provider-agnostic way to capture partial responses for
 * persistence on stream cancellation.
 */

export interface ToolCallData {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface AccumulatedContent {
  text: string;
  toolCalls: ToolCallData[];
}

export class StreamAccumulator {
  private text = "";
  private toolCalls: ToolCallData[] = [];

  /**
   * Process a progress event and accumulate content
   * Handles events from both API and CLI execution paths
   */
  handleProgress(status: string, message: string): void {
    // Handle text deltas - the event contains the delta text
    if (status === "text-delta" || status === "content_streamed") {
      try {
        const data = JSON.parse(message);
        if (data.content) {
          this.text += data.content;
        }
      } catch {
        // Plain text message, accumulate directly
        this.text += message;
      }
    }

    // Handle tool calls - accumulate tool call information
    if (status === "tool-call") {
      try {
        const data = JSON.parse(message);
        if (data.toolCallId && data.toolName) {
          this.toolCalls.push({
            toolCallId: data.toolCallId,
            toolName: data.toolName,
            args: data.args || data.input,
          });
        }
      } catch {
        // Ignore malformed tool calls
      }
    }
  }

  /**
   * Get accumulated content for persistence
   */
  getAccumulated(): AccumulatedContent {
    return {
      text: this.text,
      toolCalls: [...this.toolCalls],
    };
  }

  /**
   * Check if there's any content to persist
   */
  hasContent(): boolean {
    return this.text.length > 0 || this.toolCalls.length > 0;
  }

  /**
   * Reset the accumulator (useful for testing or reuse)
   */
  reset(): void {
    this.text = "";
    this.toolCalls = [];
  }
}
