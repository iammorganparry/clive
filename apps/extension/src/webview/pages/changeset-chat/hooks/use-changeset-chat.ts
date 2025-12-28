import { useMachine } from "@xstate/react";
import type { LanguageModelUsage } from "ai";
import { Match } from "effect";
import { useEffect, useRef } from "react";
import { useRpc } from "../../../rpc/provider.js";
import type { ToolEvent } from "../../../types/chat.js";
import { changesetChatMachine } from "../machines/changeset-chat-machine.js";

interface UseChangesetChatOptions {
  files: string[];
  branchName: string;
  mode?: "branch" | "uncommitted";
  commitHash?: string;
}

export function useChangesetChat({
  files,
  branchName,
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
  const { data: historyData } = rpc.conversations.getBranchHistory.useQuery({
    input: {
      branchName,
      baseBranch: "main",
      conversationType: mode,
      commitHash,
    },
    enabled: branchName.length > 0,
  });

  // Send backend history when query completes
  useEffect(() => {
    if (state.value === "idle" && !state.context.historyLoaded) {
      send({
        type: "RECEIVE_BACKEND_HISTORY",
        historyData: historyData ?? null,
      });
    }
  }, [historyData, state.value, state.context.historyLoaded, send]);

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
      };

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
    onComplete: () => {
      console.log("[useChangesetChat] Subscription onComplete called");
      send({ type: "RESPONSE_COMPLETE" });
    },
    onError: (err) => {
      send({ type: "RESPONSE_ERROR", error: err });
    },
  });

  // Start analysis subscription when START_ANALYSIS is triggered or when user sends message
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

      planTestsSubscription.subscribe({
        files,
        branchName: state.context.branchName,
        baseBranch: "main",
        conversationType: mode,
        commitHash,
        mode: state.context.agentMode, // Pass agent mode (plan or act)
        conversationHistory:
          conversationHistory.length > 0 ? conversationHistory : undefined,
      });
    }
  }, [files, state, planTestsSubscription, mode, commitHash]);

  // Auto-send focused message when starting next suite in act mode
  const previousSuiteId = useRef<string | null>(null);
  useEffect(() => {
    if (
      state.context.agentMode === "act" &&
      state.context.currentSuiteId &&
      state.context.currentSuiteId !== previousSuiteId.current &&
      previousSuiteId.current !== null // Only auto-send if we had a previous suite (not initial)
    ) {
      const currentSuite = state.context.testSuiteQueue.find(
        (s) => s.id === state.context.currentSuiteId,
      );
      if (currentSuite && currentSuite.status === "in_progress") {
        // Send focused message for next suite
        send({
          type: "SEND_MESSAGE",
          content: `Write tests for: ${currentSuite.name}\nTarget file: ${currentSuite.targetFilePath}\nTest type: ${currentSuite.testType}\n\nFocus only on this suite. Other suites will be handled separately.`,
        });
      }
    }
    previousSuiteId.current = state.context.currentSuiteId;
  }, [state.context.currentSuiteId, state.context.agentMode, state.context.testSuiteQueue, send]);

  return {
    state,
    send,
    messages: state.context.messages,
    reasoningContent: state.context.reasoningContent,
    isReasoningStreaming: state.context.isReasoningStreaming,
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
    cancelStream: () => {
      planTestsSubscription.unsubscribe();
      send({ type: "CANCEL_STREAM" });
    },
  };
}
