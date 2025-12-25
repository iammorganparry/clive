import { useEffect, useRef } from "react";
import { useMachine } from "@xstate/react";
import { Match } from "effect";
import { useRpc } from "../../../rpc/provider.js";
import { changesetChatMachine } from "../machines/changeset-chat-machine.js";
import type { ChatMessage, ToolEvent } from "../../../types/chat.js";

interface UseChangesetChatOptions {
  files: string[];
  branchName: string;
}

export function useChangesetChat({
  files,
  branchName,
}: UseChangesetChatOptions) {
  const rpc = useRpc();
  const historyLoadedRef = useRef(false);

  const [state, send] = useMachine(changesetChatMachine, {
    input: {
      files,
      branchName,
    },
  });

  // Load conversation history
  const { data: historyData } = rpc.conversations.getBranchHistory.useQuery({
    input: { branchName, baseBranch: "main" },
    enabled: branchName.length > 0 && !historyLoadedRef.current,
  });

  // Load history into machine when available
  useEffect(() => {
    if (historyData && !historyLoadedRef.current && state.matches("idle")) {
      historyLoadedRef.current = true;
      if (historyData.conversationId && historyData.messages.length > 0) {
        // Convert old format to new parts-based format
        const messages: ChatMessage[] = historyData.messages.map((msg) => ({
          id: msg.id,
          role: msg.role as "user" | "assistant" | "system",
          parts: [{ type: "text", text: msg.content }],
          timestamp: new Date(msg.createdAt),
        }));
        send({
          type: "LOAD_HISTORY",
          messages,
        });
      } else {
        // No history, add initial message
        send({ type: "START_ANALYSIS" });
      }
    } else if (
      !historyData &&
      !historyLoadedRef.current &&
      state.matches("idle")
    ) {
      // Query completed but no history found, add initial message
      historyLoadedRef.current = true;
      send({ type: "START_ANALYSIS" });
    }
  }, [historyData, state, send]);

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
        Match.when({ type: "reasoning" }, (p) => {
          if (p.content) {
            send({
              type: "RESPONSE_CHUNK",
              chunkType: "reasoning",
              content: p.content,
            });
          }
        }),
        Match.orElse(() => {
          // No-op for unknown types
        }),
      );
    },
    onComplete: () => {
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
        conversationHistory:
          conversationHistory.length > 0 ? conversationHistory : undefined,
      });
    }
  }, [files, state, planTestsSubscription]);

  return {
    state,
    send,
    messages: state.context.messages,
    reasoningContent: state.context.reasoningContent,
    isReasoningStreaming: state.context.isReasoningStreaming,
    error: state.context.error,
    isLoading: state.matches("analyzing") || state.matches("streaming"),
    hasCompletedAnalysis: state.context.hasCompletedAnalysis,
  };
}
