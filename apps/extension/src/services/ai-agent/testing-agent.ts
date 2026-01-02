import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import { type LanguageModel, streamText } from "ai";
import { Data, Effect, HashMap, Match, Ref, Stream } from "effect";
import type * as vscode from "vscode";
import { getWorkspaceRoot } from "../../lib/vscode-effects.js";
import { createUsageEvent, stringifyEvent } from "../../utils/json-utils.js";
import { streamFromAI } from "../../utils/stream-utils.js";
import { AIModels } from "../ai-models.js";
import {
  createAnthropicProvider,
  createXaiProvider,
} from "../ai-provider-factory.js";
import { ConfigService } from "../config-service.js";
import { KnowledgeFileService } from "../knowledge-file-service.js";
import { SummaryService } from "./summary-service.js";
import { emitAgentError } from "./agent-error-utils.js";
import { CompletionDetector } from "./completion-detector.js";
import {
  estimateContextSize,
  getMessagesToKeep,
  shouldSummarize,
  type Message,
} from "./context-tracker.js";
import { PromptFactory, PromptService } from "./prompts/index.js";
import { makeTokenBudget } from "./token-budget.js";
import { KnowledgeContext } from "./knowledge-context.js";
// DiffContentProvider import removed - file edits now use PendingEditService
import { addCacheControlToMessages } from "./utils/cache-control.js";
import {
  createAgentState,
  createStreamingState,
  setMessages,
  type AgentState,
  type StreamingState,
} from "./agent-state.js";
import {
  handleToolCallStreamingStart,
  handleToolCallDelta,
  handleToolCall,
  handleTextDelta,
  handleThinking,
  handleToolResult,
  type ProgressCallback,
} from "./event-handlers.js";
import { createToolSet } from "./tool-factory.js";
import { generateCorrelationId } from "./testing-agent-helpers.js";
import { logToOutput } from "../../utils/logger.js";

class TestingAgentError extends Data.TaggedError("TestingAgentError")<{
  message: string;
  cause?: unknown;
}> {}

class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  message: string;
}> {}

/**
 * Testing Agent for analyzing components, proposing Cypress tests, and executing approved tests
 * Handles both planning (no file writes) and execution (file writes) phases
 * Uses Claude Opus 4.5 for intelligent analysis and planning
 */
