import { setup, assign } from "xstate";
import type {
  ToolEvent,
  ChatMessage,
  MessagePart,
  ToolState,
} from "../../../types/chat.js";
import {
  parseScratchpad,
  type ScratchpadTodo,
} from "../utils/parse-scratchpad.js";
import { parsePlan } from "../utils/parse-plan.js";
import {
  isTestCommand,
  updateTestExecution,
  updateTestExecutionFromStream,
  extractTestFilePath,
  type TestFileExecution,
} from "../utils/parse-test-output.js";
import type { LanguageModelUsage } from "ai";

// Type guards for bash execute operations
interface BashExecuteArgs {
  command: string;
}

const isBashExecuteArgs = (args: unknown): args is BashExecuteArgs =>
  typeof args === "object" &&
  args !== null &&
  "command" in args &&
  typeof (args as BashExecuteArgs).command === "string";

interface BashExecuteOutput {
  stdout: string;
  stderr?: string;
  exitCode: number;
  wasTruncated: boolean;
  command: string;
}

const isBashExecuteOutput = (output: unknown): output is BashExecuteOutput =>
  typeof output === "object" &&
  output !== null &&
  "stdout" in output &&
  typeof (output as BashExecuteOutput).stdout === "string";

/**
 * Parse toolCalls field from backend message to reconstruct parts
 */
function parseMessageParts(
  content: string,
  toolCalls: string | null | undefined,
): MessagePart[] {
  const parts: MessagePart[] = [];

  // Always add text part
  if (content.trim()) {
    parts.push({ type: "text", text: content });
  }

  // Parse toolCalls if present
  if (toolCalls) {
    try {
      const parsed = JSON.parse(toolCalls);
      // Handle different toolCalls formats
      if (Array.isArray(parsed)) {
        // Array of tool calls
        for (const toolCall of parsed) {
          if (toolCall && typeof toolCall === "object") {
            parts.push({
              type: `tool-${toolCall.toolName || "unknown"}`,
              toolName: toolCall.toolName || "unknown",
              toolCallId: toolCall.toolCallId || `tool-${Date.now()}`,
              state: "output-available",
              input: toolCall.args,
              output: toolCall.output,
              errorText: toolCall.errorText,
            });
          }
        }
      } else if (parsed && typeof parsed === "object") {
        // Single tool call or object with tool calls
        if (parsed.toolName) {
          parts.push({
            type: `tool-${parsed.toolName}`,
            toolName: parsed.toolName,
            toolCallId: parsed.toolCallId || `tool-${Date.now()}`,
            state: "output-available",
            input: parsed.args,
            output: parsed.output,
            errorText: parsed.errorText,
          });
        }
      }
    } catch (error) {
      console.warn("Failed to parse toolCalls:", error);
    }
  }

  return parts.length > 0 ? parts : [{ type: "text", text: content || "" }];
}

export interface ChangesetChatError {
  type: "SUBSCRIPTION_FAILED" | "ANALYSIS_FAILED";
  message: string;
  retryable: boolean;
  originalError?: unknown;
}

export interface TestSuiteQueueItem {
  id: string;
  name: string; // "Unit Tests for Authentication Logic"
  testType: "unit" | "integration" | "e2e";
  targetFilePath: string; // "src/auth/__tests__/auth.test.ts"
  sourceFiles: string[]; // Files being tested
  status: "pending" | "in_progress" | "completed" | "failed";
  testResults?: TestFileExecution;
  description?: string; // From plan section
}

export interface ChangesetChatContext {
  files: string[];
  branchName: string;
  messages: ChatMessage[];
  streamingContent: string;
  toolEvents: ToolEvent[];
  error: ChangesetChatError | null;
  reasoningContent: string;
  isReasoningStreaming: boolean;
  hasCompletedAnalysis: boolean;
  scratchpadTodos: ScratchpadTodo[];
  cacheLoaded: boolean;
  historyLoaded: boolean;
  cachedAt?: number; // Timestamp of when cache was loaded
  usage: LanguageModelUsage | null;
  planContent: string | null; // Plan content extracted from scratchpad file
  testExecutions: TestFileExecution[]; // Accumulated test execution results
  accumulatedTestOutput: Map<string, string>; // Map of toolCallId -> accumulated output for streaming
  accumulatedFileContent: Map<string, string>; // Map of toolCallId -> accumulated file content for streaming
  testSuiteQueue: TestSuiteQueueItem[]; // Queue of test suites to process
  currentSuiteId: string | null; // ID of currently processing suite
  agentMode: "plan" | "act"; // Current agent mode
}

