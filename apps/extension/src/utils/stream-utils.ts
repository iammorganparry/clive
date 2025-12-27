import { Stream, Match } from "effect";
import type { StreamTextResult, TextStreamPart, ToolSet } from "ai";

/**
 * Event types emitted from the AI agent stream
 */
export interface AgentStreamEvent {
  type:
    | "text-delta"
    | "tool-call"
    | "tool-result"
    | "step-finish"
    | "finish"
    | "thinking";
  content?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  toolCallId?: string;
  stepIndex?: number;
}

/**
 * Convert AI SDK streamText result to Effect Stream
 * Consumes the fullStream async iterable and maps chunks to AgentStreamEvent
 * Uses proper AI SDK types for type safety
 */
export function streamFromAI<TOOLS extends ToolSet>(
  result: StreamTextResult<TOOLS, any>,
): Stream.Stream<AgentStreamEvent, Error, never> {
  return Stream.fromAsyncIterable(
    result.fullStream,
    (error) => new Error(String(error)),
  ).pipe(
    Stream.map((chunk: TextStreamPart<TOOLS>) => {
      // Map AI SDK chunk types to our event types using Match
      // TextStreamPart is a discriminated union with 'type' as the discriminant
      // Based on AI SDK types:
      // - text-delta: { type: 'text-delta'; text: string; ... }
      // - tool-call: ({ type: 'tool-call' } & TypedToolCall<TOOLS>) where TypedToolCall has toolName and input
      // - tool-result: ({ type: 'tool-result' } & TypedToolResult<TOOLS>) where TypedToolResult has toolName and output
      return Match.value(chunk.type).pipe(
        Match.when("text-delta", () => {
          // TypeScript narrows: chunk is { type: 'text-delta'; text: string; ... }
          return {
            type: "text-delta" as const,
            content: (chunk as { type: "text-delta"; text: string }).text,
          } satisfies AgentStreamEvent;
        }),
        Match.when("tool-call", () => {
          // TypeScript narrows: chunk is ({ type: 'tool-call' } & TypedToolCall<TOOLS>)
          // Both StaticToolCall and DynamicToolCall have toolName: string and input: unknown
          // Tool calls also have toolCallId
          const toolCall = chunk as {
            type: "tool-call";
            toolName: string;
            input: unknown;
            toolCallId?: string;
          };
          return {
            type: "tool-call" as const,
            toolName: toolCall.toolName,
            toolArgs: toolCall.input,
            toolCallId: toolCall.toolCallId,
          } satisfies AgentStreamEvent;
        }),
        Match.when("tool-result", () => {
          // TypeScript narrows: chunk is ({ type: 'tool-result' } & TypedToolResult<TOOLS>)
          // Both StaticToolResult and DynamicToolResult have toolName: string, output: unknown, and toolCallId: string
          const toolResult = chunk as {
            type: "tool-result";
            toolName: string;
            output: unknown;
            toolCallId: string;
          };
          return {
            type: "tool-result" as const,
            toolName: toolResult.toolName,
            toolResult: toolResult.output,
            toolCallId: toolResult.toolCallId,
          } satisfies AgentStreamEvent;
        }),
        Match.when("finish", () => {
          return {
            type: "finish" as const,
          } satisfies AgentStreamEvent;
        }),
        Match.when("reasoning-delta", () => {
          // Handle thinking/reasoning events from Anthropic
          const thinkingChunk = chunk as {
            type: "reasoning-delta";
            text: string;
          };
          return {
            type: "thinking" as const,
            content: thinkingChunk.text,
          } satisfies AgentStreamEvent;
        }),
        Match.orElse(() => ({
          type: "text-delta" as const,
          content: "",
        })),
      );
    }),
    // Filter out empty text-delta events
    Stream.filter((event) => !(event.type === "text-delta" && !event.content)),
  );
}