export class TestingAgent extends Effect.Service<TestingAgent>()(
  "TestingAgent",
  {
    effect: Effect.gen(function* () {
      const configService = yield* ConfigService;
      const knowledgeFileService = yield* KnowledgeFileService;
      const summaryService = yield* SummaryService;
      const completionDetector = yield* CompletionDetector;
      const promptService = yield* PromptService;

      return {
        /**
         * Check if the agent is properly configured
         */
        isConfigured: () =>
          Effect.gen(function* () {
            return yield* configService.isConfigured();
          }),

        /**
         * Conversational agent for planning and executing tests
         * Uses a single streamText call with all tools available
         * Agent iterates on proposals until user approves, then writes tests
         *
         * Mode behavior:
         * - "plan": Only read-only tools available (searchKnowledge, webSearch, bashExecute for reading)
         * - "act": All tools available including writeTestFile
         */
        planAndExecuteTests: (
          filePaths: string | string[],
          options?: {
            mode?: "plan" | "act";
            planFilePath?: string; // Path to approved test plan file (for act mode context)
            conversationHistory?: Array<{
              role: "user" | "assistant" | "system";
              content: string;
            }>;
            outputChannel?: vscode.OutputChannel;
            progressCallback?: (status: string, message: string) => void;
            signal?: AbortSignal;
          },
        ) =>
          Effect.gen(function* () {
            const files = Array.isArray(filePaths) ? filePaths : [filePaths];
            const mode = options?.mode ?? "plan";
            const planFilePath = options?.planFilePath;
            const conversationHistory = options?.conversationHistory ?? [];
            const progressCallback = options?.progressCallback;
            const signal = options?.signal;

            if (files.length === 0) {
              return yield* Effect.fail(
                new ConfigurationError({
                  message: "No files provided",
                }),
              );
            }

            const correlationId = generateCorrelationId("plan-exec");
            const startTime = Date.now();

            yield* Effect.logDebug(
              `[TestingAgent:${correlationId}] Starting planAndExecuteTests for ${files.length} file(s)`,
            );

            // Check configuration
            const configured = yield* configService.isConfigured();
            if (!configured) {
              return yield* Effect.fail(
                new ConfigurationError({
                  message:
                    "AI Gateway token not available. Please log in to authenticate.",
                }),
              );
            }

            // Initialize state
            const initialMessages = yield* buildInitialMessages(
              files,
              conversationHistory,
              mode,
            );
            const agentState = yield* createAgentState(initialMessages);
            const streamingState = yield* createStreamingState();

            // Knowledge context for persistent storage across summarization
            const knowledgeContext = new KnowledgeContext();

            // Setup Token Budget
            const budget = yield* makeTokenBudget();

            // Setup Firecrawl
            const firecrawlApiKey = yield* configService
              .getFirecrawlApiKey()
              .pipe(Effect.catchAll(() => Effect.succeed(null)));

            if (firecrawlApiKey) {
              yield* Effect.sync(() => {
                process.env.FIRECRAWL_API_KEY = firecrawlApiKey;
              });
            }

            // Get AI Token
            const tokenResult = yield* configService.getAiApiKey().pipe(
              Effect.mapError(
                (error) =>
                  new ConfigurationError({
                    message:
                      error instanceof Error ? error.message : "Unknown error",
                  }),
              ),
            );

            if (!tokenResult.token) {
              return yield* Effect.fail(
                new ConfigurationError({
                  message:
                    "AI token not available. Please log in or provide API key.",
                }),
              );
            }

            // Create AI providers
            const anthropic = createAnthropicProvider(tokenResult);
            const xai = createXaiProvider(tokenResult);
            const summaryModel = xai(AIModels.xai.fastNonReasoning);

            // Setup workspace context
            const workspaceRootUri = yield* getWorkspaceRoot();
            const workspaceRoot = workspaceRootUri.fsPath;

            // Build tools
            const tools = yield* createToolSet({
              mode,
              budget,
              firecrawlEnabled: !!firecrawlApiKey,
              knowledgeFileService,
              summaryService,
              summaryModel,
              getMessages: Ref.get(agentState).pipe(
                Effect.map((state) => state.messages),
              ),
              setMessages: (messages: Message[]) =>
                setMessages(agentState, messages),
              getKnowledgeContext: Effect.sync(() =>
                knowledgeContext.formatForPrompt(),
              ),
              progressCallback,
              bashStreamingCallback: createBashStreamingCallback(
                streamingState,
                progressCallback,
              ),
              fileStreamingCallback: createFileStreamingCallback(
                streamingState,
                progressCallback,
              ),
              onKnowledgeRetrieved: (results) => {
                knowledgeContext.addFromSearchResults(results);
              },
            });

            progressCallback?.(
              "analyzing",
              `Analyzing ${files.length} file(s)...`,
            );

            // Build system prompt
            const baseSystemPrompt = yield* promptService.buildTestAgentPrompt({
              workspaceRoot,
              mode,
              planFilePath, // Include plan file path for act mode context
              includeUserRules: true,
            });

            // Context management
            yield* manageContext(
              agentState,
              baseSystemPrompt,
              summaryService,
              summaryModel,
              knowledgeContext,
              progressCallback,
              correlationId,
            );

            // Get knowledge context for system prompt
            const knowledgeContextPrompt = knowledgeContext.formatForPrompt();
            const knowledgeContextSection = knowledgeContextPrompt
              ? `\n\n${knowledgeContextPrompt}`
              : "";

            const systemPromptWithWorkspace = `${baseSystemPrompt}

              <workspace_root>
              The workspace root is: ${workspaceRoot}
              All paths should be relative to this root. Use this information to understand the project structure and create test files in appropriate locations.
              </workspace_root>${knowledgeContextSection}`;

            const emitError = (error: unknown) => {
              emitAgentError(error, progressCallback);
            };

            // Create completion state for detecting [COMPLETE] delimiter
            const completionStateRef = yield* completionDetector.createState();
            const stopWhenComplete =
              completionDetector.createStopCondition(completionStateRef);

            // Stream execution
            const currentState = yield* Ref.get(agentState);

            // Apply dynamic prompt caching to messages
            const model = anthropic(AIModels.testing.medium);

            // Build all messages (system + conversation)
            const allMessages = [
              {
                role: "system" as const,
                content: systemPromptWithWorkspace,
              },
              ...currentState.messages,
            ];

            // Apply cache control to the last message (incremental caching)
            const cachedMessages = addCacheControlToMessages(
              allMessages,
              model,
            );

            const streamResult = yield* Effect.try({
              try: () =>
                streamText({
                  model,
                  tools,
                  maxRetries: 0,
                  stopWhen: stopWhenComplete,
                  abortSignal: signal,
                  messages: cachedMessages,
                  providerOptions: {
                    anthropic:
                      mode === "plan"
                        ? ({
                            thinking: { type: "enabled", budgetTokens: 5000 },
                          } satisfies AnthropicProviderOptions)
                        : {}, // No thinking in act mode - just execute the plan
                  },
                  headers:
                    mode === "plan"
                      ? {
                          "anthropic-beta": "interleaved-thinking-2025-05-14",
                        }
                      : {}, // No thinking headers in act mode
                }),
              catch: (error) => {
                emitError(error);
                return new TestingAgentError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                });
              },
            });

            // Process stream with Match
            const eventStream = streamFromAI(streamResult);
            yield* eventStream.pipe(
              Stream.mapError((error) => {
                emitError(error);
                return new TestingAgentError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                });
              }),
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  if (signal?.aborted) {
                    yield* Effect.logDebug(
                      `[TestingAgent:${correlationId}] Abort signal detected`,
                    );
                    return yield* Effect.fail(
                      new TestingAgentError({
                        message: "Operation cancelled by user",
                      }),
                    );
                  }

                  // Log event before routing
                  logToOutput(
                    `[testing-agent] Routing event.type: ${event.type}`,
                  );

                  // Route events to handlers
                  yield* Match.value(event).pipe(
                    Match.when({ type: "tool-call-streaming-start" }, (e) =>
                      handleToolCallStreamingStart(
                        e,
                        streamingState,
                        progressCallback,
                        correlationId,
                      ),
                    ),
                    Match.when({ type: "tool-call-delta" }, (e) =>
                      handleToolCallDelta(
                        e,
                        streamingState,
                        progressCallback,
                        correlationId,
                      ),
                    ),
                    Match.when({ type: "tool-call" }, (e) =>
                      handleToolCall(
                        e,
                        agentState,
                        streamingState,
                        progressCallback,
                        correlationId,
                      ),
                    ),
                    Match.when(
                      (e) => e.type === "text-delta" && !!e.content,
                      (e) => handleTextDelta(e, progressCallback),
                    ),
                    Match.when(
                      (e) => e.type === "thinking" && !!e.content,
                      (e) => handleThinking(e, progressCallback, correlationId),
                    ),
                    Match.when({ type: "tool-result" }, (e) =>
                      handleToolResult(
                        e,
                        agentState,
                        streamingState,
                        progressCallback,
                        correlationId,
                      ),
                    ),
                    Match.orElse(() => Effect.void),
                  );
                }),
              ),
            );

            // Process results
            const result = yield* Effect.tryPromise({
              try: async () => await streamResult,
              catch: (error) => {
                emitError(error);
                return new TestingAgentError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                });
              },
            });

            const awaitedSteps = yield* Effect.tryPromise({
              try: async () => await result.steps,
              catch: (error) => {
                emitError(error);
                return new TestingAgentError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                });
              },
            });

            const usage = yield* Effect.tryPromise({
              try: async () => await result.usage,
              catch: (error) => {
                emitError(error);
                return new TestingAgentError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                });
              },
            }).pipe(Effect.catchAll(() => Effect.succeed(null)));

            if (usage) {
              yield* emitUsage(usage, progressCallback);
            }

            const totalDuration = Date.now() - startTime;
            const finalState = yield* Ref.get(agentState);
            const completionState =
              yield* completionDetector.getState(completionStateRef);

            yield* Effect.logDebug(
              `[TestingAgent:${correlationId}] Steps used: ${awaitedSteps.length} (unlimited, stopped by ${finalState.taskCompleted ? "completeTask tool" : completionState.isComplete ? "completion delimiter" : "other condition"})`,
            );
            yield* Effect.logDebug(
              `[TestingAgent:${correlationId}] Completed in ${totalDuration}ms. Executions: ${finalState.executions.length}, Task completed: ${finalState.taskCompleted}, Tool rejected: ${finalState.didRejectTool}`,
            );

            const responseText = yield* Effect.tryPromise({
              try: async () => (await result.text) || "",
              catch: (error) => {
                emitError(error);
                return new TestingAgentError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                });
              },
            }).pipe(Effect.catchAll(() => Effect.succeed("")));

            // Strip the completion delimiter from the response for display
            const cleanResponse =
              completionDetector.stripDelimiter(responseText);

            return {
              executions: finalState.executions,
              response: cleanResponse,
              taskCompleted: finalState.taskCompleted,
              toolRejected: finalState.didRejectTool,
            };
          }),
      };
    }),
  },
) {}