interface CachedConversation {
  messages: ChatMessage[];
  hasCompletedAnalysis: boolean;
  scratchpadTodos: ScratchpadTodo[];
  cachedAt: number;
}

interface BackendHistoryMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls: string | null | undefined;
  createdAt: string;
}

interface BackendHistoryData {
  conversationId: string | null;
  messages: BackendHistoryMessage[];
}

export type ChangesetChatEvent =
  | { type: "START_ANALYSIS" }
  | { type: "LOAD_HISTORY"; messages: ChatMessage[] }
  | { type: "RECEIVE_CACHE"; cache: CachedConversation | null }
  | { type: "RECEIVE_BACKEND_HISTORY"; historyData: BackendHistoryData | null }
  | {
      type: "RESPONSE_CHUNK";
      chunkType:
        | "message"
        | "tool-call"
        | "tool-result"
        | "tool-output-streaming"
        | "file-output-streaming"
        | "reasoning"
        | "usage"
        | "plan-content-streaming";
      content?: string;
      toolEvent?: ToolEvent;
      toolResult?: { toolCallId: string; updates: Partial<ToolEvent> };
      streamingOutput?: {
        toolCallId: string;
        command: string;
        output: string;
      };
      streamingFileOutput?: {
        toolCallId: string;
        filePath: string;
        content: string;
        isComplete: boolean;
      };
      streamingPlanContent?: {
        toolCallId: string;
        content: string;
        isComplete: boolean;
      };
      usage?: LanguageModelUsage;
    }
  | { type: "RESPONSE_COMPLETE" }
  | { type: "RESPONSE_ERROR"; error: unknown }
  | { type: "CLEAR_ERROR" }
  | { type: "RESET" }
  | { type: "SEND_MESSAGE"; content: string }
  | { type: "CANCEL_STREAM" }
  | { type: "CLOSE_TEST_DRAWER" }
  | { type: "APPROVE_PLAN"; suites: TestSuiteQueueItem[] }
  | { type: "START_NEXT_SUITE" }
  | { type: "MARK_SUITE_COMPLETED"; suiteId: string; results: TestFileExecution }
  | {
      type: "MARK_SUITE_FAILED";
      suiteId: string;
      error: string;
      results?: TestFileExecution;
    }
  | {
      type: "DEV_INJECT_STATE";
      updates: Partial<ChangesetChatContext>;
    };

export interface ChangesetChatInput {
  files: string[];
  branchName: string;
}

const createChatError = (
  type: ChangesetChatError["type"],
  error: unknown,
  retryable: boolean = true,
): ChangesetChatError => {
  return {
    type,
    message:
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "An error occurred",
    retryable,
    originalError: error,
  };
};

