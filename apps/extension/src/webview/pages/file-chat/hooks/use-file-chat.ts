import { useMemo, useCallback } from "react";
import { useMachine } from "@xstate/react";
import { fromPromise } from "xstate";
import { useQueryClient } from "@tanstack/react-query";
import { Match } from "effect";
import { useRpc } from "../../../rpc/provider.js";
import { fileChatMachine } from "../machines/file-chat-machine.js";
import type {
  ChatMessage,
  ToolEvent,
} from "../../dashboard/machines/file-test-machine.js";
import type { ProposedTest } from "../../../../services/ai-agent/types.js";

// Import types for actor
type HistoryResult = {
  conversationId: string | null;
  messages: ChatMessage[];
};

type HistoryError = {
  error: string;
};

interface UseFileChatOptions {
  sourceFile: string;
}

export function useFileChat({ sourceFile }: UseFileChatOptions) {
  const rpc = useRpc();
  const queryClient = useQueryClient();

  // Query for conversation history - machine will invoke this via actor
  const historyQuery = rpc.conversations.getHistory.useQuery({
    input: { sourceFile },
    enabled: false, // Machine will control when to load
  });

  // Create promise-based function for machine to invoke
  const loadHistory = useCallback(async () => {
    try {
      const result = await historyQuery.refetch();
      if (result.error) {
        return {
          error:
            result.error instanceof Error
              ? result.error.message
              : "Failed to load conversation history",
        };
      }

      if (result.data) {
        const messages: ChatMessage[] = result.data.messages.map(
          (msg: {
            id: string;
            role: string;
            content: string;
            createdAt: string;
          }) => ({
            id: msg.id,
            role: msg.role as "user" | "assistant" | "system",
            content: msg.content,
            timestamp: new Date(msg.createdAt),
          }),
        );

        return {
          conversationId: result.data.conversationId,
          messages,
        };
      }

      return {
        conversationId: null,
        messages: [],
      };
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load conversation history",
      };
    }
  }, [historyQuery]);

  // Provide the actor implementation at runtime
  const machineWithActors = useMemo(
    () =>
      fileChatMachine.provide({
        actors: {
          loadHistory: fromPromise<HistoryResult | HistoryError, void>(
            async () => {
              return await loadHistory();
            },
          ),
        },
      }),
    [loadHistory],
  );

  const [state, send] = useMachine(machineWithActors, {
    input: {
      sourceFile,
    },
  });

  // Start conversation mutation
  const startConversationMutation = rpc.conversations.start.useMutation();

  // Send message subscription
  const sendMessageSubscription = rpc.conversations.sendMessage.useSubscription(
    {
      enabled: false,
      onData: (data: unknown) => {
        const progress = data as {
          type?: string;
          content?: string;
          toolCallId?: string;
          toolName?: string;
          args?: unknown;
          output?: unknown;
          state?: ToolEvent["state"];
          tests?: unknown[];
          test?: ProposedTest;
        };

        Match.value(progress).pipe(
          Match.when({ type: "message" }, (p) => {
            if (p.content) {
              send({
                type: "RESPONSE_CHUNK",
                chunkType: "message",
                content: p.content,
              });
              queryClient.invalidateQueries({
                queryKey: ["rpc", "conversations", "getHistory"],
              });
            }
          }),
          Match.when({ type: "content_streamed" }, (p) => {
            if (p.content) {
              send({
                type: "RESPONSE_CHUNK",
                chunkType: "message",
                content: p.content,
              });
            }
          }),
          Match.when({ type: "tool-call" }, (p) => {
            send({
              type: "RESPONSE_CHUNK",
              chunkType: "tool-call",
              toolEvent: {
                toolCallId: p.toolCallId || "",
                toolName: p.toolName || "",
                args: p.args,
                state: p.state || "input-streaming",
              },
            });
          }),
          Match.when({ type: "tool-result" }, (p) => {
            send({
              type: "RESPONSE_CHUNK",
              chunkType: "tool-result",
              toolResult: {
                toolCallId: p.toolCallId || "",
                updates: {
                  output: p.output,
                  state: p.state || "output-available",
                },
              },
            });
          }),
          Match.when({ type: "tests" }, (p) => {
            send({
              type: "RESPONSE_CHUNK",
              chunkType: "tests",
              tests: p.tests,
            });
          }),
          Match.when({ type: "reasoning" }, (p) => {
            if (p.content) {
              send({
                type: "RESPONSE_CHUNK",
                chunkType: "reasoning",
                content: p.content,
              });
            }
          }),
          Match.when({ type: "proposal" }, (p) => {
            const proposalData = p as {
              type: "proposal";
              test?: ProposedTest;
              toolCallId?: string;
            };
            send({
              type: "RESPONSE_CHUNK",
              chunkType: "proposal",
              proposal: proposalData.test,
              toolCallId: proposalData.toolCallId || "",
            });
          }),
          Match.orElse(() => {
            // No-op for unknown types
          }),
        );
      },
      onComplete: () => {
        send({ type: "RESPONSE_COMPLETE" });
        // Refresh conversation history to get the final response
        queryClient.invalidateQueries({
          queryKey: ["rpc", "conversations", "getHistory"],
        });
      },
      onError: (error) => {
        console.error("[useFileChat] Subscription error:", error);
        send({ type: "RESPONSE_ERROR", error });
      },
    },
  );

  // Proposal approval mutation
  const approveProposalMutation =
    rpc.conversations.approveProposal.useMutation();

  // Handle sending messages
  const sendMessage = useCallback(
    async (content: string) => {
      if (
        !content.trim() ||
        state.matches("sending") ||
        state.matches("streaming")
      ) {
        console.log("[useFileChat] Message send blocked:", {
          isEmpty: !content.trim(),
          isSending: state.matches("sending"),
          isStreaming: state.matches("streaming"),
        });
        return;
      }

      console.log("[useFileChat] Starting message send:", {
        messageLength: content.length,
        sourceFile,
        hasConversationId: !!state.context.conversationId,
      });

      // Check conversationId before sending event
      let conversationId = state.context.conversationId;

      // If we don't have a conversationId, create the conversation first
      if (!conversationId) {
        try {
          console.log(
            "[useFileChat] No conversation found, creating new one for:",
            sourceFile,
          );
          const conversation = await startConversationMutation.mutateAsync({
            sourceFile,
          });
          conversationId = conversation.conversationId;
          console.log("[useFileChat] Conversation created:", conversationId);
          send({ type: "CONVERSATION_CREATED", conversationId });
        } catch (error) {
          console.error("[useFileChat] Error creating conversation:", error);
          send({ type: "CONVERSATION_ERROR", error });
          return;
        }
      }

      // Now send the message event (machine will transition to sending state)
      send({ type: "SEND_MESSAGE", content });

      try {
        // Subscribe to send message
        if (!conversationId) {
          console.error(
            "[useFileChat] No conversationId available for subscription",
          );
          return;
        }
        console.log("[useFileChat] Subscribing to sendMessage:", {
          conversationId,
          sourceFile,
          messageLength: content.length,
        });
        sendMessageSubscription.subscribe({
          conversationId,
          sourceFile,
          message: content.trim(),
        });
        console.log("[useFileChat] Subscription initiated successfully");
      } catch (error) {
        console.error("[useFileChat] Error sending message:", error);
        console.error("[useFileChat] Error details:", {
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          sourceFile,
          messageLength: content.length,
        });
        send({ type: "RESPONSE_ERROR", error });
      }
    },
    [
      sourceFile,
      state,
      send,
      startConversationMutation,
      sendMessageSubscription,
    ],
  );

  // Handle proposal approval/rejection
  const approveProposal = useCallback(
    async (proposalId: string) => {
      send({ type: "APPROVE_PROPOSAL", proposalId });
      try {
        if (state.context.conversationId) {
          await approveProposalMutation.mutateAsync({
            conversationId: state.context.conversationId,
            toolCallId: proposalId,
            approved: true,
          });
          send({ type: "PROPOSAL_APPROVED", proposalId });
        }
      } catch (error) {
        console.error("[useFileChat] Error approving proposal:", error);
        send({ type: "PROPOSAL_ERROR", proposalId, error });
      }
    },
    [state.context.conversationId, approveProposalMutation, send],
  );

  const rejectProposal = useCallback(
    async (proposalId: string) => {
      send({ type: "REJECT_PROPOSAL", proposalId });
      try {
        if (state.context.conversationId) {
          await approveProposalMutation.mutateAsync({
            conversationId: state.context.conversationId,
            toolCallId: proposalId,
            approved: false,
          });
          send({ type: "PROPOSAL_REJECTED", proposalId });
        }
      } catch (error) {
        console.error("[useFileChat] Error rejecting proposal:", error);
        send({ type: "PROPOSAL_ERROR", proposalId, error });
      }
    },
    [state.context.conversationId, approveProposalMutation, send],
  );

  // Derive all messages (history + pending + streaming)
  const allMessages = useMemo(() => {
    const result: ChatMessage[] = [...state.context.messages];

    // Add pending user messages (optimistic updates)
    result.push(...state.context.pendingMessages);

    // Add streaming content as assistant message
    if (state.context.streamingContent) {
      result.push({
        id: "streaming-assistant",
        role: "assistant",
        content: state.context.streamingContent,
        timestamp: new Date(),
        isStreaming: true,
      });
    }

    // Add error messages if any
    if (state.context.error) {
      result.push({
        id: `error-${Date.now()}`,
        role: "system",
        content: state.context.error.message,
        timestamp: new Date(),
      });
    }

    return result;
  }, [
    state.context.messages,
    state.context.pendingMessages,
    state.context.streamingContent,
    state.context.error,
  ]);

  // Derive chat status
  const chatStatus = useMemo(() => {
    if (state.matches("sending") || state.matches("streaming")) {
      return "streaming" as const;
    }
    return "idle" as const;
  }, [state]);

  return {
    // Derived state
    allMessages,
    chatStatus,
    isLoading: historyQuery.isLoading || state.matches("initializing"),
    isSending: state.matches("sending") || state.matches("streaming"),
    // Actions
    sendMessage,
    approveProposal,
    rejectProposal,
    send,
    // Error state
    error: state.context.error,
    historyError: state.context.historyError,
    // Tool events
    toolEvents: state.context.toolEvents,
    // Reasoning state
    reasoningContent: state.context.reasoningContent,
    isReasoningStreaming: state.context.isReasoningStreaming,
  };
}
