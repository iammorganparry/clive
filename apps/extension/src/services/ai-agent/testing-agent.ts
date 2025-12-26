import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import type { ToolResult } from "@ai-sdk/provider-utils";
import { stepCountIs, streamText } from "ai";
import { Data, Effect, Match, Ref, Stream } from "effect";
import type * as vscode from "vscode";
import { getWorkspaceRoot } from "../../lib/vscode-effects.js";
import { createUsageEvent, stringifyEvent } from "../../utils/json-utils.js";
import { streamFromAI } from "../../utils/stream-utils.js";
import { AIModels } from "../ai-models.js";
import {
  createAnthropicProvider,
  createXaiProvider,
} from "../ai-provider-factory.js";
import { CodebaseIndexingService } from "../codebase-indexing-service.js";
import { ConfigService } from "../config-service.js";
import { KnowledgeFileService } from "../knowledge-file-service.js";
import { SummaryService } from "./summary-service.js";
import { emitAgentError } from "./agent-error-utils.js";
import {
  estimateContextSize,
  getMessagesToKeep,
  shouldSummarize,
  type Message,
} from "./context-tracker.js";
import { PromptFactory, TEST_AGENT_SYSTEM_PROMPT } from "./prompts.js";
import { makeTokenBudget } from "./token-budget.js";
import {
  createBashExecuteTool,
  createSearchKnowledgeTool,
  createSemanticSearchTool,
  createSummarizeContextTool,
  createWebTools,
  createWriteKnowledgeFileTool,
  createWriteTestFileTool,
} from "./tools/index.js";
import type { WriteTestFileOutput } from "./types.js";

class TestingAgentError extends Data.TaggedError("TestingAgentError")<{
  message: string;
  cause?: unknown;
}> {}

class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  message: string;
}> {}

