import type React from "react";
import { useMemo } from "react";
import { useSelector } from "@xstate/react";
import { useRouter } from "../../router/router-context.js";
import { useFileTestActors } from "../../contexts/file-test-actors-context.js";
import { Button } from "@clive/ui/button";
import { MessageSquare, AlertCircle } from "lucide-react";
import { useFileChat } from "./hooks/use-file-chat.js";
import type { ChatStatus } from "ai";
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
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@clive/ui/components/ai-elements/tool";
import { truncateMiddle } from "../../utils/path-utils.js";

export const FileChatPage: React.FC = () => {
  const { routeParams, goBack } = useRouter();
  const { getActor } = useFileTestActors();

  // Get the source file from route params
  const sourceFile = routeParams.sourceFile || "";

  // Use the file chat machine hook
  const {
    allMessages,
    chatStatus,
    isLoading,
    isSending,
    error,
    historyError,
    toolEvents,
    sendMessage,
    approveProposal,
    rejectProposal,
    send: sendChatEvent,
  } = useFileChat({ sourceFile });

  // Check if there's an active actor for this file (from dashboard test generation)
  // This is separate from chat state - it's for test generation workflow
  const actor = getActor(sourceFile);
  const actorState = useSelector(actor, (snapshot) => snapshot);

  // Derive current agent state for status indicator (from test generation actor)
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

  // Handle message sending
  const handleSendMessage = async (
    message: { text: string; files: unknown[] },
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!message.text.trim() || isSending) {
      return;
    }
    await sendMessage(message.text.trim());
  };

  if (!sourceFile) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">No file selected</h2>
        <p className="text-muted-foreground mb-4">
          Please select a file to start chatting.
        </p>
        <Button onClick={goBack}>Back to Dashboard</Button>
      </div>
    );
  }

  return (
    <PromptInputProvider>
      <div className="flex flex-col h-full">
        {/* Minimal title bar - main header handles navigation */}
        {agentStatus && (
          <div className="px-4 py-2 border-b">
            <p className="text-xs text-blue-600 font-medium">{agentStatus}</p>
          </div>
        )}

        {/* Chat Area */}
        <div className="flex-1 flex flex-col min-h-0">
          <Conversation className="flex-1">
            <ConversationContent>
              {/* Render error banners */}
              {historyError && (
                <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                  <div className="flex-1">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      Failed to load conversation history: {historyError}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => sendChatEvent({ type: "RETRY" })}
                    >
                      Retry
                    </Button>
                  </div>
                </div>
              )}
              {error?.retryable && (
                <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                  <div className="flex-1">
                    <p className="text-sm text-red-800 dark:text-red-200">
                      {error.message}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => sendChatEvent({ type: "CLEAR_ERROR" })}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}
              {/* Render tool events */}
              {toolEvents.map((toolEvent) => (
                <Tool key={toolEvent.toolCallId}>
                  <ToolHeader
                    title={toolEvent.toolName}
                    type={toolEvent.toolName as `tool-${string}`}
                    state={toolEvent.state}
                  />
                  <ToolContent>
                    <ToolInput input={toolEvent.args} />
                    {(toolEvent.output || toolEvent.errorText) && (
                      <ToolOutput
                        output={toolEvent.output}
                        errorText={toolEvent.errorText}
                      />
                    )}
                  </ToolContent>
                </Tool>
              ))}
              {isLoading ? (
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
                              approveProposal(message.proposalId)
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              message.proposalId &&
                              rejectProposal(message.proposalId)
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