/**
 * Build initial messages from conversation history
 * Exported for testing purposes
 */
export const buildInitialMessages = (
  files: string[],
  conversationHistory: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>,
  mode: "plan" | "act" = "plan",
) =>
  Effect.gen(function* () {
    const workspaceRootUri = yield* getWorkspaceRoot();
    const workspaceRoot = workspaceRootUri.fsPath;

    const initialPrompt =
      files.length === 1
        ? PromptFactory.planTestForFile(files[0], workspaceRoot)
        : PromptFactory.planTestForChangeset(files, workspaceRoot);

    const messages: Message[] = [];
    if (conversationHistory.length === 0) {
      // First message ever - use planning prompt regardless of mode
      // (act mode should never start with empty history)
      messages.push({
        role: "user",
        content: initialPrompt,
      });
    } else {
      messages.push(...conversationHistory);
      // Only add planning prompt in plan mode
      if (
        mode === "plan" &&
        conversationHistory[conversationHistory.length - 1]?.role !== "user"
      ) {
        messages.push({
          role: "user",
          content: initialPrompt,
        });
      }
    }

    return messages;
  });

/**
 * Context management - check and summarize if needed
 */
const manageContext = (
  agentState: Ref.Ref<AgentState>,
  baseSystemPrompt: string,
  summaryService: SummaryService,
  summaryModel: LanguageModel,
  knowledgeContext: KnowledgeContext,
  progressCallback: ProgressCallback | undefined,
  correlationId: string,
) =>
  Effect.gen(function* () {
    const currentState = yield* Ref.get(agentState);
    const contextEstimate = estimateContextSize(
      currentState.messages,
      baseSystemPrompt,
    );

    yield* Effect.logDebug(
      `[TestingAgent:${correlationId}] Context estimate: ${contextEstimate.totalTokens} tokens (${(contextEstimate.percentUsed * 100).toFixed(1)}% used)`,
    );

    if (shouldSummarize(contextEstimate)) {
      progressCallback?.(
        "summarizing",
        "Context window approaching limit, summarizing conversation...",
      );

      const messagesToKeep = getMessagesToKeep();
      if (currentState.messages.length > messagesToKeep) {
        const messagesToSummarize = currentState.messages.slice(
          0,
          currentState.messages.length - messagesToKeep,
        );
        const messagesToKeepArray = currentState.messages.slice(
          -messagesToKeep,
        );

        const persistentContext = knowledgeContext.formatForPrompt();

        const summary = yield* summaryService
          .summarizeMessages(
            messagesToSummarize,
            summaryModel,
            undefined,
            persistentContext,
          )
          .pipe(
            Effect.catchAll((error) =>
              Effect.fail(
                new TestingAgentError({
                  message: error.message,
                  cause: error.cause,
                }),
              ),
            ),
          );

        const summarizedMessage: Message = {
          role: "system",
          content: `Previous conversation summary (${messagesToSummarize.length} messages summarized):\n\n${summary}`,
        };

        yield* setMessages(agentState, [
          summarizedMessage,
          ...messagesToKeepArray,
        ]);

        progressCallback?.(
          "summarized",
          `Summarized ${messagesToSummarize.length} messages`,
        );
      }
    }
  });

