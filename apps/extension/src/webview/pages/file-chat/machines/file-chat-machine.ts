import { setup, assign, fromPromise } from "xstate";
import type {
  ToolEvent,
  ChatMessage,
} from "../../dashboard/machines/file-test-machine.js";
import type { ProposedTest } from "../../../../services/ai-agent/types.js";

interface HistoryResult {
  conversationId: string | null;
  messages: ChatMessage[];
}

interface HistoryError {
  error: string;
}

export type ChatErrorType =
  | "HISTORY_LOAD_FAILED"
  | "CONVERSATION_CREATE_FAILED"
  | "MESSAGE_SEND_FAILED"
  | "RESPONSE_FAILED"
  | "PROPOSAL_ACTION_FAILED";

export interface ChatError {
  type: ChatErrorType;
  message: string;
  retryable: boolean;
  originalError?: unknown;
}

export interface FileChatContext {
  sourceFile: string;
  conversationId: string | null;
  messages: ChatMessage[];
  pendingMessages: ChatMessage[];
  streamingContent: string;
  toolEvents: ToolEvent[];
  proposals: ProposedTest[];
  proposalStatuses: Map<string, "pending" | "approved" | "rejected">;
  error: ChatError | null;
  historyError: string | null;
  reasoningContent: string;
  isReasoningStreaming: boolean;
}

export type FileChatEvent =
  | { type: "INIT"; sourceFile: string }
  | {
      type: "HISTORY_LOADED";
      conversationId: string | null;
      messages: ChatMessage[];
    }
  | { type: "HISTORY_ERROR"; error: string }
  | { type: "SEND_MESSAGE"; content: string }
  | { type: "CONVERSATION_CREATED"; conversationId: string }
  | { type: "CONVERSATION_ERROR"; error: unknown }
  | {
      type: "RESPONSE_CHUNK";
      chunkType:
        | "message"
        | "tool-call"
        | "tool-result"
        | "tests"
        | "reasoning"
        | "proposal";
      content?: string;
      toolEvent?: ToolEvent;
      toolResult?: { toolCallId: string; updates: Partial<ToolEvent> };
      tests?: unknown[];
      proposal?: ProposedTest;
      toolCallId?: string;
    }
  | { type: "RESPONSE_COMPLETE" }
  | { type: "RESPONSE_ERROR"; error: unknown }
  | { type: "APPROVE_PROPOSAL"; proposalId: string }
  | { type: "REJECT_PROPOSAL"; proposalId: string }
  | { type: "PROPOSAL_APPROVED"; proposalId: string }
  | { type: "PROPOSAL_REJECTED"; proposalId: string }
  | { type: "PROPOSAL_ERROR"; proposalId: string; error: unknown }
  | { type: "CLEAR_ERROR" }
  | { type: "RETRY" }
  | { type: "RESET" };

export interface FileChatInput {
  sourceFile: string;
}

