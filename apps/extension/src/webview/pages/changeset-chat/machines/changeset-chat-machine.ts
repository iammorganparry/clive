import { setup, assign } from "xstate";
import type {
  ToolEvent,
  ChatMessage,
  MessagePart,
  ToolState,
} from "../../../types/chat.js";
import {
  parseScratchpad,
  type ScratchpadTodo,
} from "../utils/parse-scratchpad.js";

// Type guards for bash execute operations
interface BashExecuteArgs {
  command: string;
}

const isBashExecuteArgs = (args: unknown): args is BashExecuteArgs =>
  typeof args === "object" &&
  args !== null &&
  "command" in args &&
  typeof (args as BashExecuteArgs).command === "string";

interface BashExecuteOutput {
  stdout: string;
  stderr?: string;
  exitCode: number;
  wasTruncated: boolean;
  command: string;
}

const isBashExecuteOutput = (output: unknown): output is BashExecuteOutput =>
  typeof output === "object" &&
  output !== null &&
  "stdout" in output &&
  typeof (output as BashExecuteOutput).stdout === "string";

/**
 * Parse toolCalls field from backend message to reconstruct parts
 */
function parseMessageParts(
  content: string,
  toolCalls: string | null | undefined,
): MessagePart[] {
  const parts: MessagePart[] = [];

  // Always add text part
  if (content.trim()) {
    parts.push({ type: "text", text: content });
  }

  // Parse toolCalls if present
  if (toolCalls) {
    try {
      const parsed = JSON.parse(toolCalls);
      // Handle different toolCalls formats
      if (Array.isArray(parsed)) {
        // Array of tool calls
        for (const toolCall of parsed) {
          if (toolCall && typeof toolCall === "object") {
            parts.push({
              type: `tool-${toolCall.toolName || "unknown"}`,
              toolName: toolCall.toolName || "unknown",
              toolCallId: toolCall.toolCallId || `tool-${Date.now()}`,
              state: "output-available",
              input: toolCall.args,
              output: toolCall.output,
              errorText: toolCall.errorText,
            });
          }
        }
      } else if (parsed && typeof parsed === "object") {
        // Single tool call or object with tool calls
        if (parsed.toolName) {
          parts.push({
            type: `tool-${parsed.toolName}`,
            toolName: parsed.toolName,
            toolCallId: parsed.toolCallId || `tool-${Date.now()}`,
            state: "output-available",
            input: parsed.args,
            output: parsed.output,
            errorText: parsed.errorText,
          });
        }
      }
    } catch (error) {
      console.warn("Failed to parse toolCalls:", error);
    }
  }

  return parts.length > 0 ? parts : [{ type: "text", text: content || "" }];
}

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
  scratchpadTodos: ScratchpadTodo[];
  cacheLoaded: boolean;
  historyLoaded: boolean;
  cachedAt?: number; // Timestamp of when cache was loaded
}

interface CachedConversation {
  messages: ChatMessage[];
  hasCompletedAnalysis: boolean;
  scratchpadTodos: ScratchpadTodo[];
  cachedAt: number;
}

interface BackendHistoryMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls: string | null | undefined;
  createdAt: string;
}

interface BackendHistoryData {
  conversationId: string | null;
  messages: BackendHistoryMessage[];
}