/**
 * Create bash streaming callback
 */
const createBashStreamingCallback = (
  streamingState: Ref.Ref<StreamingState>,
  progressCallback: ProgressCallback | undefined,
) => {
  return (chunk: { command: string; output: string }) => {
    // Run effect to get toolCallId
    Effect.runSync(
      Effect.gen(function* () {
        const state = yield* Ref.get(streamingState);
        const toolCallIdOption = HashMap.get(
          state.commandToToolCallId,
          chunk.command,
        );
        const toolCallId =
          toolCallIdOption._tag === "Some" ? toolCallIdOption.value : "";

        yield* Effect.sync(() => {
          progressCallback?.(
            "tool-output-streaming",
            JSON.stringify({
              type: "tool-output-streaming",
              toolCallId,
              command: chunk.command,
              output: chunk.output,
            }),
          );
        });
      }),
    );
  };
};

/**
 * Create file streaming callback
 */
const createFileStreamingCallback = (
  streamingState: Ref.Ref<StreamingState>,
  progressCallback: ProgressCallback | undefined,
) => {
  return (chunk: {
    filePath: string;
    content: string;
    isComplete: boolean;
  }) => {
    // Run effect to get toolCallId
    Effect.runSync(
      Effect.gen(function* () {
        const state = yield* Ref.get(streamingState);
        const toolCallIdOption = HashMap.get(
          state.fileToToolCallId,
          chunk.filePath,
        );
        const toolCallId =
          toolCallIdOption._tag === "Some" ? toolCallIdOption.value : "";

        yield* Effect.sync(() => {
          if (chunk.content === "" && !chunk.isComplete) {
            // File was just created/opened
            progressCallback?.(
              "file-created",
              JSON.stringify({
                type: "file-created",
                toolCallId,
                filePath: chunk.filePath,
              }),
            );
          } else {
            // Content chunk
            progressCallback?.(
              "file-output-streaming",
              JSON.stringify({
                type: "file-output-streaming",
                toolCallId,
                filePath: chunk.filePath,
                content: chunk.content,
                isComplete: chunk.isComplete,
              }),
            );
          }
        });
      }),
    );
  };
};

/**
 * Emit usage event
 */
const emitUsage = (
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
  },
  progressCallback: ProgressCallback | undefined,
) =>
  Effect.sync(() => {
    const usageEvent = createUsageEvent({
      inputTokens: usage.inputTokens ?? usage.promptTokens ?? 0,
      outputTokens: usage.outputTokens ?? usage.completionTokens ?? 0,
      totalTokens: usage.totalTokens ?? 0,
      reasoningTokens: usage.reasoningTokens ?? 0,
      cachedInputTokens: usage.cachedInputTokens ?? 0,
    });

    progressCallback?.("usage", stringifyEvent(usageEvent));
  });

/**
 * Production layer with all dependencies composed.
 */
export const TestingAgentLive = TestingAgent.Default;
