/**
 * CLI Stream Adapter
 * Converts Claude CLI streaming events to AgentStreamEvent format
 * used by the testing agent and event handlers
 */

import { Stream } from "effect";
import { logToOutput } from "../../utils/logger.js";
import type { AgentStreamEvent } from "../../utils/stream-utils.js";
import type { ClaudeCliEvent } from "../claude-cli-service.js";

/**
 * Convert a ClaudeCliEvent to AgentStreamEvent
 */
function cliEventToAgentEvent(event: ClaudeCliEvent): AgentStreamEvent | null {
  logToOutput(`[cliStreamAdapter] CLI event type: ${event.type}`);

  switch (event.type) {
    case "text":
      return {
        type: "text-delta",
        content: event.content,
      };

    case "thinking":
      return {
        type: "thinking",
        content: event.content,
      };

    case "tool_use":
      return {
        type: "tool-call",
        toolName: event.name,
        toolArgs: event.input,
        toolCallId: event.id,
      };

    case "tool_result":
      return {
        type: "tool-result",
        toolCallId: event.id,
        toolResult: event.content,
      };

    case "error":
      // Log error but don't emit - let the caller handle errors
      logToOutput(`[cliStreamAdapter] CLI error: ${event.message}`);
      return null;

    case "done":
      return {
        type: "finish",
      };

    default:
      return null;
  }
}

/**
 * Convert a stream of ClaudeCliEvents to AgentStreamEvents
 * This adapter allows CLI-based execution to use the same
 * event handling pipeline as API-based execution
 */
export function streamFromCli(
  cliStream: Stream.Stream<ClaudeCliEvent, Error, never>,
): Stream.Stream<AgentStreamEvent, Error, never> {
  return cliStream.pipe(
    Stream.map((event) => {
      const agentEvent = cliEventToAgentEvent(event);
      if (agentEvent) {
        logToOutput(`[cliStreamAdapter] Converted to: ${agentEvent.type}`);
      }
      return agentEvent;
    }),
    Stream.filter((event): event is AgentStreamEvent => event !== null),
  );
}

/**
 * Convert an async generator of ClaudeCliEvents to an Effect Stream
 * Used when the CLI service returns an async generator directly
 */
export function streamFromCliGenerator(
  generator: AsyncGenerator<ClaudeCliEvent>,
): Stream.Stream<AgentStreamEvent, Error, never> {
  const cliStream = Stream.fromAsyncIterable(
    generator,
    (error) => new Error(String(error)),
  );

  return streamFromCli(cliStream);
}
