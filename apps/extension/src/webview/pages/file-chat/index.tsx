import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { useSelector } from "@xstate/react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "../../router/router-context.js";
import { useRpc } from "../../rpc/provider.js";
import { useFileTestActors } from "../../contexts/file-test-actors-context.js";
import { useFileTestActor } from "../dashboard/hooks/use-file-test-actor.js";
import { Button } from "@clive/ui/button";
import { ArrowLeft, MessageSquare } from "lucide-react";
import {
  PromptInputProvider,
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@clive/ui/components/ai-elements/prompt-input";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationEmptyState,
} from "@clive/ui/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@clive/ui/components/ai-elements/message";
import { truncateMiddle } from "../../utils/path-utils.js";
import type { ChatStatus } from "ai";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  isProposal?: boolean;
  proposalId?: string;
}

export const FileChatPage: React.FC = () => {
  const { routeParams, goBack } = useRouter();
  const rpc = useRpc();
  const { getActor } = useFileTestActors();
  const queryClient = useQueryClient();

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessages, setErrorMessages] = useState<ChatMessage[]>([]);

  // Get the source file from route params
  const sourceFile = routeParams.sourceFile || "";

  // Query for conversation history
  const { data: historyData, isLoading: historyLoading } =
    rpc.conversations.getHistory.useQuery({
      input: { sourceFile },
      enabled: !!sourceFile,
    });

  // Check if there's an active actor for this file (from dashboard test generation)
  const actor = getActor(sourceFile);
  const actorState = useSelector(actor, (snapshot) => snapshot);

  // Get actor controls for approving/rejecting proposals
  const { send } = useFileTestActor(sourceFile);

  // Derive messages from conversation history + actor state + error messages
  const allMessages = useMemo(() => {
    const result: ChatMessage[] = [];

    // Add historical conversation messages
    if (historyData?.messages) {
      result.push(
        ...historyData.messages.map((msg) => ({
          id: msg.id,
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content,
          timestamp: new Date(msg.createdAt),
        })),
      );
    }

    // Add streaming content from active actor as assistant message
    if (actorState?.context.streamingContent) {
      result.push({
        id: "streaming-assistant",
        role: "assistant",
        content: actorState.context.streamingContent,
        timestamp: new Date(),
        isStreaming: true,
      });
    }

    // Add progress logs as system messages (show all logs when actor is active)
    if (actorState && actorState.context.logs.length > 0) {
      result.push(
        ...actorState.context.logs.map((log, index) => ({
          id: `log-${index}`,
          role: "system" as const,
          content: log,
          timestamp: new Date(),
        })),
      );
    }

    // Add proposals awaiting approval
    if (
      actorState?.context.proposals &&
      actorState.context.proposals.length > 0
    ) {
      for (const proposal of actorState.context.proposals) {
        const status = actorState.context.testStatuses.get(proposal.id);
        if (status === "pending") {
          result.push({
            id: `proposal-${proposal.id}`,
            role: "assistant",
            content: `**Test Proposal:** ${proposal.description}\n\nTarget: \`${proposal.targetTestPath}\``,
            timestamp: new Date(),
            isProposal: true,
            proposalId: proposal.id,
          });
        }
      }
    }

    // Add any error messages (transient, not persisted to conversation)
    result.push(...errorMessages);

    return result;
  }, [
    historyData?.messages,
    actorState?.context.streamingContent,
    actorState?.context.logs,
    actorState?.context.proposals,
    actorState?.context.testStatuses,
    actorState,
    errorMessages,
  ]);

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
          tests?: unknown[];
        };
        if (progress.type === "message" && progress.content) {
          // Force re-fetch of conversation history to include the new assistant message
          queryClient.invalidateQueries({
            queryKey: ["rpc", "conversations", "getHistory"],
          });
          setIsLoading(false);
        } else if (progress.type === "tests") {
          // Handle tests if needed
          setIsLoading(false);
        }
      },
      onComplete: () => {
        setIsLoading(false);
        // Refresh conversation history to get the final response
        queryClient.invalidateQueries({
          queryKey: ["rpc", "conversations", "getHistory"],
        });
      },
      onError: (error) => {
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}`,
          role: "system",
          content:
            error instanceof Error
              ? error.message
              : "An error occurred. Please try again.",
          timestamp: new Date(),
        };
        // For errors, we still need to add to local state since they're not saved to conversation
        setErrorMessages((prev) => [...prev, errorMessage]);
        setIsLoading(false);
      },
    },
  );

  const handleSendMessage = useCallback(
    async (
      message: { text: string; files: unknown[] },
      event: React.FormEvent<HTMLFormElement>,
    ) => {
      event.preventDefault();

      if (!message.text.trim() || isLoading) {
        return;
      }

      // Note: messages are now derived from allMessages, so we don't need to set them here
      // The user message will be added to the conversation via the RPC subscription
      const messageContent = message.text.trim();
      setIsLoading(true);

      try {
        // Ensure we have a conversation
        let currentConversationId = historyData?.conversationId;
        if (!currentConversationId) {
          const conversation = await startConversationMutation.mutateAsync({
            sourceFile,
          });
          currentConversationId = conversation.conversationId;
        }

        // Send message via subscription
        sendMessageSubscription.subscribe({
          conversationId: currentConversationId,
          sourceFile,
          message: messageContent,
        });
      } catch (error) {
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}`,
          role: "system",
          content:
            error instanceof Error
              ? error.message
              : "An error occurred. Please try again.",
          timestamp: new Date(),
        };
        setErrorMessages((prev) => [...prev, errorMessage]);
        setIsLoading(false);
      }
    },
    [
      sourceFile,
      isLoading,
      historyData?.conversationId,
      startConversationMutation,
      sendMessageSubscription,
    ],
  );

  const approveProposalMutation =
    rpc.conversations.approveProposal.useMutation();

  // Handlers for approving/rejecting proposals
  const handleApproveProposal = useCallback(
    async (proposalId: string) => {
      // First try to approve via conversations RPC (for conversational flow)
      try {
        if (historyData?.conversationId) {
          await approveProposalMutation.mutateAsync({
            conversationId: historyData.conversationId,
            toolCallId: proposalId, // proposalId is actually toolCallId in this context
            approved: true,
          });
        }
      } catch {
        // Fallback to actor approval (for dashboard flow)
        send({ type: "APPROVE", testId: proposalId });
      }
    },
    [send, approveProposalMutation, historyData?.conversationId],
  );

  const handleRejectProposal = useCallback(
    async (proposalId: string) => {
      // First try to reject via conversations RPC (for conversational flow)
      try {
        if (historyData?.conversationId) {
          await approveProposalMutation.mutateAsync({
            conversationId: historyData.conversationId,
            toolCallId: proposalId, // proposalId is actually toolCallId in this context
            approved: false,
          });
        }
      } catch {
        // Fallback to actor rejection (for dashboard flow)
        send({ type: "REJECT", testId: proposalId });
      }
    },
    [send, approveProposalMutation, historyData?.conversationId],
  );

  const chatStatus = useMemo<ChatStatus>(() => {
    if (isLoading) return "streaming";
    // If actor is actively streaming content, show as streaming
    if (actorState?.context.streamingContent) return "streaming";
    return "idle" as ChatStatus;
  }, [isLoading, actorState?.context.streamingContent]);

  // Derive current agent state for status indicator
  const agentStatus = useMemo(() => {
    if (!actorState) return null;
    if (actorState.matches({ planningPhase: "planning" }))
      return "Planning tests...";
    if (actorState.matches({ planningPhase: "streaming" }))
      return "Generating content...";
    if (actorState.matches({ planningPhase: "awaitingApproval" }))
      return "Awaiting your approval";
    if (actorState.matches({ planningPhase: "generating" }))
      return "Writing test files...";
    if (actorState.matches("completed")) return "Completed";
    if (actorState.matches("error")) return "Error";
    return null;
  }, [actorState]);

  if (!sourceFile) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">No file selected</h2>
        <p className="text-muted-foreground mb-4">
          Please select a file to start chatting.
        </p>
        <Button onClick={goBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <PromptInputProvider>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-4 p-4 border-b">
          <Button variant="ghost" size="icon" onClick={goBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold truncate" title={sourceFile}>
              Chat about{" "}
              {truncateMiddle(sourceFile.split("/").pop() || sourceFile)}
            </h1>
            <p className="text-sm text-muted-foreground">
              Refine test proposals through conversation
            </p>
            {agentStatus && (
              <p className="text-xs text-blue-600 font-medium mt-1">
                {agentStatus}
              </p>
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col min-h-0">
          <Conversation className="flex-1">
            <ConversationContent>
              {historyLoading ? (
                <ConversationEmptyState
                  title="Loading conversation..."
                  description="Please wait while we load your chat history"
                  icon={
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  }
                />
              ) : allMessages.length === 0 ? (
                <ConversationEmptyState
                  title="Start a conversation"
                  description={`Chat with the AI agent to refine test proposals for ${truncateMiddle(sourceFile.split("/").pop() || sourceFile)}`}
                  icon={<MessageSquare className="h-8 w-8" />}
                />
              ) : (
                allMessages.map((message) => (
                  <Message key={message.id} from={message.role}>
                    <MessageContent>
                      <MessageResponse
                        className={message.isStreaming ? "animate-pulse" : ""}
                      >
                        {message.content}
                      </MessageResponse>
                      {message.isProposal && message.proposalId && (
                        <div className="flex gap-2 mt-3">
                          <Button
                            size="sm"
                            onClick={() =>
                              message.proposalId &&
                              handleApproveProposal(message.proposalId)
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              message.proposalId &&
                              handleRejectProposal(message.proposalId)
                            }
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                    </MessageContent>
                  </Message>
                ))
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          {/* Input Area */}
          <div className="border-t bg-background">
            <PromptInput onSubmit={handleSendMessage}>
              <PromptInputTextarea placeholder="Ask about test proposals, request changes, or get suggestions..." />
              <PromptInputFooter>
                <PromptInputSubmit status={chatStatus as ChatStatus} />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </div>
    </PromptInputProvider>
  );
};
