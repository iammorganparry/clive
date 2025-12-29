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
import { FloatingApprovalBar } from "./components/floating-approval-bar.js";
import { ScratchpadQueue } from "./components/scratchpad-queue.js";
import { TestPlanPreview } from "./components/test-plan-preview.js";
import { ErrorBanner } from "./components/error-banner.js";
import { TestSuiteQueue } from "./components/test-suite-queue.js";
import { DevTestingToolbar } from "./components/dev-testing-toolbar.js";
import { UserMessageText } from "./components/user-message-text.js";
import { parsePlan, parsePlanSections } from "./utils/parse-plan.js";
import type { MessagePart, ChatMessage } from "../../types/chat.js";
import type { TestSuiteQueueItem } from "./machines/changeset-chat-machine.js";

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
  const mode = (routeParams.mode as "branch" | "uncommitted") || "branch";
  const commitHash = routeParams.commitHash;

  // Use the changeset chat hook with state machine
  const {
    messages,
    error,
    isLoading,
    isLoadingHistory,
    hasCompletedAnalysis,
    scratchpadTodos,
    usage,
    planContent,
    planFilePath,
    testSuiteQueue,
    currentSuiteId,
    agentMode,
    subscriptionId,
    hasPendingPlanApproval,
    send,
    cancelStream,
  } = useChangesetChat({ files, branchName, mode, commitHash });

  // Parse plan content if available
  const parsedPlan = planContent ? parsePlan(planContent) : null;
  
  // Get suite count from parsed plan or parse sections from planContent
  const suiteCount = useMemo(() => {
    if (parsedPlan?.suites) {
      return parsedPlan.suites.length;
    }
    if (planContent) {
      const sections = parsePlanSections(planContent);
      return sections.length;
    }
    return 0;
  }, [parsedPlan, planContent]);

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

              // Render reasoning parts inline
              if (part.type === "reasoning") {
                return (
                  <Reasoning 
                    key={`${message.id}-reasoning-${index}`}
                    isStreaming={part.isStreaming ?? false}
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

  // Extract planContent from proposeTestPlan tool output in messages
  const extractPlanContentFromMessages = useCallback((messages: ChatMessage[]): string | null => {
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (
          part.type.startsWith("tool-") &&
          "toolName" in part &&
          part.toolName === "proposeTestPlan" &&
          "input" in part &&
          part.input &&
          typeof part.input === "object" &&
          "planContent" in part.input
        ) {
          return (part.input as { planContent?: string }).planContent || null;
        }
      }
    }
    return null;
  }, []);

  const handleApprove = () => {
    // Try planContent from state, fallback to extracting from tool call messages
    const content = planContent || extractPlanContentFromMessages(messages);
    
    console.log("[handleApprove] planContent:", planContent ? "present" : "null");
    console.log("[handleApprove] content (with fallback):", content ? "present" : "null");
    
    if (!content) {
      console.warn("[handleApprove] No plan content available");
      return;
    }

    // Parse Implementation Plan sections from plan content
    const sections = parsePlanSections(content);
    
    console.log("[handleApprove] sections parsed:", sections.length);

    if (sections.length === 0) {
      // Fallback: send message if parsing fails
      send({
        type: "SEND_MESSAGE",
        content: "Please write the tests as proposed in your analysis.",
      });
      return;
    }

    // Convert to queue items
    const suites: TestSuiteQueueItem[] = sections.map((section) => ({
      id: `suite-${section.sectionNumber}`,
      name: section.name,
      testType: section.testType,
      targetFilePath: section.targetFilePath,
      sourceFiles: [], // TODO: parse from section if needed
      status: "pending",
      description: section.description,
    }));

    // Dispatch APPROVE_PLAN event to populate queue and switch to act mode
    send({ type: "APPROVE_PLAN", suites });

    // Send focused message for first suite
    const firstSuite = suites[0];
    if (firstSuite) {
      send({
        type: "SEND_MESSAGE",
        content: `Write tests for: ${firstSuite.name}\nTarget file: ${firstSuite.targetFilePath}\nTest type: ${firstSuite.testType}\n\nFocus only on this suite. Other suites will be handled separately.`,
      });
    }
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
        <div className="px-4 py-2 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              <span className="text-sm font-medium">{branchName}</span>
              <span className="text-xs text-muted-foreground">
                ({files.length} file{files.length !== 1 ? "s" : ""})
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {mode === "branch" ? "All Changes" : "Uncommitted"}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNewChat}
              disabled={isLoading}
            >
              <Plus className="size-3" />
              New Chat
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

              {/* Scratchpad Queue - shows agent's TODO list */}
              <ScratchpadQueue todos={scratchpadTodos} />

              {/* Plan Preview - shown when agent creates plan in scratchpad */}
              {parsedPlan && (
                <TestPlanPreview
                  plan={parsedPlan}
                  isStreaming={isLoading}
                  filePath={planFilePath}
                />
              )}

              {/* Empty state or messages */}
              {renderConversationContent()}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          {/* Test Suite Queue - shows progress when in act mode */}
          {agentMode === "act" && testSuiteQueue.length > 0 && (
            <div className="border-t bg-background px-4 py-2">
              <TestSuiteQueue 
                queue={testSuiteQueue} 
                currentSuiteId={currentSuiteId}
                onSkipSuite={(suiteId) => send({ type: "SKIP_SUITE", suiteId })}
              />
            </div>
          )}

          {/* Floating Approval Bar - only show when there's a test proposal */}
          <FloatingApprovalBar
            isVisible={hasCompletedAnalysis && !isLoading && hasPendingPlanApproval && agentMode === "plan"}
            onApprove={handleApprove}
            suiteCount={suiteCount}
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
      <DevTestingToolbar send={send} />
    </PromptInputProvider>
  );
};
