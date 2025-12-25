import { setup, assign } from "xstate";
import type {
  ToolEvent,
  ChatMessage,
  MessagePart,
  ToolState,
} from "../../../types/chat.js";

export interface ChangesetChatError {
  type: "SUBSCRIPTION_FAILED" | "ANALYSIS_FAILED";
  message: string;
  retryable: boolean;
  originalError?: unknown;
}

export interface ChangesetChatContext {
  files: string[];
  branchName: string;
  messages: ChatMessage[];
  streamingContent: string;
  toolEvents: ToolEvent[];
  error: ChangesetChatError | null;
  reasoningContent: string;
  isReasoningStreaming: boolean;
  hasCompletedAnalysis: boolean;
}

export type ChangesetChatEvent =
  | { type: "START_ANALYSIS" }
  | { type: "LOAD_HISTORY"; messages: ChatMessage[] }
  | {
      type: "RESPONSE_CHUNK";
      chunkType: "message" | "tool-call" | "tool-result" | "reasoning";
      content?: string;
      toolEvent?: ToolEvent;
      toolResult?: { toolCallId: string; updates: Partial<ToolEvent> };
    }
  | { type: "RESPONSE_COMPLETE" }
  | { type: "RESPONSE_ERROR"; error: unknown }
  | { type: "CLEAR_ERROR" }
  | { type: "RESET" }
  | { type: "SEND_MESSAGE"; content: string };

export interface ChangesetChatInput {
  files: string[];
  branchName: string;
}

const createChatError = (
  type: ChangesetChatError["type"],
  error: unknown,
  retryable: boolean = true,
): ChangesetChatError => {
  return {
    type,
    message:
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "An error occurred",
    retryable,
    originalError: error,
  };
};

