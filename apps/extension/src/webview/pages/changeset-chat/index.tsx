import type React from "react";
import { useMemo, type FormEvent } from "react";
import { useRouter } from "../../router/router-context.js";
import { Button } from "@clive/ui/button";
import { AlertCircle, GitBranch } from "lucide-react";
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
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@clive/ui/components/ai-elements/reasoning";
import { useChangesetChat } from "./hooks/use-changeset-chat.js";
import { ToolTask } from "./components/tool-task.js";
import { FloatingApprovalBar } from "./components/floating-approval-bar.js";
import { ScratchpadQueue } from "./components/scratchpad-queue.js";

export const ChangesetChatPage: React.FC = () => {
  const { routeParams, goBack } = useRouter();

  // Parse files from route params
  const files = useMemo(() => {
    try {
      const filesParam = routeParams.files;
      if (!filesParam) return [];
      return JSON.parse(filesParam) as string[];
    } catch {
      return [];
    }
  }, [routeParams.files]);

  const branchName = routeParams.branchName || "";

  // Use the changeset chat hook with state machine
  const {
    messages,
    reasoningContent,
    isReasoningStreaming,
    error,
    isLoading,
    hasCompletedAnalysis,
    scratchpadTodos,
    send,
  } = useChangesetChat({ files, branchName });

  const handleApprove = () => {
    // Send message to agent requesting test writes
    send({
      type: "SEND_MESSAGE",
      content: "Please write the tests as proposed in your analysis.",
    });
  };

  const handleSubmit = (
    message: { text: string; files?: unknown[] },
    _event: FormEvent<HTMLFormElement>,
  ) => {
    if (!message.text.trim()) return;
    send({
      type: "SEND_MESSAGE",
      content: message.text.trim(),
    });
  };

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <GitBranch className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">No files selected</h2>
        <p className="text-muted-foreground mb-4">
          Please select files to analyze.
        </p>
        <Button onClick={goBack}>Back to Dashboard</Button>
      </div>
    );
  }

  return (
    <PromptInputProvider>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-4 py-2 border-b">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            <span className="text-sm font-medium">{branchName}</span>
            <span className="text-xs text-muted-foreground">
              ({files.length} file{files.length !== 1 ? "s" : ""})
            </span>
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col min-h-0">
          <Conversation className="flex-1">
            <ConversationContent>
              {/* Error banner */}
              {error && (
                <div className="mb-4 p-3 bg-error-muted border border-destructive/50 rounded-lg flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <div className="flex-1">
                    <p className="text-sm text-destructive">
                      {error.message}
                    </p>
                    {error.retryable && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={() => send({ type: "CLEAR_ERROR" })}
                      >
                        Dismiss
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Reasoning output - shown separately above timeline */}
              {reasoningContent && (
                <Reasoning isStreaming={isReasoningStreaming}>
                  <ReasoningTrigger />
                  <ReasoningContent>{reasoningContent}</ReasoningContent>
                </Reasoning>
              )}

              {/* Scratchpad Queue - shows agent's TODO list */}
              <ScratchpadQueue todos={scratchpadTodos} />

              {/* Empty state */}
              {isLoading && messages.length === 0 ? (
                <ConversationEmptyState
                  title="Analyzing changes..."
                  description="The AI agent is analyzing all changed files together to propose comprehensive tests"
                  icon={
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  }
                />
              ) : messages.length === 0 ? (
                <ConversationEmptyState
                  title="Ready to analyze"
                  description={`Analyze ${files.length} changed file${files.length !== 1 ? "s" : ""} for test opportunities`}
                  icon={<GitBranch className="h-8 w-8" />}
                />
              ) : (
                /* Render messages with parts */
                messages.map((message) => (
                  <Message key={message.id} from={message.role}>
                    <MessageContent>
                      {message.parts.map((part, index) => {
                        if (part.type === "text") {
                          return (
                            <MessageResponse
                              key={`${message.id}-text-${index}`}
                            >
                              {part.text}
                            </MessageResponse>
                          );
                        }

                        // All tools use ToolTask
                        if (part.type.startsWith("tool-")) {
                          return (
                            <ToolTask
                              key={`${message.id}-tool-${part.toolCallId}`}
                              toolName={part.toolName}
                              toolCallId={part.toolCallId}
                              state={part.state}
                              input={part.input}
                              output={part.output}
                              errorText={part.errorText}
                            />
                          );
                        }

                        return null;
                      })}
                    </MessageContent>
                  </Message>
                ))
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          {/* Floating Approval Bar */}
          <FloatingApprovalBar
            isVisible={hasCompletedAnalysis && !isLoading}
            onApprove={handleApprove}
          />

          {/* Input Area */}
          <div className="border-t bg-background">
            <PromptInput onSubmit={handleSubmit}>
              <PromptInputTextarea
                placeholder={
                  hasCompletedAnalysis
                    ? "Type your feedback or questions..."
                    : "Chat will be enabled after analysis completes..."
                }
                disabled={!hasCompletedAnalysis || isLoading}
              />
              <PromptInputFooter>
                <PromptInputSubmit />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </div>
    </PromptInputProvider>
  );
};
