import { useMachine } from "@xstate/react";
import type { LanguageModelUsage } from "ai";
import { Match } from "effect";
import { useCallback, useEffect } from "react";
import { useRpc } from "../../../rpc/provider.js";
import { mcpBridgeEventEmitter } from "../../../services/mcp-bridge-events.js";
import type { ToolEvent } from "../../../types/chat.js";
import {
  changesetChatMachine,
  type TestSuiteQueueItem,
} from "../machines/changeset-chat-machine.js";

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
    (data: {
      approved: boolean;
      planId?: string;
      feedback?: string;
      approvalMode?: "auto" | "manual";
    }) => {
      console.log("[MCP Bridge] Plan approval event received:", data);
      if (data.approved) {
        // When approved via MCP bridge, dispatch APPROVE_PLAN with current queue
        const suites = state.context.testSuiteQueue;
        send({
          type: "APPROVE_PLAN",
          suites,
          approvalMode: data.approvalMode || "auto",
        });
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

  // Handle plan content streaming from MCP bridge
  const handlePlanContentStreaming = useCallback(
    (data: {
      toolCallId: string;
      content: string;
      isComplete: boolean;
      filePath?: string;
    }) => {
      console.log("[MCP Bridge] Plan content streaming event received:", data);
      send({
        type: "RESPONSE_CHUNK",
        chunkType: "plan-content",
        planContent: data.content,
        planFilePath: data.filePath,
      });
    },
    [send],
  );

  // Subscribe to MCP bridge events
  useEffect(() => {
    mcpBridgeEventEmitter.on("plan-approval", handlePlanApproval);
    mcpBridgeEventEmitter.on("summarize-context", handleSummarizeContext);
    mcpBridgeEventEmitter.on(
      "plan-content-streaming",
      handlePlanContentStreaming,
    );

    return () => {
      mcpBridgeEventEmitter.off("plan-approval", handlePlanApproval);
      mcpBridgeEventEmitter.off("summarize-context", handleSummarizeContext);
      mcpBridgeEventEmitter.off(
        "plan-content-streaming",
        handlePlanContentStreaming,
      );
    };
  }, [handlePlanApproval, handleSummarizeContext, handlePlanContentStreaming]);

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
        // Ralph Wiggum loop events
        Match.when({ type: "loop-iteration-start" }, (p) => {
          const loopEvent = p as unknown as {
            iteration: number;
            maxIterations: number;
          };
          send({
            type: "LOOP_ITERATION_START",
            iteration: loopEvent.iteration,
            maxIterations: loopEvent.maxIterations,
          });
        }),
        Match.when({ type: "loop-iteration-complete" }, (p) => {
          const loopEvent = p as unknown as {
            iteration: number;
            todos: Array<{
              content: string;
              status: string;
              activeForm: string;
            }>;
            progress: {
              completed: number;
              pending: number;
              total: number;
              percentComplete: number;
            };
          };
          send({
            type: "LOOP_ITERATION_COMPLETE",
            iteration: loopEvent.iteration,
            todos: loopEvent.todos,
            progress: loopEvent.progress,
          });
        }),
        Match.when({ type: "loop-complete" }, (p) => {
          const loopEvent = p as unknown as {
            reason:
              | "complete"
              | "max_iterations"
              | "max_time"
              | "error"
              | "cancelled";
            iteration: number;
            todos: Array<{
              content: string;
              status: string;
              activeForm: string;
            }>;
            progress: {
              completed: number;
              pending: number;
              total: number;
              percentComplete: number;
            };
          };
          send({
            type: "LOOP_COMPLETE",
            reason: loopEvent.reason,
            iteration: loopEvent.iteration,
            todos: loopEvent.todos,
            progress: loopEvent.progress,
          });
        }),
        Match.when({ type: "todos-updated" }, (p) => {
          const loopEvent = p as unknown as {
            todos: Array<{
              content: string;
              status: string;
              activeForm: string;
            }>;
            progress: {
              completed: number;
              pending: number;
              total: number;
              percentComplete: number;
            };
          };
          send({
            type: "TODOS_UPDATED",
            todos: loopEvent.todos,
            progress: loopEvent.progress,
          });
        }),
        // Native plan mode events (Claude Code's EnterPlanMode/ExitPlanMode)
        Match.when({ type: "native-plan-mode-entered" }, (p) => {
          console.log(
            "[useChangesetChat] Native plan mode entered:",
            p.toolCallId,
          );
          // Optional: Could dispatch event to show "Planning in progress..." indicator
        }),
        Match.when({ type: "native-plan-mode-exiting" }, (p) => {
          console.log(
            "[useChangesetChat] Native plan mode exiting:",
            p.toolCallId,
          );
          // Plan content is emitted separately via plan-content-streaming
        }),
        // Plan content streaming (from both MCP proposeTestPlan and native plan mode)
        Match.when({ type: "plan-content-streaming" }, (p) => {
          const planEvent = p as unknown as {
            toolCallId: string;
            content: string;
            isComplete: boolean;
            filePath?: string;
          };
          send({
            type: "RESPONSE_CHUNK",
            chunkType: "plan-content",
            planContent: planEvent.content,
            planFilePath: planEvent.filePath,
          });
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

  // Start analysis subscription when START_ANALYSIS is triggered or when user sends message
  // The agent handles all iteration internally via Ralph Wiggum loop
  useEffect(() => {
    if (
      files.length > 0 &&
      state.matches("analyzing") &&
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

      // Agent gets test suites from the plan file path in act mode
      planTestsSubscription.subscribe({
        files,
        branchName: state.context.branchName,
        baseBranch,
        conversationType: mode,
        commitHash,
        mode: state.context.agentMode,
        planFilePath: state.context.planFilePath || undefined,
        conversationHistory:
          conversationHistory.length > 0 ? conversationHistory : undefined,
      });
    }
  }, [files, state, planTestsSubscription, mode, commitHash, baseBranch]);

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
    agentMode: state.context.agentMode,
    subscriptionId: state.context.subscriptionId,
    approvalMode: state.context.approvalMode,
    // Ralph Wiggum loop state
    loopIteration: state.context.loopIteration,
    loopMaxIterations: state.context.loopMaxIterations,
    loopTodos: state.context.loopTodos,
    loopProgress: state.context.loopProgress,
    loopExitReason: state.context.loopExitReason,
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