export const changesetChatMachine = setup({
  types: {
    context: {} as ChangesetChatContext,
    events: {} as ChangesetChatEvent,
    input: {} as ChangesetChatInput,
  },
  actions: {
    appendStreamingContent: assign(({ context, event }) => {
      if (event.type !== "RESPONSE_CHUNK" || event.chunkType !== "message")
        return {};
      return {
        streamingContent: context.streamingContent + (event.content || ""),
      };
    }),
    clearStreamingContent: assign({ streamingContent: () => "" }),
    appendReasoningContent: assign(({ context, event }) => {
      if (event.type !== "RESPONSE_CHUNK" || event.chunkType !== "reasoning")
        return {};
      return {
        reasoningContent: context.reasoningContent + (event.content || ""),
        isReasoningStreaming: true,
      };
    }),
    clearReasoningContent: assign({
      reasoningContent: () => "",
      isReasoningStreaming: () => false,
    }),
    stopReasoningStreaming: assign({ isReasoningStreaming: () => false }),
    addToolEvent: assign(({ context, event }) => {
      if (event.type !== "RESPONSE_CHUNK" || event.chunkType !== "tool-call")
        return {};
      if (!event.toolEvent) return {};
      const toolEvent = {
        ...event.toolEvent,
        timestamp: event.toolEvent.timestamp || new Date(),
      };
      const existing = context.toolEvents.find(
        (t) => t.toolCallId === toolEvent.toolCallId,
      );
      if (existing) {
        return {
          toolEvents: context.toolEvents.map((t) =>
            t.toolCallId === toolEvent.toolCallId ? { ...t, ...toolEvent } : t,
          ),
        };
      }
      return { toolEvents: [...context.toolEvents, toolEvent] };
    }),
    updateToolEvent: assign(({ context, event }) => {
      if (event.type !== "RESPONSE_CHUNK" || event.chunkType !== "tool-result")
        return {};
      if (!event.toolResult) return {};
      return {
        toolEvents: context.toolEvents.map((t) =>
          t.toolCallId === event.toolResult?.toolCallId
            ? {
                ...t,
                ...event.toolResult?.updates,
                timestamp: t.timestamp, // Preserve existing timestamp
              }
            : t,
        ),
      };
    }),
    markAnalysisComplete: assign({ hasCompletedAnalysis: () => true }),
    addUserMessage: assign(({ context, event }) => {
      if (event.type !== "SEND_MESSAGE") return {};
      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        parts: [{ type: "text" as const, text: event.content }],
        timestamp: new Date(),
      };
      return {
        messages: [...context.messages, userMessage],
        hasCompletedAnalysis: false, // Reset when user sends new message
      };
    }),
    loadHistory: assign(({ event }) => {
      if (event.type !== "LOAD_HISTORY") return {};
      // Messages should already be in parts format from the hook
      return {
        messages: event.messages,
      };
    }),
    addInitialMessage: assign(({ context }) => {
      const initialMessage: ChatMessage = {
        id: "initial",
        role: "user",
        parts: [
          {
            type: "text",
            text: `Analyze these ${context.files.length} changed file(s) and propose comprehensive tests:\n${context.files.map((f) => `- ${f}`).join("\n")}`,
          },
        ],
        timestamp: new Date(),
      };
      return {
        messages: [initialMessage],
      };
    }),
    addTextPart: assign(({ context, event }) => {
      if (event.type !== "RESPONSE_CHUNK" || event.chunkType !== "message")
        return {};
      if (!event.content) return {};

      const lastMessage = context.messages[context.messages.length - 1];
      if (lastMessage && lastMessage.role === "assistant") {
        // Append to last text part or create new text part
        const lastPart = lastMessage.parts[lastMessage.parts.length - 1];
        const updatedParts =
          lastPart && lastPart.type === "text"
            ? [
                ...lastMessage.parts.slice(0, -1),
                { ...lastPart, text: lastPart.text + event.content },
              ]
            : [
                ...lastMessage.parts,
                { type: "text" as const, text: event.content },
              ];

        return {
          messages: [
            ...context.messages.slice(0, -1),
            { ...lastMessage, parts: updatedParts },
          ],
        };
      }

      // Create new assistant message with text part
      const newMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        parts: [{ type: "text" as const, text: event.content }],
        timestamp: new Date(),
      };
      return {
        messages: [...context.messages, newMessage],
      };
    }),
    addToolPart: assign(({ context, event }) => {
      if (event.type !== "RESPONSE_CHUNK" || event.chunkType !== "tool-call")
        return {};
      if (!event.toolEvent) return {};

      const lastMessage = context.messages[context.messages.length - 1];
      if (!lastMessage || lastMessage.role !== "assistant") {
        // Create new assistant message with tool part
        const newMessage: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: "assistant",
          parts: [
            {
              type: `tool-${event.toolEvent.toolName}`,
              toolName: event.toolEvent.toolName,
              toolCallId: event.toolEvent.toolCallId,
              state: "input-available",
              input: event.toolEvent.args,
            },
          ],
          timestamp: new Date(),
        };
        return {
          messages: [...context.messages, newMessage],
        };
      }

      // Add tool part to existing assistant message
      const toolPart: MessagePart = {
        type: `tool-${event.toolEvent.toolName}`,
        toolName: event.toolEvent.toolName,
        toolCallId: event.toolEvent.toolCallId,
        state: "input-available",
        input: event.toolEvent.args,
      };

      return {
        messages: [
          ...context.messages.slice(0, -1),
          { ...lastMessage, parts: [...lastMessage.parts, toolPart] },
        ],
      };
    }),
    updateToolPart: assign(({ context, event }) => {
      if (event.type !== "RESPONSE_CHUNK" || event.chunkType !== "tool-result")
        return {};
      if (!event.toolResult) return {};

      return {
        messages: context.messages.map((msg) => {
          const updatedParts = msg.parts.map((part) => {
            if (
              part.type.startsWith("tool-") &&
              "toolCallId" in part &&
              part.toolCallId === event.toolResult?.toolCallId
            ) {
              return {
                ...part,
                state: (event.toolResult.updates.errorText
                  ? "output-error"
                  : "output-available") as ToolState,
                output: event.toolResult.updates.output,
                errorText: event.toolResult.updates.errorText,
              };
            }
            return part;
          });
          return { ...msg, parts: updatedParts };
        }),
      };
    }),
    setResponseError: assign(({ event }) => {
      if (event.type !== "RESPONSE_ERROR") return {};
      return {
        error: createChatError("ANALYSIS_FAILED", event.error),
      };
    }),
    clearError: assign({ error: () => null }),
    reset: assign({
      messages: () => [],
      streamingContent: () => "",
      toolEvents: () => [],
      error: () => null,
      reasoningContent: () => "",
      isReasoningStreaming: () => false,
      hasCompletedAnalysis: () => false,
    }),
  },
}).createMachine({
  id: "changesetChat",
  initial: "idle",
  context: ({ input }) => ({
    files: input.files,
    branchName: input.branchName,
    messages: [],
    streamingContent: "",
    toolEvents: [],
    error: null,
    reasoningContent: "",
    isReasoningStreaming: false,
    hasCompletedAnalysis: false,
  }),
  states: {
    idle: {
      on: {
        LOAD_HISTORY: {
          actions: ["loadHistory"],
        },
        START_ANALYSIS: {
          target: "analyzing",
          actions: ["addInitialMessage"],
        },
        SEND_MESSAGE: {
          target: "analyzing",
          actions: ["addUserMessage"],
        },
        CLEAR_ERROR: {
          actions: ["clearError"],
        },
        RESET: {
          target: "idle",
          actions: ["reset"],
        },
      },
    },
    analyzing: {
      on: {
        RESPONSE_CHUNK: {
          target: "streaming",
          actions: [
            "appendStreamingContent",
            "appendReasoningContent",
            "addToolEvent",
            "updateToolEvent",
            "addTextPart",
            "addToolPart",
            "updateToolPart",
          ],
        },
        RESPONSE_ERROR: {
          target: "idle",
          actions: ["setResponseError"],
        },
        SEND_MESSAGE: {
          target: "analyzing",
          actions: ["addUserMessage"],
        },
      },
    },
    streaming: {
      on: {
        RESPONSE_CHUNK: {
          actions: [
            "appendStreamingContent",
            "appendReasoningContent",
            "addToolEvent",
            "updateToolEvent",
            "addTextPart",
            "addToolPart",
            "updateToolPart",
          ],
        },
        RESPONSE_COMPLETE: {
          target: "idle",
          actions: [
            "clearStreamingContent",
            "stopReasoningStreaming",
            "markAnalysisComplete",
          ],
        },
        RESPONSE_ERROR: {
          target: "idle",
          actions: ["setResponseError"],
        },
      },
    },
  },
});

export type ChangesetChatMachine = typeof changesetChatMachine;
