import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import type { ToolResult } from "@ai-sdk/provider-utils";
import { stepCountIs, streamText } from "ai";
import { Data, Effect, Stream } from "effect";
import type * as vscode from "vscode";
import { streamFromAI } from "../../utils/stream-utils.js";
import { AIModels } from "../ai-models.js";
import { createAnthropicProvider } from "../ai-provider-factory.js";
import { CodebaseIndexingService } from "../codebase-indexing-service.js";
import { ConfigService } from "../config-service.js";
import { KnowledgeFileService } from "../knowledge-file-service.js";
import { PromptFactory, TEST_AGENT_SYSTEM_PROMPT } from "./prompts.js";
import { makeTokenBudget } from "./token-budget.js";
import {
  createBashExecuteTool,
  createSemanticSearchTool,
  createWriteTestFileTool,
  createWebTools,
  createSearchKnowledgeTool,
  createWriteKnowledgeFileTool,
  createRunTestTool,
} from "./tools/index.js";
import type { WriteTestFileOutput } from "./types.js";

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
      const indexingService = yield* CodebaseIndexingService;
      const knowledgeFileService = yield* KnowledgeFileService;

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

            // Create token budget
            const budget = yield* makeTokenBudget();

            // Get Firecrawl API key and set as environment variable
            const firecrawlApiKey = yield* configService
              .getFirecrawlApiKey()
              .pipe(Effect.catchAll(() => Effect.succeed(null)));
            if (firecrawlApiKey) {
              process.env.FIRECRAWL_API_KEY = firecrawlApiKey;
            }

            // Create all tools upfront
            // Create a self-approving registry since approval comes through conversation
            const autoApproveRegistry = new Set<string>();
            const selfApprovingRegistry = {
              has: (id: string) => {
                autoApproveRegistry.add(id); // Auto-approve on first check
                return true;
              },
              add: (id: string) => autoApproveRegistry.add(id),
              delete: (id: string) => autoApproveRegistry.delete(id),
            } as Set<string>;

            const writeTestFile = createWriteTestFileTool(
              selfApprovingRegistry,
            );

            // Create test execution tool with approval registry
            const testApprovalRegistry = new Set<string>();
            const runTest = createRunTestTool(testApprovalRegistry);

            // Create web tools if API key is available
            const webTools = firecrawlApiKey
              ? createWebTools({ enableSearch: true })
              : {};

            const tools = {
              bashExecute: createBashExecuteTool(budget),
              semanticSearch: createSemanticSearchTool(indexingService),
              searchKnowledge: createSearchKnowledgeTool(knowledgeFileService),
              writeKnowledgeFile:
                createWriteKnowledgeFileTool(knowledgeFileService),
              writeTestFile,
              runTest,
              ...webTools,
            };

            // Build initial prompt
            const initialPrompt =
              files.length === 1
                ? PromptFactory.planTestForFile(files[0])
                : PromptFactory.planTestForChangeset(files);

            const messages: Array<{
              role: "user" | "assistant" | "system";
              content: string;
            }> = [];

            if (conversationHistory.length === 0) {
              messages.push({
                role: "user",
                content: initialPrompt,
              });
            } else {
              messages.push(...conversationHistory);
              if (
                conversationHistory[conversationHistory.length - 1]?.role !==
                "user"
              ) {
                messages.push({
                  role: "user",
                  content: initialPrompt,
                });
              }
            }

            // Get AI API key
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

            // Create Anthropic provider for unified agent
            const anthropic = createAnthropicProvider(tokenResult);

            progressCallback?.(
              "analyzing",
              `Analyzing ${files.length} file(s)...`,
            );

            // Track executions
            const executions: Array<{ testId: string; filePath?: string }> = [];

            // Single streamText with all tools available
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
                      content: TEST_AGENT_SYSTEM_PROMPT,
                      providerOptions: {
                        anthropic: {
                          cacheControl: { type: "ephemeral" },
                        },
                      },
                    },
                    ...messages,
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
              catch: (error) =>
                new TestingAgentError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                }),
            });

            // Process stream events
            const eventStream = streamFromAI(streamResult);
            yield* eventStream.pipe(
              Stream.mapError(
                (error) =>
                  new TestingAgentError({
                    message:
                      error instanceof Error ? error.message : "Unknown error",
                    cause: error,
                  }),
              ),
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  // Check for abort signal
                  if (signal?.aborted) {
                    yield* Effect.logDebug(
                      `[TestingAgent:${correlationId}] Abort signal detected, stopping stream`,
                    );
                    return yield* Effect.fail(
                      new TestingAgentError({
                        message: "Operation cancelled by user",
                      }),
                    );
                  }

                  if (event.type === "tool-call") {
                    yield* Effect.logDebug(
                      `[TestingAgent:${correlationId}] Tool call: ${event.toolName}`,
                    );

                    // Send progress for Task component (separate from tool events)
                    if (event.toolName === "semanticSearch") {
                      progressCallback?.(
                        "searching",
                        "Searching codebase for context...",
                      );
                    } else if (event.toolName === "bashExecute") {
                      const args = event.toolArgs as
                        | { command?: string }
                        | undefined;
                      const command = args?.command || "";
                      // Detect what type of bash command is being run
                      if (
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
                        progressCallback?.("executing", "Running command...");
                      }
                    } else if (event.toolName === "writeTestFile") {
                      progressCallback?.("writing", "Writing test file...");
                    } else if (event.toolName === "runTest") {
                      const args = event.toolArgs as
                        | { testType?: string; command?: string }
                        | undefined;
                      const testType = args?.testType || "unknown";
                      progressCallback?.(
                        "running",
                        `Running ${testType} test: ${args?.command || ""}`,
                      );
                    }

                    // Emit structured tool-call event for chat view
                    progressCallback?.(
                      "tool-call",
                      JSON.stringify({
                        type: "tool-call",
                        toolCallId: event.toolCallId,
                        toolName: event.toolName,
                        args: event.toolArgs,
                        state: "input-available",
                      }),
                    );
                  }

                  if (event.type === "text-delta" && event.content) {
                    // Send content streamed event (for UI progress tracking)
                    progressCallback?.(
                      "content_streamed",
                      JSON.stringify({
                        type: "content_streamed",
                        content: event.content,
                      }),
                    );
                  }

                  if (event.type === "thinking" && event.content) {
                    yield* Effect.logDebug(
                      `[TestingAgent:${correlationId}] Thinking event received`,
                    );

                    // Forward reasoning content via progressCallback
                    progressCallback?.(
                      "reasoning",
                      JSON.stringify({
                        type: "reasoning",
                        content: event.content,
                      }),
                    );
                  }

                  if (event.type === "tool-result") {
                    yield* Effect.logDebug(
                      `[TestingAgent:${correlationId}] Tool result: ${event.toolName}`,
                    );

                    // Emit structured tool-result event
                    // Extract actual output from ToolResult object
                    const actualOutput =
                      event.toolResult &&
                      typeof event.toolResult === "object" &&
                      "output" in event.toolResult
                        ? event.toolResult.output
                        : event.toolResult;

                    progressCallback?.(
                      "tool-result",
                      JSON.stringify({
                        type: "tool-result",
                        toolCallId: event.toolCallId,
                        toolName: event.toolName,
                        output: actualOutput,
                        state: "output-available",
                      }),
                    );

                    // Handle tool results for tracking executions
                    if (
                      event.toolName === "writeTestFile" &&
                      event.toolResult
                    ) {
                      const toolResult = event.toolResult as ToolResult<
                        string,
                        unknown,
                        WriteTestFileOutput
                      >;
                      if (toolResult.output?.success) {
                        const output = toolResult.output;
                        executions.push({
                          testId: "unknown", // We don't have direct mapping to proposalId here
                          filePath: output.filePath,
                        });
                      }
                    }
                  }
                }),
              ),
            );

            // Get stream result
            const result = yield* Effect.promise(async () => {
              return await streamResult;
            });

            // Await steps to confirm step count
            const awaitedSteps = yield* Effect.promise(async () => {
              return await result.steps;
            });

            const totalDuration = Date.now() - startTime;
            yield* Effect.logDebug(
              `[TestingAgent:${correlationId}] Steps used: ${awaitedSteps.length}/40`,
            );
            yield* Effect.logDebug(
              `[TestingAgent:${correlationId}] Completed in ${totalDuration}ms. Executions: ${executions.length}`,
            );

            // Return response text
            const responseText = yield* Effect.promise(async () => {
              return (await result.text) || "";
            });

            return {
              executions,
              response: responseText,
            };
          }),
      };
    }),
    // No dependencies - allows test injection via Layer.provide()
  },
) {}

/**
 * Production layer with all dependencies composed.
 * Use this in production code; use TestingAgent.Default in tests with mocked deps.

 * TestingAgent depends on VSCodeService (context-specific), ConfigService, and CodebaseIndexingService.
 * All have context-specific deps in their chain.
 * Use TestingAgent.Default directly - dependencies provided at composition site.
 */
export const TestingAgentLive = TestingAgent.Default;