interface Execution {
  testId: string;
  filePath?: string;
}

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
      const indexingService = yield* CodebaseIndexingService;
      const knowledgeFileService = yield* KnowledgeFileService;
      const summaryService = yield* SummaryService;

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
         */
        planAndExecuteTests: (
          filePaths: string | string[],
          options?: {
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

            const correlationId = `plan-exec-${Date.now()}-${Math.random().toString(36).substring(7)}`;
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

            // State management with Refs
            const messagesRef = yield* Ref.make<Message[]>([]);
            const executionsRef = yield* Ref.make<Execution[]>([]);

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

            // Create Anthropic provider
            const anthropic = createAnthropicProvider(tokenResult);
            const xai = createXaiProvider(tokenResult);

            // Create summary model for context summarization
            const summaryModel = xai(AIModels.xai.fastNonReasoning);

            // Setup tools
            const autoApproveRegistry = new Set<string>();
            const selfApprovingRegistry = {
              has: (id: string) => {
                autoApproveRegistry.add(id);
                return true;
              },
              add: (id: string) => autoApproveRegistry.add(id),
              delete: (id: string) => autoApproveRegistry.delete(id),
            } as Set<string>;

            const writeTestFile = createWriteTestFileTool(
              selfApprovingRegistry,
            );

            const webTools = firecrawlApiKey
              ? createWebTools({ enableSearch: true })
              : {};

            // Create summarize context tool with Ref access
            const summarizeContext = createSummarizeContextTool(
              summaryService,
              summaryModel,
              Ref.get(messagesRef),
              (newMessages) => Ref.set(messagesRef, newMessages),
              progressCallback,
            );

            const tools = {
              bashExecute: createBashExecuteTool(budget),
              semanticSearch: createSemanticSearchTool(indexingService),
              searchKnowledge: createSearchKnowledgeTool(knowledgeFileService),
              writeKnowledgeFile:
                createWriteKnowledgeFileTool(knowledgeFileService),
              writeTestFile,
              summarizeContext,
              ...webTools,
            };

            // Setup initial context
            const workspaceRootUri = yield* getWorkspaceRoot();
            const workspaceRoot = workspaceRootUri.fsPath;

            const initialPrompt =
              files.length === 1
                ? PromptFactory.planTestForFile(files[0], workspaceRoot)
                : PromptFactory.planTestForChangeset(files, workspaceRoot);

            const initialMessages: Message[] = [];
            if (conversationHistory.length === 0) {
              initialMessages.push({
                role: "user",
                content: initialPrompt,
              });
            } else {
              initialMessages.push(...conversationHistory);
              if (
                conversationHistory[conversationHistory.length - 1]?.role !==
                "user"
              ) {
                initialMessages.push({
                  role: "user",
                  content: initialPrompt,
                });
              }
            }
            yield* Ref.set(messagesRef, initialMessages);

            progressCallback?.(
              "analyzing",
              `Analyzing ${files.length} file(s)...`,
            );

            // Context Management Effect
            const manageContext = Effect.gen(function* () {
              const currentMessages = yield* Ref.get(messagesRef);
              const contextEstimate = estimateContextSize(
                currentMessages,
                TEST_AGENT_SYSTEM_PROMPT,
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
                if (currentMessages.length > messagesToKeep) {
                  const messagesToSummarize = currentMessages.slice(
                    0,
                    currentMessages.length - messagesToKeep,
                  );
                  const messagesToKeepArray = currentMessages.slice(
                    -messagesToKeep,
                  );

                  const summary = yield* summaryService
                    .summarizeMessages(messagesToSummarize, summaryModel)
                    .pipe(
                      Effect.catchAll(
                        (error) =>
                          new TestingAgentError({
                            message: error.message,
                            cause: error.cause,
                          }),
                      ),
                    );

                  const summarizedMessage: Message = {
                    role: "system",
                    content: `Previous conversation summary (${messagesToSummarize.length} messages summarized):\n\n${summary}`,
                  };

                  yield* Ref.set(messagesRef, [
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

            // Run context check
            yield* manageContext;

            // System prompt
            const systemPromptWithWorkspace = `${TEST_AGENT_SYSTEM_PROMPT}

              <workspace_root>
              The workspace root is: ${workspaceRoot}
              All paths should be relative to this root. Use this information to understand the project structure and create test files in appropriate locations.
              </workspace_root>`;

            const emitError = (error: unknown) => {
              emitAgentError(error, progressCallback);
            };

            // Stream execution
            const currentMessages = yield* Ref.get(messagesRef);
            const streamResult = yield* Effect.try({
              try: () =>
                streamText({
                  model: anthropic(AIModels.anthropic.testing),
                  tools,
                  maxRetries: 0,
                  stopWhen: stepCountIs(100),
                  abortSignal: signal,
                  messages: [
                    {
                      role: "system" as const,
                      content: systemPromptWithWorkspace,
                      providerOptions: {
                        anthropic: {
                          cacheControl: { type: "ephemeral" },
                        },
                      },
                    },
                    ...currentMessages,
                  ],
                  providerOptions: {
                    anthropic: {
                      thinking: { type: "enabled", budgetTokens: 5000 },
                    } satisfies AnthropicProviderOptions,
                  },
                  headers: {
                    "anthropic-beta": "interleaved-thinking-2025-05-14",
                  },
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

                  // Use Match for event processing
                  yield* Match.value(event).pipe(
                    Match.when({ type: "tool-call" }, (e) =>
                      Effect.gen(function* () {
                        yield* Effect.logDebug(
                          `[TestingAgent:${correlationId}] Tool call: ${e.toolName}`,
                        );

                        // Progress updates
                        if (e.toolName === "semanticSearch") {
                          progressCallback?.(
                            "searching",
                            "Searching codebase for context...",
                          );
                        } else if (e.toolName === "bashExecute") {
                          const args = e.toolArgs as
                            | { command?: string }
                            | undefined;
                          const command = args?.command || "";
                          if (
                            command.includes("vitest") ||
                            command.includes("jest") ||
                            command.includes("playwright") ||
                            command.includes("cypress") ||
                            command.includes("npm test") ||
                            command.includes("npm run test")
                          ) {
                            progressCallback?.(
                              "running",
                              `Running test: ${command.substring(0, 100)}`,
                            );
                          } else if (
                            command.includes("cat ") ||
                            command.includes("head ") ||
                            command.includes("tail ")
                          ) {
                            progressCallback?.(
                              "reading",
                              "Reading file contents...",
                            );
                          } else if (
                            command.includes("find ") ||
                            command.includes("ls ")
                          ) {
                            progressCallback?.(
                              "scanning",
                              "Scanning directory structure...",
                            );
                          } else {
                            progressCallback?.(
                              "executing",
                              "Running command...",
                            );
                          }
                        } else if (e.toolName === "writeTestFile") {
                          progressCallback?.("writing", "Writing test file...");
                        } else if (e.toolName === "summarizeContext") {
                          progressCallback?.(
                            "summarizing",
                            "Summarizing conversation to free context...",
                          );
                        }

                        // Emit event
                        progressCallback?.(
                          "tool-call",
                          JSON.stringify({
                            type: "tool-call",
                            toolCallId: e.toolCallId,
                            toolName: e.toolName,
                            args: e.toolArgs,
                            state: "input-available",
                          }),
                        );
                      }),
                    ),
                    Match.when(
                      (e) => e.type === "text-delta" && !!e.content,
                      (e) =>
                        Effect.sync(() => {
                          progressCallback?.(
                            "content_streamed",
                            JSON.stringify({
                              type: "content_streamed",
                              content: e.content,
                            }),
                          );
                        }),
                    ),
                    Match.when(
                      (e) => e.type === "thinking" && !!e.content,
                      (e) =>
                        Effect.gen(function* () {
                          yield* Effect.logDebug(
                            `[TestingAgent:${correlationId}] Thinking event received`,
                          );
                          progressCallback?.(
                            "reasoning",
                            JSON.stringify({
                              type: "reasoning",
                              content: e.content,
                            }),
                          );
                        }),
                    ),
                    Match.when({ type: "tool-result" }, (e) =>
                      Effect.gen(function* () {
                        yield* Effect.logDebug(
                          `[TestingAgent:${correlationId}] Tool result: ${e.toolName}`,
                        );

                        const actualOutput =
                          e.toolResult &&
                          typeof e.toolResult === "object" &&
                          "output" in e.toolResult
                            ? e.toolResult.output
                            : e.toolResult;

                        progressCallback?.(
                          "tool-result",
                          JSON.stringify({
                            type: "tool-result",
                            toolCallId: e.toolCallId,
                            toolName: e.toolName,
                            output: actualOutput,
                            state: "output-available",
                          }),
                        );

                        // Update executions ref
                        if (e.toolName === "writeTestFile" && e.toolResult) {
                          const toolResult = e.toolResult as ToolResult<
                            string,
                            unknown,
                            WriteTestFileOutput
                          >;
                          if (toolResult.output?.success) {
                            yield* Ref.update(executionsRef, (prev) => [
                              ...prev,
                              {
                                testId: "unknown",
                                filePath: toolResult.output?.filePath,
                              },
                            ]);
                          }
                        }
                      }),
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
              const usageData = usage as {
                promptTokens?: number;
                completionTokens?: number;
                totalTokens?: number;
                inputTokens?: number;
                outputTokens?: number;
                reasoningTokens?: number;
                cachedInputTokens?: number;
              };

              const usageEvent = createUsageEvent({
                inputTokens:
                  usageData.inputTokens ?? usageData.promptTokens ?? 0,
                outputTokens:
                  usageData.outputTokens ?? usageData.completionTokens ?? 0,
                totalTokens: usageData.totalTokens ?? 0,
                reasoningTokens: usageData.reasoningTokens ?? 0,
                cachedInputTokens: usageData.cachedInputTokens ?? 0,
              });

              progressCallback?.("usage", stringifyEvent(usageEvent));
            }

            const totalDuration = Date.now() - startTime;
            const finalExecutions = yield* Ref.get(executionsRef);

            yield* Effect.logDebug(
              `[TestingAgent:${correlationId}] Steps used: ${awaitedSteps.length}/40`,
            );
            yield* Effect.logDebug(
              `[TestingAgent:${correlationId}] Completed in ${totalDuration}ms. Executions: ${finalExecutions.length}`,
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

            return {
              executions: finalExecutions,
              response: responseText,
            };
          }),
      };
    }),
  },
) {}

/**
 * Production layer with all dependencies composed.
 */
export const TestingAgentLive = TestingAgent.Default;