export const changesetChatMachine = setup({
  types: {
    context: {} as ChangesetChatContext,
    events: {} as ChangesetChatEvent,
    input: {} as ChangesetChatInput,
  },
  guards: {
    shouldLoadBackendHistory: ({ context, event }): boolean => {
      if (event.type !== "RECEIVE_BACKEND_HISTORY") return false;
      if (
        !event.historyData ||
        !event.historyData.conversationId ||
        event.historyData.messages.length === 0
      ) {
        return false;
      }
      // If cache wasn't loaded, always use backend
      if (!context.cacheLoaded) return true;
      // If cache was loaded, compare message counts and timestamps
      const backendMessages = event.historyData.messages;
      const backendNewer =
        backendMessages.length > context.messages.length ||
        (backendMessages.length > 0 &&
          context.messages.length > 0 &&
          context.cachedAt !== undefined &&
          new Date(
            backendMessages[backendMessages.length - 1].createdAt,
          ).getTime() > context.cachedAt);
      return backendNewer;
    },
    shouldStartFreshAnalysis: ({ context, event }): boolean => {
      if (event.type !== "RECEIVE_BACKEND_HISTORY") return false;
      // Start fresh if no backend history and no messages were loaded from cache
      return (
        (!event.historyData ||
          !event.historyData.conversationId ||
          event.historyData.messages.length === 0) &&
        context.messages.length === 0
      );
    },
  },
  actions: {
    appendStreamingContent: assign(({ context, event }) => {
      if (event.type !== "RESPONSE_CHUNK" || event.chunkType !== "message")
        return {};
      return {
        streamingContent: context.streamingContent + (event.content || ""),
      };
    }),
    clearStreamingContent: assign({ streamingContent: () => "" }),
    appendReasoningContent: assign(({ context, event }) => {
      if (event.type !== "RESPONSE_CHUNK" || event.chunkType !== "reasoning")
        return {};
      return {
        reasoningContent: context.reasoningContent + (event.content || ""),
        isReasoningStreaming: true,
      };
    }),
    clearReasoningContent: assign({
      reasoningContent: () => "",
      isReasoningStreaming: () => false,
    }),
    stopReasoningStreaming: assign({ isReasoningStreaming: () => false }),
    addToolEvent: assign(({ context, event }) => {
      if (event.type !== "RESPONSE_CHUNK" || event.chunkType !== "tool-call")
        return {};
      if (!event.toolEvent) return {};
      const toolEvent = {
        ...event.toolEvent,
        timestamp: event.toolEvent.timestamp || new Date(),
      };
      const existing = context.toolEvents.find(
        (t) => t.toolCallId === toolEvent.toolCallId,
      );
      if (existing) {
        return {
          toolEvents: context.toolEvents.map((t) =>
            t.toolCallId === toolEvent.toolCallId ? { ...t, ...toolEvent } : t,
          ),
        };
      }
      return { toolEvents: [...context.toolEvents, toolEvent] };
    }),
    updateToolEvent: assign(({ context, event }) => {
      if (event.type !== "RESPONSE_CHUNK" || event.chunkType !== "tool-result")
        return {};
      if (!event.toolResult) return {};
      const toolResult = event.toolResult;
      const toolCallId = toolResult.toolCallId;
      return {
        toolEvents: context.toolEvents.map((t) =>
          t.toolCallId === toolCallId
            ? {
                ...t,
                ...toolResult.updates,
                timestamp: t.timestamp, // Preserve existing timestamp
              }
            : t,
        ),
      };
    }),
    updateScratchpadTodos: assign(({ context, event }) => {
      // Check for scratchpad content from bashExecute tool results
      if (
        event.type === "RESPONSE_CHUNK" &&
        event.chunkType === "tool-result" &&
        event.toolResult
      ) {
        const toolCallId = event.toolResult.toolCallId;
        const toolEvent = context.toolEvents.find(
          (t) => t.toolCallId === toolCallId,
        );

        if (
          toolEvent &&
          toolEvent.toolName === "bashExecute" &&
          isBashExecuteArgs(toolEvent.args)
        ) {
          const command = toolEvent.args.command;
          // Check if command interacts with scratchpad files (.clive/plans/)
          const isScratchpadOperation =
            command.includes(".clive/plans/") &&
            (command.includes("test-plan-") || command.includes("plans/"));

          if (isScratchpadOperation && event.toolResult.updates.output) {
            // Extract scratchpad content from output
            // For read operations (cat .clive/plans/...), content is in stdout
            // For write operations, we might need to read it back, but let's try output first
            const output = event.toolResult.updates.output;
            let content = "";

            if (typeof output === "string") {
              content = output;
            } else if (isBashExecuteOutput(output)) {
              content = output.stdout;
            }

            // Only parse if we have meaningful content (not just empty string or whitespace)
            if (content.trim().length > 0) {
              const updates: Partial<ChangesetChatContext> = {};

              // Parse for scratchpad TODOs
              try {
                const todos = parseScratchpad(content);
                // Only update if we found actual TODOs
                if (todos.length > 0) {
                  updates.scratchpadTodos = todos;
                }
              } catch (error) {
                // Log parsing errors for debugging but don't crash
                console.warn("Failed to parse scratchpad content:", error);
              }

              // Parse for plan content (test proposal)
              try {
                const plan = parsePlan(content);
                if (plan) {
                  updates.planContent = plan.fullContent;
                }
              } catch (error) {
                // Log parsing errors for debugging but don't crash
                console.warn("Failed to parse plan content:", error);
              }

              // Return updates if we found anything
              if (Object.keys(updates).length > 0) {
                return updates;
              }
            }
          }
        }
      }

      // Also check assistant message text content and streaming content for checkboxes and plans
      // This handles cases where the agent includes TODOs or plans in markdown responses
      const lastMessage = context.messages[context.messages.length - 1];
      let textToCheck = "";

      // Collect text from last assistant message
      if (lastMessage && lastMessage.role === "assistant") {
        const textParts = lastMessage.parts
          .filter(
            (part): part is { type: "text"; text: string } =>
              part.type === "text",
          )
          .map((part) => part.text)
          .join("\n");
        textToCheck = textParts;
      }

      // Also check streaming content if we're currently streaming
      // This catches plans that are being streamed but not yet in message parts
      if (context.streamingContent.trim().length > 0) {
        textToCheck = textToCheck
          ? `${textToCheck}\n${context.streamingContent}`
          : context.streamingContent;
      }

      if (textToCheck.trim().length > 0) {
        const updates: Partial<ChangesetChatContext> = {};

        // Parse for scratchpad TODOs only (checkboxes in markdown)
        // Plan content is now extracted exclusively from proposeTestPlan tool via updatePlanContent action
        try {
          const todos = parseScratchpad(textToCheck);
          // Only update if we found actual TODOs
          if (todos.length > 0) {
            updates.scratchpadTodos = todos;
          }
        } catch (_error) {
          // Silently ignore parsing errors for message content
        }

        // Return updates if we found anything
        if (Object.keys(updates).length > 0) {
          return updates;
        }
      }

      return {};
    }),
    updateTestExecutionFromStream: assign(({ context, event }) => {
      // Check for streaming output from bashExecute tool
      if (
        event.type === "RESPONSE_CHUNK" &&
        event.chunkType === "tool-output-streaming" &&
        event.streamingOutput
      ) {
        const { toolCallId, command, output } = event.streamingOutput;
        const toolEvent = context.toolEvents.find(
          (t) => t.toolCallId === toolCallId,
        );

        if (
          toolEvent &&
          toolEvent.toolName === "bashExecute" &&
          isBashExecuteArgs(toolEvent.args)
        ) {
          // Check if this is a test command
          if (isTestCommand(command)) {
            // Accumulate output
            const currentAccumulated =
              context.accumulatedTestOutput.get(toolCallId) || "";
            const newAccumulated = currentAccumulated + output;
            const updatedAccumulated = new Map(context.accumulatedTestOutput);
            updatedAccumulated.set(toolCallId, newAccumulated);

            // Update test execution with accumulated output
            const updated = updateTestExecutionFromStream(
              context.testExecutions.find((te) => {
                const filePath = extractTestFilePath(command) || "unknown";
                return te.filePath === filePath;
              }) || null,
              command,
              output,
              newAccumulated,
            );

            if (!updated) {
              return {
                accumulatedTestOutput: updatedAccumulated,
              };
            }

            // Find existing execution or add new one
            const filePath = updated.filePath;
            const existingIndex = context.testExecutions.findIndex(
              (te) => te.filePath === filePath,
            );

            const updatedExecutions = [...context.testExecutions];
            if (existingIndex >= 0) {
              updatedExecutions[existingIndex] = updated;
            } else {
              updatedExecutions.push(updated);
            }

            // Link testExecutions to testSuiteQueue during streaming
            const updates: Partial<ChangesetChatContext> = {
              testExecutions: updatedExecutions,
              accumulatedTestOutput: updatedAccumulated,
            };

            // Update testSuiteQueue if current suite matches
            if (context.currentSuiteId) {
              const currentSuite = context.testSuiteQueue.find(
                (s) => s.id === context.currentSuiteId,
              );
              if (currentSuite && currentSuite.targetFilePath === filePath) {
                updates.testSuiteQueue = context.testSuiteQueue.map((suite) =>
                  suite.id === context.currentSuiteId
                    ? { ...suite, testResults: updated }
                    : suite,
                );
              }
            }

            return updates;
          }
        }
      }

      return {};
    }),
    updateTestExecution: assign(({ context, event }) => {
      // Check for test command execution from bashExecute tool results
      if (
        event.type === "RESPONSE_CHUNK" &&
        event.chunkType === "tool-result" &&
        event.toolResult
      ) {
        const toolCallId = event.toolResult.toolCallId;
        const toolEvent = context.toolEvents.find(
          (t) => t.toolCallId === toolCallId,
        );

        if (
          toolEvent &&
          toolEvent.toolName === "bashExecute" &&
          isBashExecuteArgs(toolEvent.args)
        ) {
          const command = toolEvent.args.command;

          // Check if this is a test command
          if (isTestCommand(command)) {
            const output = event.toolResult.updates.output;
            const filePath = extractTestFilePath(command) || "unknown";
            const existing = context.testExecutions.find(
              (te) => te.filePath === filePath,
            );
            const updated = updateTestExecution(existing || null, command, output);

            if (!updated) {
              // Clear accumulated output for this toolCallId
              const updatedAccumulated = new Map(context.accumulatedTestOutput);
              updatedAccumulated.delete(toolCallId);
              return {
                accumulatedTestOutput: updatedAccumulated,
              };
            }

            // Find existing execution or add new one
            const existingIndex = context.testExecutions.findIndex(
              (te) => te.filePath === filePath,
            );

            const updatedExecutions = [...context.testExecutions];
            if (existingIndex >= 0) {
              updatedExecutions[existingIndex] = updated;
            } else {
              updatedExecutions.push(updated);
            }

            // Clear accumulated output for this toolCallId
            const updatedAccumulated = new Map(context.accumulatedTestOutput);
            updatedAccumulated.delete(toolCallId);

            // Check if current suite's test file matches and tests passed
            const updates: Partial<ChangesetChatContext> = {
              testExecutions: updatedExecutions,
              accumulatedTestOutput: updatedAccumulated,
            };

            if (context.currentSuiteId && updated.status === "completed") {
              const currentSuite = context.testSuiteQueue.find(
                (s) => s.id === context.currentSuiteId,
              );
              if (
                currentSuite &&
                currentSuite.targetFilePath === filePath &&
                updated.summary
              ) {
                // Mark suite as completed and update with results (including failures)
                const suiteStatus: "completed" | "failed" =
                  updated.summary.failed === 0 ? "completed" : "failed";
                let updatedQueue = context.testSuiteQueue.map((suite) =>
                  suite.id === context.currentSuiteId
                    ? {
                        ...suite,
                        status: suiteStatus,
                        testResults: updated,
                      }
                    : suite,
                );

                // Check if there are more pending suites to process
                const hasPendingSuites = updatedQueue.some(
                  (s) => s.status === "pending",
                );
                let nextSuiteId: string | null = null;
                if (hasPendingSuites) {
                  // Find next pending suite and mark as in_progress
                  const nextSuite = updatedQueue.find(
                    (s) => s.status === "pending",
                  );
                  if (nextSuite) {
                    nextSuiteId = nextSuite.id;
                    updatedQueue = updatedQueue.map((suite) =>
                      suite.id === nextSuite.id
                        ? { ...suite, status: "in_progress" as const }
                        : suite,
                    );
                  }
                }

                updates.testSuiteQueue = updatedQueue;
                updates.currentSuiteId = nextSuiteId;
              }
            }

            return updates;
          }
        }
      }

      return {};
    }),
    clearTestExecutions: assign({ testExecutions: () => [] }),
    markAnalysisComplete: assign({ hasCompletedAnalysis: () => true }),
    addUserMessage: assign(({ context, event }) => {
      if (event.type !== "SEND_MESSAGE") return {};
      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        parts: [{ type: "text" as const, text: event.content }],
        timestamp: new Date(),
      };
      return {
        messages: [...context.messages, userMessage],
        hasCompletedAnalysis: false, // Reset when user sends new message
      };
    }),
    loadHistory: assign(({ event }) => {
      if (event.type !== "LOAD_HISTORY") return {};
      // Messages should already be in parts format from the hook
      // If we have messages, mark analysis as complete (conversation was already analyzed)
      const hasMessages = event.messages.length > 0;
      return {
        messages: event.messages,
        hasCompletedAnalysis: hasMessages,
      };
    }),
    addInitialMessage: assign(({ context }) => {
      const initialMessage: ChatMessage = {
        id: "initial",
        role: "user",
        parts: [
          {
            type: "text",
            text: `Analyze these ${context.files.length} changed file(s) and propose comprehensive tests:\n${context.files.map((f) => `- ${f}`).join("\n")}`,
          },
        ],
        timestamp: new Date(),
      };
      return {
        messages: [initialMessage],
      };
    }),
    addTextPart: assign(({ context, event }) => {
      if (event.type !== "RESPONSE_CHUNK" || event.chunkType !== "message")
        return {};
      if (!event.content) return {};

      const lastMessage = context.messages[context.messages.length - 1];
      if (lastMessage && lastMessage.role === "assistant") {
        // Append to last text part or create new text part
        const lastPart = lastMessage.parts[lastMessage.parts.length - 1];
        const updatedParts =
          lastPart && lastPart.type === "text"
            ? [
                ...lastMessage.parts.slice(0, -1),
                { ...lastPart, text: lastPart.text + event.content },
              ]
            : [
                ...lastMessage.parts,
                { type: "text" as const, text: event.content },
              ];

        return {
          messages: [
            ...context.messages.slice(0, -1),
            { ...lastMessage, parts: updatedParts },
          ],
        };
      }

      // Create new assistant message with text part
      const newMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        parts: [{ type: "text" as const, text: event.content }],
        timestamp: new Date(),
      };
      return {
        messages: [...context.messages, newMessage],
      };
    }),
    addToolPart: assign(({ context, event }) => {
      if (event.type !== "RESPONSE_CHUNK" || event.chunkType !== "tool-call")
        return {};
      if (!event.toolEvent) return {};

      const lastMessage = context.messages[context.messages.length - 1];
      if (!lastMessage || lastMessage.role !== "assistant") {
        // Create new assistant message with tool part
        const newMessage: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: "assistant",
          parts: [
            {
              type: `tool-${event.toolEvent.toolName}`,
              toolName: event.toolEvent.toolName,
              toolCallId: event.toolEvent.toolCallId,
              state: "input-available",
              input: event.toolEvent.args,
            },
          ],
          timestamp: new Date(),
        };
        return {
          messages: [...context.messages, newMessage],
        };
      }

      // Add tool part to existing assistant message
      const toolPart: MessagePart = {
        type: `tool-${event.toolEvent.toolName}`,
        toolName: event.toolEvent.toolName,
        toolCallId: event.toolEvent.toolCallId,
        state: "input-available",
        input: event.toolEvent.args,
      };

      return {
        messages: [
          ...context.messages.slice(0, -1),
          { ...lastMessage, parts: [...lastMessage.parts, toolPart] },
        ],
      };
    }),
    updateToolPart: assign(({ context, event }) => {
      if (event.type !== "RESPONSE_CHUNK" || event.chunkType !== "tool-result")
        return {};
      if (!event.toolResult) return {};

      const toolCallId = event.toolResult.toolCallId;
      const updates = event.toolResult.updates;

      return {
        messages: context.messages.map((msg) => {
          const updatedParts = msg.parts.map((part) => {
            if (
              part.type.startsWith("tool-") &&
              "toolCallId" in part &&
              part.toolCallId === toolCallId
            ) {
              return {
                ...part,
                state: (updates.state ||
                  (updates.errorText
                    ? "output-error"
                    : "output-available")) as ToolState,
                output: updates.output,
                errorText: updates.errorText,
              };
            }
            return part;
          });
          return { ...msg, parts: updatedParts };
        }),
      };
    }),
    setResponseError: assign(({ event }) => {
      if (event.type !== "RESPONSE_ERROR") return {};
      return {
        error: createChatError("ANALYSIS_FAILED", event.error),
        hasCompletedAnalysis: true, // Re-enable input even on error
      };
    }),
    clearError: assign({ error: () => null }),
    markHistoryLoaded: assign({ historyLoaded: () => true }),
    receiveCache: assign(({ event }) => {
      if (event.type !== "RECEIVE_CACHE") return {};
      if (!event.cache || event.cache.messages.length === 0) {
        return { cacheLoaded: true };
      }
      // Load cached messages immediately
      return {
        messages: event.cache.messages,
        hasCompletedAnalysis: event.cache.hasCompletedAnalysis,
        scratchpadTodos: event.cache.scratchpadTodos,
        cacheLoaded: true,
        cachedAt: event.cache.cachedAt,
      };
    }),
    receiveBackendHistory: assign(({ event }) => {
      if (event.type !== "RECEIVE_BACKEND_HISTORY") return {};
      if (
        !event.historyData ||
        !event.historyData.conversationId ||
        event.historyData.messages.length === 0
      ) {
        return { historyLoaded: true };
      }
      // Convert backend format to parts-based format, parsing toolCalls
      const messages: ChatMessage[] = event.historyData.messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        parts: parseMessageParts(msg.content, msg.toolCalls),
        timestamp: new Date(msg.createdAt),
      }));
      return {
        messages,
        hasCompletedAnalysis: messages.length > 0,
        historyLoaded: true,
      };
    }),
    updateUsage: assign(({ event }) => {
      if (event.type !== "RESPONSE_CHUNK" || event.chunkType !== "usage")
        return {};
      return {
        usage: event.usage ?? null,
      };
    }),
    updatePlanContent: assign(({ event }) => {
      if (
        event.type !== "RESPONSE_CHUNK" ||
        event.chunkType !== "plan-content-streaming"
      )
        return {};
      if (!event.streamingPlanContent) return {};
      const { content } = event.streamingPlanContent;
      // Update planContent with the streamed content
      // When isComplete is true, this is the final content
      return {
        planContent: content || null,
      };
    }),
    updateFileStreamingContent: assign(({ context, event }) => {
      if (
        event.type !== "RESPONSE_CHUNK" ||
        event.chunkType !== "file-output-streaming"
      )
        return {};
      if (!event.streamingFileOutput) return {};
      const { toolCallId, content } = event.streamingFileOutput;
      const updatedAccumulated = new Map(context.accumulatedFileContent);
      updatedAccumulated.set(toolCallId, content);

      // Update tool event with streaming content
      const updatedToolEvents = context.toolEvents.map((t) => {
        if (t.toolCallId === toolCallId && t.toolName === "writeTestFile") {
          return {
            ...t,
            // Store streaming content in a custom field for UI access
            streamingContent: content,
          };
        }
        return t;
      });

      // Update MessagePart with streaming content
      const updatedMessages = context.messages.map((msg) => {
        const updatedParts = msg.parts.map((part) => {
          if (
            part.type.startsWith("tool-") &&
            "toolCallId" in part &&
            part.toolCallId === toolCallId
          ) {
            return {
              ...part,
              streamingContent: content,
            };
          }
          return part;
        });
        return { ...msg, parts: updatedParts };
      });

      return {
        accumulatedFileContent: updatedAccumulated,
        toolEvents: updatedToolEvents,
        messages: updatedMessages,
      };
    }),
    reset: assign({
      messages: () => [],
      streamingContent: () => "",
      toolEvents: () => [],
      error: () => null,
      reasoningContent: () => "",
      isReasoningStreaming: () => false,
      hasCompletedAnalysis: () => false,
      scratchpadTodos: () => [],
      cacheLoaded: () => true, // Mark as loaded (intentionally skipping cache)
      historyLoaded: () => true, // Mark as loaded (intentionally skipping history)
      cachedAt: () => undefined,
      usage: () => null,
      planContent: () => null,
      testExecutions: () => [],
      accumulatedFileContent: () => new Map(),
      testSuiteQueue: () => [],
      currentSuiteId: () => null,
      agentMode: () => "plan",
    }),
    approvePlan: assign(({ event }) => {
      if (event.type !== "APPROVE_PLAN") return {};
      const suites = event.suites;
      const firstSuite = suites.length > 0 ? suites[0] : null;
      return {
        currentSuiteId: firstSuite?.id || null,
        agentMode: "act" as const,
        // Mark first suite as in_progress
        testSuiteQueue: suites.map((suite, index) =>
          index === 0 ? { ...suite, status: "in_progress" as const } : suite,
        ),
      };
    }),
    startNextSuite: assign(({ context }) => {
      const nextSuite = context.testSuiteQueue.find(
        (suite) => suite.status === "pending",
      );
      if (!nextSuite) {
        return {};
      }
      return {
        currentSuiteId: nextSuite.id,
        testSuiteQueue: context.testSuiteQueue.map((suite) =>
          suite.id === nextSuite.id
            ? { ...suite, status: "in_progress" as const }
            : suite,
        ),
      };
    }),
    markSuiteCompleted: assign(({ context, event }) => {
      if (event.type !== "MARK_SUITE_COMPLETED") return {};
      const { suiteId, results } = event;
      return {
        testSuiteQueue: context.testSuiteQueue.map((suite) =>
          suite.id === suiteId
            ? {
                ...suite,
                status: "completed" as const,
                testResults: results,
              }
            : suite,
        ),
        currentSuiteId: null,
      };
    }),
    markSuiteFailed: assign(({ context, event }) => {
      if (event.type !== "MARK_SUITE_FAILED") return {};
      const { suiteId, results } = event;
      return {
        testSuiteQueue: context.testSuiteQueue.map((suite) =>
          suite.id === suiteId
            ? {
                ...suite,
                status: "failed" as const,
                ...(results && { testResults: results }),
              }
            : suite,
        ),
        currentSuiteId: null,
      };
    }),
    cancelStream: assign({
      hasCompletedAnalysis: () => true, // Re-enable input
      isReasoningStreaming: () => false,
    }),
    devInjectState: assign(({ context, event }) => {
      if (event.type !== "DEV_INJECT_STATE") return {};
      // Merge the updates into the context
      return {
        ...context,
        ...event.updates,
      };
    }),
  },
}).createMachine({
  id: "changesetChat",
  initial: "idle",
  context: ({ input }) => ({
    files: input.files,
    branchName: input.branchName,
    messages: [],
    streamingContent: "",
    toolEvents: [],
    error: null,
    reasoningContent: "",
    isReasoningStreaming: false,
    hasCompletedAnalysis: false,
    scratchpadTodos: [],
    cacheLoaded: false,
    historyLoaded: false,
    cachedAt: undefined,
    usage: null,
    planContent: null,
    testExecutions: [],
    accumulatedTestOutput: new Map(),
    accumulatedFileContent: new Map(),
    testSuiteQueue: [],
    currentSuiteId: null,
    agentMode: "plan" as const,
  }),
  states: {
    idle: {
      on: {
        RECEIVE_CACHE: {
          actions: ["receiveCache"],
        },
        RECEIVE_BACKEND_HISTORY: [
          {
            guard: "shouldLoadBackendHistory",
            actions: ["receiveBackendHistory"],
          },
          {
            guard: "shouldStartFreshAnalysis",
            target: "analyzing",
            actions: ["addInitialMessage", "markHistoryLoaded"],
          },
          {
            // Backend history received but cache is newer or already loaded
            actions: ["markHistoryLoaded"],
          },
        ],
        LOAD_HISTORY: {
          actions: ["loadHistory"],
        },
        START_ANALYSIS: {
          target: "analyzing",
          actions: ["addInitialMessage"],
        },
        SEND_MESSAGE: {
          target: "analyzing",
          actions: ["addUserMessage"],
        },
        CLEAR_ERROR: {
          actions: ["clearError"],
        },
        RESET: {
          target: "idle",
          actions: ["reset"],
        },
        APPROVE_PLAN: {
          actions: ["approvePlan"],
          target: "analyzing",
        },
        DEV_INJECT_STATE: {
          actions: ["devInjectState"],
        },
      },
    },
    analyzing: {
      on: {
        RESPONSE_CHUNK: {
          target: "streaming",
          actions: [
            "appendStreamingContent",
            "appendReasoningContent",
            "addToolEvent",
            "updateToolEvent",
            "addTextPart",
            "addToolPart",
            "updateToolPart",
            "updateScratchpadTodos",
            "updateTestExecution",
            "updateUsage",
            "updatePlanContent",
          ],
        },
        RESPONSE_COMPLETE: {
          target: "idle",
          actions: [
            "clearStreamingContent",
            "stopReasoningStreaming",
            "markAnalysisComplete",
          ],
        },
        RESPONSE_ERROR: {
          target: "idle",
          actions: ["setResponseError"],
        },
        SEND_MESSAGE: {
          target: "analyzing",
          actions: ["addUserMessage"],
        },
        CANCEL_STREAM: {
          target: "idle",
          actions: [
            "cancelStream",
            "clearStreamingContent",
            "stopReasoningStreaming",
          ],
        },
        DEV_INJECT_STATE: {
          actions: ["devInjectState"],
        },
      },
    },
    streaming: {
      on: {
        RESPONSE_CHUNK: {
          actions: [
            "appendStreamingContent",
            "appendReasoningContent",
            "addToolEvent",
            "updateToolEvent",
            "addTextPart",
            "addToolPart",
            "updateToolPart",
            "updateScratchpadTodos",
            "updateTestExecutionFromStream",
            "updateTestExecution",
            "updateFileStreamingContent",
            "updateUsage",
            "updatePlanContent",
          ],
        },
        RESPONSE_COMPLETE: [
          {
            guard: ({ context }) => {
              // If in act mode and current suite completed, start next suite
              if (context.agentMode === "act" && context.currentSuiteId === null) {
                const hasPendingSuites = context.testSuiteQueue.some(
                  (s) => s.status === "pending",
                );
                return hasPendingSuites;
              }
              return false;
            },
            actions: ["startNextSuite"],
            target: "analyzing",
          },
          {
            target: "idle",
            actions: [
              "clearStreamingContent",
              "stopReasoningStreaming",
              "markAnalysisComplete",
            ],
          },
        ],
        RESPONSE_ERROR: {
          target: "idle",
          actions: ["setResponseError"],
        },
        CANCEL_STREAM: {
          target: "idle",
          actions: [
            "cancelStream",
            "clearStreamingContent",
            "stopReasoningStreaming",
          ],
        },
        START_NEXT_SUITE: {
          actions: ["startNextSuite"],
        },
        MARK_SUITE_COMPLETED: {
          actions: ["markSuiteCompleted"],
        },
        MARK_SUITE_FAILED: {
          actions: ["markSuiteFailed"],
        },
        DEV_INJECT_STATE: {
          actions: ["devInjectState"],
        },
      },
    },
  },
});

export type ChangesetChatMachine = typeof changesetChatMachine;