const createChatError = (
  type: ChatErrorType,
  error: unknown,
  retryable: boolean = true,
): ChatError => {
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

export const fileChatMachine = setup({
  types: {
    context: {} as FileChatContext,
    events: {} as FileChatEvent,
    input: {} as FileChatInput,
  },
  actors: {
    loadHistory: fromPromise<HistoryResult | HistoryError, void>(async () => ({
      conversationId: null,
      messages: [],
    })),
  },
  actions: {
    setHistory: assign(({ event }) => {
      if (event.type !== "HISTORY_LOADED") return {};
      return {
        conversationId: event.conversationId,
        messages: event.messages,
        historyError: null,
      };
    }),
    setHistoryError: assign(({ event }) => {
      if (event.type !== "HISTORY_ERROR") return {};
      return {
        historyError: event.error,
        messages: [],
      };
    }),
    addPendingMessage: assign(({ context, event }) => {
      if (event.type !== "SEND_MESSAGE") return {};
      const pendingMessage: ChatMessage = {
        id: `pending-${Date.now()}`,
        role: "user",
        content: event.content,
        timestamp: new Date(),
      };
      return {
        pendingMessages: [...context.pendingMessages, pendingMessage],
      };
    }),
    removePendingMessage: assign(({ context, event }) => {
      if (
        event.type !== "RESPONSE_ERROR" &&
        event.type !== "CONVERSATION_ERROR"
      )
        return {};
      // Remove the most recent pending message on error
      return {
        pendingMessages: context.pendingMessages.slice(0, -1),
      };
    }),
    setConversationId: assign(({ event }) => {
      if (event.type !== "CONVERSATION_CREATED") return {};
      return { conversationId: event.conversationId };
    }),
    setConversationError: assign(({ event }) => {
      if (event.type !== "CONVERSATION_ERROR") return {};
      return {
        error: createChatError("CONVERSATION_CREATE_FAILED", event.error),
      };
    }),
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
      const toolEvent = event.toolEvent;
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
            ? { ...t, ...event.toolResult?.updates }
            : t,
        ),
      };
    }),
    setResponseError: assign(({ event }) => {
      if (event.type !== "RESPONSE_ERROR") return {};
      return {
        error: createChatError("RESPONSE_FAILED", event.error),
      };
    }),
    addProposal: assign(({ context, event }) => {
      if (event.type !== "RESPONSE_CHUNK" || event.chunkType !== "proposal")
        return {};
      if (!event.proposal || !event.toolCallId) return {};

      const proposal = event.proposal as ProposedTest;
      const toolCallId = event.toolCallId;

      // Add proposal to proposals array
      const updatedProposals = [...context.proposals, proposal];

      // Create a message with isProposal flag
      const proposalMessage: ChatMessage = {
        id: `proposal-${toolCallId}`,
        role: "assistant",
        content: `Test proposal for ${proposal.sourceFile}`,
        timestamp: new Date(),
        isProposal: true,
        proposalId: toolCallId,
      };

      // Add proposal message to messages
      const updatedMessages = [...context.messages, proposalMessage];

      // Set proposal status to pending
      const nextStatuses = new Map(context.proposalStatuses);
      nextStatuses.set(toolCallId, "pending");

      return {
        proposals: updatedProposals,
        messages: updatedMessages,
        proposalStatuses: nextStatuses,
      };
    }),
    setProposalStatus: assign(({ context, event }) => {
      if (
        event.type !== "PROPOSAL_APPROVED" &&
        event.type !== "PROPOSAL_REJECTED"
      )
        return {};
      const nextStatuses = new Map(context.proposalStatuses);
      nextStatuses.set(
        event.proposalId,
        event.type === "PROPOSAL_APPROVED" ? "approved" : "rejected",
      );
      return { proposalStatuses: nextStatuses };
    }),
    setProposalError: assign(({ event }) => {
      if (event.type !== "PROPOSAL_ERROR") return {};
      return {
        error: createChatError("PROPOSAL_ACTION_FAILED", event.error),
      };
    }),
    clearError: assign({ error: () => null }),
    clearPendingMessages: assign({ pendingMessages: () => [] }),
    reset: assign({
      conversationId: () => null,
      messages: () => [],
      pendingMessages: () => [],
      streamingContent: () => "",
      toolEvents: () => [],
      proposals: () => [],
      proposalStatuses: () => new Map(),
      error: () => null,
      historyError: () => null,
    }),
  },
  guards: {
    hasConversationId: ({ context }) => !!context.conversationId,
  },
}).createMachine({
  id: "fileChat",
  initial: "initializing",
  context: ({ input }) => ({
    sourceFile: input.sourceFile,
    conversationId: null,
    messages: [],
    pendingMessages: [],
    streamingContent: "",
    toolEvents: [],
    proposals: [],
    proposalStatuses: new Map(),
    error: null,
    historyError: null,
    reasoningContent: "",
    isReasoningStreaming: false,
  }),
  states: {
    initializing: {
      invoke: {
        src: "loadHistory",
        onDone: {
          target: "idle",
          actions: assign(({ event }) => {
            const result = event.output;
            if ("error" in result) {
              return {
                historyError: result.error,
                messages: [],
              };
            }
            return {
              conversationId: result.conversationId,
              messages: result.messages,
              historyError: null,
            };
          }),
        },
        onError: {
          target: "idle",
          actions: assign(({ event }) => ({
            historyError:
              event.error instanceof Error
                ? event.error.message
                : "Failed to load history",
            messages: [],
          })),
        },
      },
      on: {
        HISTORY_LOADED: {
          target: "idle",
          actions: ["setHistory"],
        },
        HISTORY_ERROR: {
          target: "idle",
          actions: ["setHistoryError"],
        },
      },
    },
    idle: {
      on: {
        SEND_MESSAGE: [
          {
            guard: "hasConversationId",
            target: "sending",
            actions: ["addPendingMessage"],
          },
          {
            target: "creatingConversation",
            actions: ["addPendingMessage"],
          },
        ],
        APPROVE_PROPOSAL: {
          target: "approvingProposal",
        },
        REJECT_PROPOSAL: {
          target: "approvingProposal",
        },
        CLEAR_ERROR: {
          actions: ["clearError"],
        },
        RETRY: {
          target: "initializing",
        },
        RESET: {
          target: "initializing",
          actions: ["reset"],
        },
      },
    },
    creatingConversation: {
      on: {
        CONVERSATION_CREATED: {
          target: "sending",
          actions: ["setConversationId"],
        },
        CONVERSATION_ERROR: {
          target: "idle",
          actions: ["setConversationError", "removePendingMessage"],
        },
      },
    },
    sending: {
      on: {
        RESPONSE_CHUNK: {
          target: "streaming",
          actions: [
            "appendStreamingContent",
            "appendReasoningContent",
            "addToolEvent",
            "updateToolEvent",
            "addProposal",
          ],
        },
        RESPONSE_ERROR: {
          target: "idle",
          actions: ["setResponseError", "removePendingMessage"],
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
            "addProposal",
          ],
        },
        RESPONSE_COMPLETE: {
          target: "idle",
          actions: [
            "clearStreamingContent",
            "stopReasoningStreaming",
            "clearPendingMessages",
          ],
        },
        RESPONSE_ERROR: {
          target: "idle",
          actions: ["setResponseError"],
        },
      },
    },
    approvingProposal: {
      on: {
        PROPOSAL_APPROVED: {
          target: "idle",
          actions: ["setProposalStatus"],
        },
        PROPOSAL_REJECTED: {
          target: "idle",
          actions: ["setProposalStatus"],
        },
        PROPOSAL_ERROR: {
          target: "idle",
          actions: ["setProposalError"],
        },
      },
    },
  },
});

export type FileChatMachine = typeof fileChatMachine;
