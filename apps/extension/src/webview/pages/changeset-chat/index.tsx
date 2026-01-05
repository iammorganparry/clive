import type React from "react";
import { useMemo, useCallback, type FormEvent } from "react";
import { useRouter } from "../../router/router-context.js";
import { Button } from "@clive/ui/button";
import { GitBranch, Plus, SquareIcon } from "lucide-react";
import {
  PromptInputProvider,
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputContext,
  PromptInputButton,
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
import { ToolCallCard } from "./components/tool-call-card.js";
import { PlanApprovalCard } from "./components/plan-approval-card.js";
import { TestPlanPreview } from "./components/test-plan-preview.js";
import { ErrorBanner } from "./components/error-banner.js";
import { LoopProgressDisplay } from "./components/loop-progress-display.js";
import { UserMessageText } from "./components/user-message-text.js";
import { AgentStatusIndicator } from "./components/agent-status-indicator.js";
import { parsePlan } from "./utils/parse-plan.js";
import type { MessagePart } from "../../types/chat.js";

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
  const baseBranch = routeParams.baseBranch || "main";
  const mode = (routeParams.mode as "branch" | "uncommitted") || "branch";
  const commitHash = routeParams.commitHash;

  // Use the changeset chat hook with state machine
  const {
    messages,
    error,
    isLoading,
    isLoadingHistory,
    hasCompletedAnalysis,
    isAnalyzing,
    usage,
    planContent,
    planFilePath,
    agentMode,
    subscriptionId,
    approvalMode,
    // Ralph Wiggum loop state
    loopTodos,
    loopProgress,
    loopIteration,
    loopMaxIterations,
    loopExitReason,
    send,
    cancelStream,
  } = useChangesetChat({ files, branchName, baseBranch, mode, commitHash });

  // Render conversation content based on loading states
  const renderConversationContent = useCallback((): React.ReactNode => {
    if (isLoadingHistory) {
      return (
        <ConversationEmptyState
          title="Loading conversation..."
          description="Retrieving previous conversation history"
          icon={
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          }
        />
      );
    }

    if (isLoading && messages.length === 0) {
      return (
        <ConversationEmptyState
          title="Analyzing changes..."
          description="The AI agent is analyzing all changed files together to propose comprehensive tests"
          icon={
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          }
        />
      );
    }

    if (messages.length === 0) {
      return (
        <ConversationEmptyState
          title="Ready to analyze"
          description={`Analyze ${files.length} changed file${files.length !== 1 ? "s" : ""} for test opportunities`}
          icon={<GitBranch className="h-8 w-8" />}
        />
      );
    }

    // Render messages with parts
    return messages.map((message) => {
      const isStreaming =
        message.isStreaming ||
        (isLoading && message.id === messages[messages.length - 1]?.id);

      return (
        <Message key={message.id} from={message.role}>
          <MessageContent>
            {message.parts.map((part: MessagePart, index: number) => {
              if (part.type === "text") {
                // Check if this text part contains a plan
                const plan = parsePlan(part.text);
                if (plan) {
                  return (
                    <TestPlanPreview
                      key={`${message.id}-plan-${index}`}
                      plan={plan}
                      isStreaming={isStreaming}
                      filePath={planFilePath}
                    />
                  );
                }

                // For user messages, use UserMessageText with truncation
                if (message.role === "user") {
                  return (
                    <UserMessageText 
                      key={`${message.id}-text-${index}`} 
                      text={part.text} 
                    />
                  );
                }

                // For assistant messages, use MessageResponse (existing behavior)
                return (
                  <MessageResponse key={`${message.id}-text-${index}`}>
                    {part.text}
                  </MessageResponse>
                );
              }

              // Render reasoning parts inline - always visible while streaming
              if (part.type === "reasoning") {
                return (
                  <Reasoning
                    className="mt-2"
                    key={`${message.id}-reasoning-${index}`}
                    isStreaming={part.isStreaming ?? false}
                    defaultOpen={true}
                  >
                    <ReasoningTrigger />
                    <ReasoningContent>{part.content}</ReasoningContent>
                  </Reasoning>
                );
              }

              // All tools use ToolCallCard
              if (part.type.startsWith("tool-")) {
                return (
                  <ToolCallCard
                    key={`${message.id}-tool-${part.toolCallId}`}
                    toolName={part.toolName}
                    state={part.state}
                    input={part.input}
                    output={part.output}
                    errorText={part.errorText}
                    streamingContent={part.streamingContent}
                    toolCallId={part.toolCallId}
                    subscriptionId={subscriptionId ?? undefined}
                  />
                );
              }

              return null;
            })}
          </MessageContent>
        </Message>
      );
    });
  }, [isLoadingHistory, isLoading, messages, files.length, planFilePath, subscriptionId]);

  const handleApprove = (approvalMode: "auto" | "manual" = "auto") => {
    // Dispatch APPROVE_PLAN event with empty suites - agent will read plan from conversation context
    send({ type: "APPROVE_PLAN", suites: [], approvalMode });
  };

  const handleNewChat = () => {
    // Reset conversation state and start fresh analysis
    send({ type: "RESET" });
    send({ type: "START_ANALYSIS" });
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
        <div className="px-3 py-1.5 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              <span className="text-sm font-medium">{branchName}</span>
              <span className="text-xs text-muted-foreground">
                ({files.length} file{files.length !== 1 ? "s" : ""})
              </span>
              {branchName !== baseBranch && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {mode === "branch" ? "All Changes" : "Uncommitted"}
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleNewChat}
              disabled={isLoading}
              aria-label="New Chat"
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col min-h-0">
          <Conversation className="flex-1">
            <ConversationContent>
              {/* Error banner */}
              {error && (
                <ErrorBanner
                  error={error}
                  onRetry={() => {
                    send({ type: "CLEAR_ERROR" });
                    send({ type: "RESET" });
                    send({ type: "START_ANALYSIS" });
                  }}
                  onDismiss={() => send({ type: "CLEAR_ERROR" })}
                />
              )}

              {/* Empty state or messages */}
              {renderConversationContent()}

              {/* Loading indicator while waiting for agent response */}
              {isAnalyzing && <AgentStatusIndicator />}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          {/* Loop Progress Display - shows progress when in act mode */}
          {agentMode === "act" && loopTodos.length > 0 && (
            <div className="border-t bg-background">
              <LoopProgressDisplay
                todos={loopTodos}
                progress={loopProgress}
                iteration={loopIteration}
                maxIterations={loopMaxIterations}
                exitReason={loopExitReason}
              />
            </div>
          )}

          {/* Plan Approval Card - show when agent completes in plan mode with plan content */}
          {hasCompletedAnalysis && !isLoading && agentMode === "plan" && approvalMode === null && planContent && (
            <div className="border-t bg-background p-3">
              <PlanApprovalCard
                isStreaming={false}
                onApprove={handleApprove}
                onReject={(feedback) => {
                  send({ type: "SEND_MESSAGE", content: feedback });
                }}
              />
            </div>
          )}

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
                <PromptInputContext
                  maxTokens={200000}
                  usedTokens={
                    usage
                      ? (usage.inputTokens ?? 0) +
                        (usage.outputTokens ?? 0) +
                        (usage.reasoningTokens ?? 0)
                      : 0
                  }
                  usage={usage ?? undefined}
                  modelId="anthropic:claude-haiku-4-5"
                />
                {isLoading ? (
                  <PromptInputButton
                    type="button"
                    variant="default"
                    size="icon-sm"
                    onClick={cancelStream}
                    aria-label="Stop"
                  >
                    <SquareIcon className="size-4" />
                  </PromptInputButton>
                ) : (
                  <PromptInputSubmit />
                )}
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </div>
      {/* Dev Testing Toolbar - only in development */}
      {/* <DevTestingToolbar send={send} /> */}
    </PromptInputProvider>
  );
};
