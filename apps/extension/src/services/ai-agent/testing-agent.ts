import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import type { ToolResult } from "@ai-sdk/provider-utils";
import { streamText } from "ai";
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
import { PromptFactory, TEST_AGENT_SYSTEM_PROMPT } from "./prompts.js";
import { makeTokenBudget } from "./token-budget.js";
import {
  createBashExecuteTool,
  createSearchKnowledgeTool,
  createSummarizeContextTool,
  createWebTools,
  createWriteKnowledgeFileTool,
  createWriteTestFileTool,
  createProposeTestPlanTool,
  createCompleteTaskTool,
} from "./tools/index.js";
import type { WriteTestFileOutput } from "./types.js";
import { KnowledgeContext } from "./knowledge-context.js";

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
      const knowledgeFileService = yield* KnowledgeFileService;
      const summaryService = yield* SummaryService;
      const completionDetector = yield* CompletionDetector;

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
            const mode = options?.mode ?? "plan"; // Default to plan mode for safety
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
            const didRejectToolRef = yield* Ref.make<boolean>(false);
            const taskCompletedRef = yield* Ref.make<boolean>(false);

            // Track toolCallIds for bash commands to enable streaming
            // Maps command to toolCallId (command may not be unique, but we'll use the most recent)
            const commandToToolCallId = new Map<string, string>();

            // Track toolCallIds for file writes to enable streaming
            // Maps filePath to toolCallId
            const fileToToolCallId = new Map<string, string>();

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

            // Create streaming callback for file writes
            const fileStreamingCallback = (chunk: {
              filePath: string;
              content: string;
              isComplete: boolean;
            }) => {
              // Look up toolCallId from filePath
              const toolCallId = fileToToolCallId.get(chunk.filePath) || "";

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
            };

            const writeTestFile = createWriteTestFileTool(
              selfApprovingRegistry,
              fileStreamingCallback,
            );

            const webTools = firecrawlApiKey
              ? createWebTools({ enableSearch: true })
              : {};

            // Callback to store knowledge in persistent context
            const onKnowledgeRetrieved = (
              results: Array<{
                category: string;
                title: string;
                content: string;
                path: string;
              }>,
            ) => {
              knowledgeContext.addFromSearchResults(results);
            };

            // Create summarize context tool with Ref access and persistent context
            const summarizeContext = createSummarizeContextTool(
              summaryService,
              summaryModel,
              Ref.get(messagesRef),
              (newMessages) => Ref.set(messagesRef, newMessages),
              progressCallback,
              Effect.sync(() => knowledgeContext.formatForPrompt()),
            );

            // Create streaming callback for bash execute tool
            const bashStreamingCallback = (chunk: {
              command: string;
              output: string;
            }) => {
              // Look up toolCallId from command
              const toolCallId = commandToToolCallId.get(chunk.command) || "";

              // Emit streaming output event
              progressCallback?.(
                "tool-output-streaming",
                JSON.stringify({
                  type: "tool-output-streaming",
                  toolCallId,
                  command: chunk.command,
                  output: chunk.output,
                }),
              );
            };

            // Build tools based on mode
            // Plan mode: Only read-only tools + proposeTestPlan (no file writes)
            // Act mode: All tools available
            const baseTools = {
              bashExecute: createBashExecuteTool(budget, bashStreamingCallback),
              searchKnowledge: createSearchKnowledgeTool(
                knowledgeFileService,
                onKnowledgeRetrieved,
              ),
              summarizeContext,
              proposeTestPlan: createProposeTestPlanTool(
                undefined, // No approval callback for now
                autoApproveRegistry,
              ),
              completeTask: createCompleteTaskTool(),
              ...webTools,
            };

            // Add write tools only in act mode
            const tools =
              mode === "act"
                ? {
                    ...baseTools,
                    writeKnowledgeFile:
                      createWriteKnowledgeFileTool(knowledgeFileService),
                    writeTestFile,
                  }
                : baseTools;

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

                  // Get persistent knowledge context
                  const persistentContext = knowledgeContext.formatForPrompt();

                  const summary = yield* summaryService
                    .summarizeMessages(
                      messagesToSummarize,
                      summaryModel,
                      undefined,
                      persistentContext,
                    )
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

            // Get knowledge context for system prompt
            const knowledgeContextPrompt = knowledgeContext.formatForPrompt();
            const knowledgeContextSection = knowledgeContextPrompt
              ? `\n\n${knowledgeContextPrompt}`
              : "";

            // System prompt
            const systemPromptWithWorkspace = `${TEST_AGENT_SYSTEM_PROMPT}

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

            // Stream execution with unlimited steps (stops on [COMPLETE] delimiter)
            const currentMessages = yield* Ref.get(messagesRef);
            const streamResult = yield* Effect.try({
              try: () =>
                streamText({
                  model: anthropic(AIModels.anthropic.testing),
                  tools,
                  maxRetries: 0,
                  stopWhen: stopWhenComplete,
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
                        // Check if a previous tool was rejected (rejection cascade)
                        const didReject = yield* Ref.get(didRejectToolRef);
                        if (didReject) {
                          // Skip this tool due to rejection cascade
                          yield* Effect.logDebug(
                            `[TestingAgent:${correlationId}] Skipping tool ${e.toolName} due to rejection cascade`,
                          );
                          progressCallback?.(
                            "tool-skipped",
                            JSON.stringify({
                              type: "tool-skipped",
                              toolCallId: e.toolCallId,
                              toolName: e.toolName,
                              reason: "Previous tool was rejected",
                            }),
                          );
                          return;
                        }

                        yield* Effect.logDebug(
                          `[TestingAgent:${correlationId}] Tool call: ${e.toolName}`,
                        );

                        // Track toolCallId for bash commands
                        if (e.toolName === "bashExecute") {
                          const args = e.toolArgs as
                            | { command?: string }
                            | undefined;
                          const command = args?.command || "";
                          if (command && e.toolCallId) {
                            commandToToolCallId.set(command, e.toolCallId);
                          }
                        }

                        // Track toolCallId for file writes
                        if (e.toolName === "writeTestFile") {
                          const args = e.toolArgs as
                            | { targetPath?: string }
                            | undefined;
                          const targetPath = args?.targetPath || "";
                          if (targetPath && e.toolCallId) {
                            fileToToolCallId.set(targetPath, e.toolCallId);
                          }
                        }

                        // Progress updates
                        if (e.toolName === "bashExecute") {
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

                        // Check if tool was rejected (user rejected via UI)
                        const outputObj =
                          actualOutput && typeof actualOutput === "object"
                            ? actualOutput
                            : {};
                        const wasRejected =
                          "rejected" in outputObj && outputObj.rejected === true;

                        if (wasRejected) {
                          // Set rejection flag for cascade
                          yield* Ref.set(didRejectToolRef, true);
                          yield* Effect.logDebug(
                            `[TestingAgent:${correlationId}] Tool ${e.toolName} was rejected - enabling rejection cascade`,
                          );
                        }

                        // Check for completion via completeTask tool
                        if (e.toolName === "completeTask" && e.toolResult) {
                          const toolResult = e.toolResult as ToolResult<
                            string,
                            unknown,
                            { success: boolean; completed: boolean; message: string }
                          >;
                          if (toolResult.output?.completed) {
                            yield* Ref.set(taskCompletedRef, true);
                            yield* Effect.logDebug(
                              `[TestingAgent:${correlationId}] Task marked as complete via completeTask tool`,
                            );
                          }
                        }

                        progressCallback?.(
                          "tool-result",
                          JSON.stringify({
                            type: "tool-result",
                            toolCallId: e.toolCallId,
                            toolName: e.toolName,
                            output: actualOutput,
                            state: wasRejected
                              ? "output-rejected"
                              : "output-available",
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
            const completionState =
              yield* completionDetector.getState(completionStateRef);
            const taskCompleted = yield* Ref.get(taskCompletedRef);
            const didReject = yield* Ref.get(didRejectToolRef);

            yield* Effect.logDebug(
              `[TestingAgent:${correlationId}] Steps used: ${awaitedSteps.length} (unlimited, stopped by ${taskCompleted ? "completeTask tool" : completionState.isComplete ? "completion delimiter" : "other condition"})`,
            );
            yield* Effect.logDebug(
              `[TestingAgent:${correlationId}] Completed in ${totalDuration}ms. Executions: ${finalExecutions.length}, Task completed: ${taskCompleted}, Tool rejected: ${didReject}`,
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
              executions: finalExecutions,
              response: cleanResponse,
              taskCompleted,
              toolRejected: didReject,
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
