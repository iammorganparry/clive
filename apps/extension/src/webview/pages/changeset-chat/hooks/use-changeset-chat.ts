import { useEffect } from "react";
import { useMachine } from "@xstate/react";
import { Match } from "effect";
import { useRpc } from "../../../rpc/provider.js";
import { changesetChatMachine } from "../machines/changeset-chat-machine.js";
import type { ToolEvent } from "../../../types/chat.js";
import { useConversationCache } from "./use-conversation-cache.js";
import type { LanguageModelUsage } from "ai";

interface UseChangesetChatOptions {
  files: string[];
  branchName: string;
}

export function useChangesetChat({
  files,
  branchName,
}: UseChangesetChatOptions) {
  const rpc = useRpc();
  const cache = useConversationCache(branchName);

  const [state, send] = useMachine(changesetChatMachine, {
    input: {
      files,
      branchName,
    },
  });

  // Load conversation history from backend
  const { data: historyData } = rpc.conversations.getBranchHistory.useQuery({
    input: { branchName, baseBranch: "main" },
    enabled: branchName.length > 0,
  });

  // Send cache data when loaded
  useEffect(() => {
    if (branchName && state.value === "idle" && !state.context.cacheLoaded) {
      send({ type: "RECEIVE_CACHE", cache: cache.load() });
    }
  }, [branchName, state.value, state.context.cacheLoaded, cache, send]);

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
        conversationHistory:
          conversationHistory.length > 0 ? conversationHistory : undefined,
      });
    }
  }, [files, state, planTestsSubscription]);

  // Save to cache when conversation state changes
  useEffect(() => {
    if (
      state.context.messages.length > 0 &&
      (state.matches("idle") || state.matches("streaming"))
    ) {
      cache.save({
        messages: state.context.messages,
        hasCompletedAnalysis: state.context.hasCompletedAnalysis,
        scratchpadTodos: state.context.scratchpadTodos,
        cachedAt: Date.now(),
      });
    }
  }, [
    state.context.messages,
    state.context.hasCompletedAnalysis,
    state.context.scratchpadTodos,
    state.matches,
    cache,
  ]);

  return {
    state,
    send,
    messages: state.context.messages,
    reasoningContent: state.context.reasoningContent,
    isReasoningStreaming: state.context.isReasoningStreaming,
    error: state.context.error,
    isLoading: state.matches("analyzing") || state.matches("streaming"),
    isLoadingHistory:
      !state.context.cacheLoaded || !state.context.historyLoaded,
    hasCompletedAnalysis: state.context.hasCompletedAnalysis,
    scratchpadTodos: state.context.scratchpadTodos,
    usage: state.context.usage,
    planContent: state.context.planContent,
    testExecutions: state.context.testExecutions,
    cancelStream: () => {
      planTestsSubscription.unsubscribe();
      send({ type: "CANCEL_STREAM" });
    },
  };
}
