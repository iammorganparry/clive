import { useMachine } from "@xstate/react";
import type { LanguageModelUsage } from "ai";
import { Match } from "effect";
import { useEffect, useCallback } from "react";
import { useRpc } from "../../../rpc/provider.js";
import type { ToolEvent } from "../../../types/chat.js";
import {
  changesetChatMachine,
  type TestSuiteQueueItem,
} from "../machines/changeset-chat-machine.js";
import { mcpBridgeEventEmitter } from "../../../services/mcp-bridge-events.js";

interface UseChangesetChatOptions {
  files: string[];
  branchName: string;
  baseBranch?: string;
  mode?: "branch" | "uncommitted";
  commitHash?: string;
}

export function useChangesetChat({
  files,
  branchName,
  baseBranch = "main",
  mode = "branch",
  commitHash,
}: UseChangesetChatOptions) {
  const rpc = useRpc();

  const [state, send] = useMachine(changesetChatMachine, {
    input: {
      files,
      branchName,
    },
  });

  // Load conversation history from backend
  const { data: historyData, isLoading: isHistoryLoading } =
    rpc.conversations.getBranchHistory.useQuery({
      input: {
        branchName,
        baseBranch,
        conversationType: mode,
        commitHash,
      },
      enabled:
        branchName.length > 0 && (mode !== "uncommitted" || !!commitHash),
    });

  // Send backend history when query completes
  useEffect(() => {
    if (
      state.value === "idle" &&
      !state.context.historyLoaded &&
      !isHistoryLoading
    ) {
      send({
        type: "RECEIVE_BACKEND_HISTORY",
        historyData: historyData ?? null,
      });
    }
  }, [
    historyData,
    state.value,
    state.context.historyLoaded,
    send,
    isHistoryLoading,
  ]);

  // MCP bridge event handlers for plan approval and context summarization
  const handlePlanApproval = useCallback(
    (data: { approved: boolean; planId?: string; feedback?: string }) => {
      console.log("[MCP Bridge] Plan approval event received:", data);
      if (data.approved) {
        // When approved via MCP bridge, dispatch APPROVE_PLAN with current queue
        const suites = state.context.testSuiteQueue;
        send({ type: "APPROVE_PLAN", suites });
      }
      // Rejection is handled by the MCP response - agent stays in plan mode
    },
    [send, state.context.testSuiteQueue],
  );

  const handleSummarizeContext = useCallback(
    (data: {
      summary: string;
      tokensBefore?: number;
      tokensAfter?: number;
      preserveKnowledge: boolean;
    }) => {
      console.log("[MCP Bridge] Context summarization event received:", data);
      // Context summarization is informational - the MCP server handles the actual work
      // Future: Could dispatch an event to update UI with token savings info
    },
    [],
  );

  // Subscribe to MCP bridge events
  useEffect(() => {
    mcpBridgeEventEmitter.on("plan-approval", handlePlanApproval);
    mcpBridgeEventEmitter.on("summarize-context", handleSummarizeContext);

    return () => {
      mcpBridgeEventEmitter.off("plan-approval", handlePlanApproval);
      mcpBridgeEventEmitter.off("summarize-context", handleSummarizeContext);
    };
  }, [handlePlanApproval, handleSummarizeContext]);

  // Subscribe to planTests
  const planTestsSubscription = rpc.agents.planTests.useSubscription({
    enabled: false, // Manual subscription
    onData: (data: unknown) => {
      const event = data as {
        type?: string;
        content?: string;
        toolCallId?: string;
        toolName?: string;
        args?: unknown;
        output?: unknown;
        errorText?: string;
        state?: ToolEvent["state"];
        usage?: LanguageModelUsage;
        command?: string;
        filePath?: string;
        isComplete?: boolean;
        suites?: TestSuiteQueueItem[];
        subscriptionId?: string;
      };

      // Log all events received in webview for debugging
      console.log("[useChangesetChat] Received event:", event.type, event);

      // Capture subscriptionId when received
      if (event.subscriptionId && !state.context.subscriptionId) {
        send({
          type: "SET_SUBSCRIPTION_ID",
          subscriptionId: event.subscriptionId,
        });
      }

      Match.value(event).pipe(
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
              toolCallId: p.toolCallId || `tool-${Date.now()}`,
              toolName: p.toolName || "",
              args: p.args,
              state: p.state || "input-streaming",
              timestamp: new Date(),
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
                errorText: p.errorText,
                state: p.errorText
                  ? "output-error"
                  : p.state || "output-available",
              },
            },
          });
        }),
        Match.when({ type: "tool-approval-requested" }, (p) => {
          // Update tool state to approval-requested so UI shows approve/reject buttons
          send({
            type: "RESPONSE_CHUNK",
            chunkType: "tool-result",
            toolResult: {
              toolCallId: p.toolCallId || "",
              updates: {
                state: "approval-requested",
              },
            },
          });
        }),
        Match.when({ type: "tool-output-streaming" }, (p) => {
          send({
            type: "RESPONSE_CHUNK",
            chunkType: "tool-output-streaming",
            streamingOutput: {
              toolCallId: p.toolCallId || "",
              command: p.command || "",
              output: typeof p.output === "string" ? p.output : "",
            },
          });
        }),
        Match.when({ type: "file-created" }, (p) => {
          send({
            type: "RESPONSE_CHUNK",
            chunkType: "file-output-streaming",
            streamingFileOutput: {
              toolCallId: p.toolCallId || "",
              filePath: p.filePath || "",
              content: "",
              isComplete: false,
            },
          });
        }),
        Match.when({ type: "file-output-streaming" }, (p) => {
          send({
            type: "RESPONSE_CHUNK",
            chunkType: "file-output-streaming",
            streamingFileOutput: {
              toolCallId: p.toolCallId || "",
              filePath: p.filePath || "",
              content: typeof p.content === "string" ? p.content : "",
              isComplete: p.isComplete === true,
            },
          });
        }),
        Match.when({ type: "plan-content-streaming" }, (p) => {
          send({
            type: "RESPONSE_CHUNK",
            chunkType: "plan-content-streaming",
            streamingPlanContent: {
              toolCallId: p.toolCallId || "",
              content: typeof p.content === "string" ? p.content : "",
              isComplete: p.isComplete === true,
              filePath: typeof p.filePath === "string" ? p.filePath : undefined,
            },
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
        Match.when({ type: "usage" }, (p) => {
          if (p.usage) {
            send({
              type: "RESPONSE_CHUNK",
              chunkType: "usage",
              usage: p.usage,
            });
          }
        }),
        Match.when({ type: "plan-approved" }, (p) => {
          // Agent approved the plan - extract suites and dispatch APPROVE_PLAN
          const suites = (p.suites as TestSuiteQueueItem[]) || [];
          console.log(
            "[plan-approved] Agent approved plan with",
            suites.length,
            "suites",
          );
          send({ type: "APPROVE_PLAN", suites });
        }),
        Match.when({ type: "error" }, (p) => {
          const errorMessage =
            typeof p === "object" &&
            p !== null &&
            "message" in p &&
            typeof p.message === "string"
              ? p.message
              : "An error occurred";
          send({ type: "RESPONSE_ERROR", error: errorMessage });
        }),
        Match.orElse(() => {
          // No-op for unknown types
        }),
      );
    },
    onComplete: (data: unknown) => {
      console.log("[useChangesetChat] Subscription onComplete called");
      const completionData = data as { taskCompleted?: boolean } | undefined;
      send({
        type: "RESPONSE_COMPLETE",
        taskCompleted: completionData?.taskCompleted ?? false,
      });
    },
    onError: (err) => {
      send({ type: "RESPONSE_ERROR", error: err });
    },
  });

  // Build focused context for a specific suite
  const buildSuiteContext = useCallback(
    (
      suite: TestSuiteQueueItem,
    ): Array<{ role: "user" | "assistant" | "system"; content: string }> => {
      const planRef = state.context.planFilePath
        ? `Refer to the approved test plan at: ${state.context.planFilePath}`
        : "";

      return [
        {
          role: "user",
          content: `Execute the following test suite from the approved plan:

      Suite: ${suite.name}
      Target file: ${suite.targetFilePath}
      Test type: ${suite.testType}
      Source files: ${suite.sourceFiles.join(", ")}

      ${suite.description || ""}

      ${planRef}

      IMPORTANT: Focus ONLY on this suite. Write the test file and run it. Do not work on other suites.`,
        },
      ];
    },
    [state.context.planFilePath],
  );

  // Start analysis subscription when START_ANALYSIS is triggered or when user sends message
  // In act mode with queue processing, create isolated subscription per suite
  useEffect(() => {
    // Handle act mode queue processing - create isolated subscription per suite
    if (
      state.context.agentMode === "act" &&
      state.context.isProcessingQueue &&
      state.context.currentSuiteId &&
      (state.matches("analyzing") || state.matches("idle")) &&
      (planTestsSubscription.status === "idle" ||
        planTestsSubscription.status === "complete")
    ) {
      const currentSuite = state.context.testSuiteQueue.find(
        (s) => s.id === state.context.currentSuiteId,
      );

      if (currentSuite?.status === "in_progress") {
        // If subscription is complete, unsubscribe first to reset it
        if (planTestsSubscription.status === "complete") {
          planTestsSubscription.unsubscribe();
        }

        // Create focused subscription for THIS suite only
        planTestsSubscription.subscribe({
          files: currentSuite.sourceFiles, // Only source files for this suite
          branchName: state.context.branchName,
          baseBranch,
          conversationType: mode,
          commitHash,
          mode: "act",
          planFilePath: state.context.planFilePath || undefined,
          conversationHistory: buildSuiteContext(currentSuite), // Focused context
        });
      }
    }
    // Handle plan mode or regular analysis - use all files and full conversation history
    else if (
      files.length > 0 &&
      state.matches("analyzing") &&
      !state.context.isProcessingQueue &&
      (planTestsSubscription.status === "idle" ||
        planTestsSubscription.status === "complete")
    ) {
      // If subscription is complete, unsubscribe first to reset it
      if (planTestsSubscription.status === "complete") {
        planTestsSubscription.unsubscribe();
      }

      // Convert messages to conversation history format
      const conversationHistory = state.context.messages
        .filter((msg) => msg.role !== "system")
        .map((msg) => ({
          role: msg.role,
          content: msg.parts
            .filter((p) => p.type === "text")
            .map((p) => (p.type === "text" ? p.text : ""))
            .join(""),
        }));

      planTestsSubscription.subscribe({
        files,
        branchName: state.context.branchName,
        baseBranch,
        conversationType: mode,
        commitHash,
        mode: state.context.agentMode, // Pass agent mode (plan or act)
        planFilePath: state.context.planFilePath || undefined, // Pass plan file path for act mode context
        conversationHistory:
          conversationHistory.length > 0 ? conversationHistory : undefined,
      });
    }
  }, [
    files,
    state,
    planTestsSubscription,
    mode,
    commitHash,
    baseBranch,
    buildSuiteContext,
  ]);

  // Abort all running tool calls mutation
  const abortAllToolCalls = rpc.agents.abortAllToolCalls.useMutation();

  return {
    state,
    send,
    messages: state.context.messages,
    reasoningContent: state.context.reasoningContent,
    isReasoningStreaming: state.context.isReasoningStreaming,
    isTextStreaming: state.context.isTextStreaming,
    isAnalyzing: state.matches("analyzing"),
    error: state.context.error,
    isLoading: state.matches("analyzing") || state.matches("streaming"),
    isLoadingHistory: !state.context.historyLoaded,
    hasCompletedAnalysis: state.context.hasCompletedAnalysis,
    scratchpadTodos: state.context.scratchpadTodos,
    usage: state.context.usage,
    planContent: state.context.planContent,
    planFilePath: state.context.planFilePath,
    testExecutions: state.context.testExecutions,
    testSuiteQueue: state.context.testSuiteQueue,
    currentSuiteId: state.context.currentSuiteId,
    agentMode: state.context.agentMode,
    subscriptionId: state.context.subscriptionId,
    hasPendingPlanApproval: state.context.hasPendingPlanApproval,
    isProcessingQueue: state.context.isProcessingQueue,
    cancelStream: async () => {
      // First abort all running tool calls and WAIT for completion
      // This ensures tools are properly terminated before we unsubscribe
      try {
        const result = await abortAllToolCalls.mutateAsync();
        console.log(
          "[useChangesetChat] Aborted all tool calls:",
          result.abortedCount,
        );
      } catch (error: unknown) {
        console.error("[useChangesetChat] Failed to abort tool calls:", error);
      }

      // Then unsubscribe from the stream and update state
      // This must happen AFTER abort completes to prevent race conditions
      planTestsSubscription.unsubscribe();
      send({ type: "CANCEL_STREAM" });
    },
  };
}