export type ChangesetChatEvent =
  | { type: "START_ANALYSIS" }
  | { type: "LOAD_HISTORY"; messages: ChatMessage[] }
  | { type: "RECEIVE_CACHE"; cache: CachedConversation | null }
  | { type: "RECEIVE_BACKEND_HISTORY"; historyData: BackendHistoryData | null }
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
  guards: {
    shouldLoadBackendHistory: ({ context, event }): boolean => {
      if (event.type !== "RECEIVE_BACKEND_HISTORY") return false;
      if (
        !event.historyData ||
        !event.historyData.conversationId ||
        event.historyData.messages.length === 0
      ) {
        return false;
      }
      // If cache wasn't loaded, always use backend
      if (!context.cacheLoaded) return true;
      // If cache was loaded, compare message counts and timestamps
      const backendMessages = event.historyData.messages;
      const backendNewer =
        backendMessages.length > context.messages.length ||
        (backendMessages.length > 0 &&
          context.messages.length > 0 &&
          context.cachedAt !== undefined &&
          new Date(
            backendMessages[backendMessages.length - 1].createdAt,
          ).getTime() > context.cachedAt);
      return backendNewer;
    },
    shouldStartFreshAnalysis: ({ context, event }): boolean => {
      if (event.type !== "RECEIVE_BACKEND_HISTORY") return false;
      // Start fresh if no backend history and no messages were loaded from cache
      return (
        (!event.historyData ||
          !event.historyData.conversationId ||
          event.historyData.messages.length === 0) &&
        context.messages.length === 0
      );
    },
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
      const toolResult = event.toolResult;
      const toolCallId = toolResult.toolCallId;
      return {
        toolEvents: context.toolEvents.map((t) =>
          t.toolCallId === toolCallId
            ? {
                ...t,
                ...toolResult.updates,
                timestamp: t.timestamp, // Preserve existing timestamp
              }
            : t,
        ),
      };
    }),
    updateScratchpadTodos: assign(({ context, event }) => {
      // Check for scratchpad content from bashExecute tool results
      if (
        event.type === "RESPONSE_CHUNK" &&
        event.chunkType === "tool-result" &&
        event.toolResult
      ) {
        const toolCallId = event.toolResult.toolCallId;
        const toolEvent = context.toolEvents.find(
          (t) => t.toolCallId === toolCallId,
        );

        if (
          toolEvent &&
          toolEvent.toolName === "bashExecute" &&
          isBashExecuteArgs(toolEvent.args)
        ) {
          const command = toolEvent.args.command;
          // Check if command interacts with scratchpad files (.clive/plans/)
          const isScratchpadOperation =
            command.includes(".clive/plans/") &&
            (command.includes("test-plan-") || command.includes("plans/"));

          if (isScratchpadOperation && event.toolResult.updates.output) {
            // Extract scratchpad content from output
            // For read operations (cat .clive/plans/...), content is in stdout
            // For write operations, we might need to read it back, but let's try output first
            const output = event.toolResult.updates.output;
            let content = "";

            if (typeof output === "string") {
              content = output;
            } else if (isBashExecuteOutput(output)) {
              content = output.stdout;
            }

            // Only parse if we have meaningful content (not just empty string or whitespace)
            if (content.trim().length > 0) {
              try {
                const todos = parseScratchpad(content);
                // Only update if we found actual TODOs
                if (todos.length > 0) {
                  return { scratchpadTodos: todos };
                }
              } catch (error) {
                // Log parsing errors for debugging but don't crash
                console.warn("Failed to parse scratchpad content:", error);
              }
            }
          }
        }
      }

      // Also check assistant message text content for checkboxes
      // This handles cases where the agent includes TODOs in markdown responses
      const lastMessage = context.messages[context.messages.length - 1];
      if (lastMessage && lastMessage.role === "assistant") {
        // Collect all text parts from the assistant message
        const textParts = lastMessage.parts
          .filter(
            (part): part is { type: "text"; text: string } =>
              part.type === "text",
          )
          .map((part) => part.text)
          .join("\n");

        if (textParts.trim().length > 0) {
          try {
            const todos = parseScratchpad(textParts);
            // Only update if we found actual TODOs
            if (todos.length > 0) {
              return { scratchpadTodos: todos };
            }
          } catch (_error) {
            // Silently ignore parsing errors for message content
          }
        }
      }

      return {};
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
      // If we have messages, mark analysis as complete (conversation was already analyzed)
      const hasMessages = event.messages.length > 0;
      return {
        messages: event.messages,
        hasCompletedAnalysis: hasMessages,
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

      const toolCallId = event.toolResult.toolCallId;
      const updates = event.toolResult.updates;

      return {
        messages: context.messages.map((msg) => {
          const updatedParts = msg.parts.map((part) => {
            if (
              part.type.startsWith("tool-") &&
              "toolCallId" in part &&
              part.toolCallId === toolCallId
            ) {
              return {
                ...part,
                state: (updates.errorText
                  ? "output-error"
                  : "output-available") as ToolState,
                output: updates.output,
                errorText: updates.errorText,
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
    markHistoryLoaded: assign({ historyLoaded: () => true }),
    receiveCache: assign(({ event }) => {
      if (event.type !== "RECEIVE_CACHE") return {};
      if (!event.cache || event.cache.messages.length === 0) {
        return { cacheLoaded: true };
      }
      // Load cached messages immediately
      return {
        messages: event.cache.messages,
        hasCompletedAnalysis: event.cache.hasCompletedAnalysis,
        scratchpadTodos: event.cache.scratchpadTodos,
        cacheLoaded: true,
        cachedAt: event.cache.cachedAt,
      };
    }),
    receiveBackendHistory: assign(({ event }) => {
      if (event.type !== "RECEIVE_BACKEND_HISTORY") return {};
      if (
        !event.historyData ||
        !event.historyData.conversationId ||
        event.historyData.messages.length === 0
      ) {
        return { historyLoaded: true };
      }
      // Convert backend format to parts-based format, parsing toolCalls
      const messages: ChatMessage[] = event.historyData.messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        parts: parseMessageParts(msg.content, msg.toolCalls),
        timestamp: new Date(msg.createdAt),
      }));
      return {
        messages,
        hasCompletedAnalysis: messages.length > 0,
        historyLoaded: true,
      };
    }),
    reset: assign({
      messages: () => [],
      streamingContent: () => "",
      toolEvents: () => [],
      error: () => null,
      reasoningContent: () => "",
      isReasoningStreaming: () => false,
      hasCompletedAnalysis: () => false,
      scratchpadTodos: () => [],
      cacheLoaded: () => false,
      historyLoaded: () => false,
      cachedAt: () => undefined,
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
    scratchpadTodos: [],
    cacheLoaded: false,
    historyLoaded: false,
    cachedAt: undefined,
  }),
  states: {
    idle: {
      on: {
        RECEIVE_CACHE: {
          actions: ["receiveCache"],
        },
        RECEIVE_BACKEND_HISTORY: [
          {
            guard: "shouldLoadBackendHistory",
            actions: ["receiveBackendHistory"],
          },
          {
            guard: "shouldStartFreshAnalysis",
            target: "analyzing",
            actions: ["addInitialMessage"],
          },
          {
            // Backend history received but cache is newer or already loaded
            actions: ["markHistoryLoaded"],
          },
        ],
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
            "updateScratchpadTodos",
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
            "updateScratchpadTodos",
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
