/**
 * HistoryConverter Service
 * Converts JSONL conversation events to OutputLine[] format for TUI rendering
 *
 * Built with Effect-TS for proper error handling and composability
 */

import { Context, Effect, Layer } from "effect";
import type { OutputLine } from "../types";

/**
 * JSONL event types from Claude CLI conversation files
 */
interface BaseEvent {
  type: string;
  timestamp?: number;
}

interface UserEvent extends BaseEvent {
  type: "user";
  message: {
    role: "user";
    content: string | Array<{ type: string; text?: string }>;
  };
}

interface AssistantEvent extends BaseEvent {
  type: "assistant";
  message: {
    role: "assistant";
    content: Array<{
      type: "text" | "tool_use";
      text?: string;
      name?: string;
      id?: string;
      input?: Record<string, unknown>;
    }>;
  };
}

interface ToolResultEvent extends BaseEvent {
  type: "tool_result";
  tool_use_id: string;
  content?: string;
  is_error?: boolean;
}

/**
 * Union type for all conversation events
 * Using unknown for the input parameter since JSONL data is untyped
 */
type ConversationEvent =
  | UserEvent
  | AssistantEvent
  | ToolResultEvent
  | BaseEvent;

/**
 * HistoryConverter implementation
 */
class HistoryConverterImpl {
  /**
   * Convert JSONL events to OutputLine[] format
   * Filters and transforms events into renderable output lines
   */
  convertToOutputLines(
    events: ConversationEvent[],
  ): Effect.Effect<OutputLine[], never> {
    return Effect.sync(() => {
      const outputLines: OutputLine[] = [];

      for (const event of events) {
        const lines = this.convertEvent(event);
        outputLines.push(...lines);
      }

      return outputLines;
    });
  }

  /**
   * Convert a single event to OutputLine(s)
   */
  private convertEvent(event: ConversationEvent): OutputLine[] {
    if (!event || !event.type) {
      return [];
    }

    switch (event.type) {
      case "user":
        return this.convertUserEvent(event as UserEvent);

      case "assistant":
        return this.convertAssistantEvent(event as AssistantEvent);

      case "tool_result":
        return this.convertToolResultEvent(event as ToolResultEvent);

      // Ignore other event types (queue-operation, progress, summary, etc.)
      default:
        return [];
    }
  }

  /**
   * Convert user event to OutputLine
   */
  private convertUserEvent(event: UserEvent): OutputLine[] {
    if (!event.message?.content) {
      return [];
    }

    let text: string;
    if (typeof event.message.content === "string") {
      text = event.message.content;
    } else if (Array.isArray(event.message.content)) {
      // Extract text from content blocks
      text = event.message.content
        .filter((block) => block.type === "text" && block.text)
        .map((block) => block.text)
        .join("\n");
    } else {
      return [];
    }

    if (!text.trim()) {
      return [];
    }

    return [
      {
        text: `> ${text}`,
        type: "user",
      },
    ];
  }

  /**
   * Convert assistant event to OutputLine(s)
   * Handles both text blocks and tool_use blocks
   */
  private convertAssistantEvent(event: AssistantEvent): OutputLine[] {
    if (!event.message?.content || !Array.isArray(event.message.content)) {
      return [];
    }

    const lines: OutputLine[] = [];

    for (const block of event.message.content) {
      if (block.type === "text" && block.text) {
        lines.push({
          text: block.text,
          type: "assistant",
        });
      } else if (block.type === "tool_use" && block.name) {
        lines.push({
          text: `● ${block.name}`,
          type: "tool_call",
          toolName: block.name,
          toolUseID: block.id,
          toolInput: block.input,
        });
      }
    }

    return lines;
  }

  /**
   * Convert tool result event to OutputLine
   * Only show errors or significant results
   */
  private convertToolResultEvent(event: ToolResultEvent): OutputLine[] {
    // Skip successful tool results to reduce noise in history
    // Only show errors
    if (event.is_error && event.content) {
      return [
        {
          text: `⚠ Tool error: ${event.content.substring(0, 200)}${event.content.length > 200 ? "..." : ""}`,
          type: "tool_result",
          toolUseID: event.tool_use_id,
        },
      ];
    }

    return [];
  }

  /**
   * Create a visual separator for historical conversation content
   */
  createHistorySeparator(): OutputLine {
    return {
      text: "──────── Previous Session ────────",
      type: "system",
    };
  }

  /**
   * Create a visual separator indicating resume point
   */
  createResumeSeparator(): OutputLine {
    return {
      text: "──────── Resuming Session ────────",
      type: "system",
    };
  }
}

/**
 * HistoryConverter context tag
 */
export class HistoryConverter extends Context.Tag("HistoryConverter")<
  HistoryConverter,
  HistoryConverterImpl
>() {
  /**
   * Default layer providing HistoryConverter
   */
  static readonly Default = Layer.succeed(
    HistoryConverter,
    new HistoryConverterImpl(),
  );
}
