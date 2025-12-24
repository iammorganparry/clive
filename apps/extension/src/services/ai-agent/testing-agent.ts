import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import type { ToolResult } from "@ai-sdk/provider-utils";
import { stepCountIs, streamText } from "ai";
import { Data, Effect, Stream } from "effect";
import * as vscode from "vscode";
import { Commands } from "../../constants.js";
import { streamFromAI } from "../../utils/stream-utils.js";
import { AIModels } from "../ai-models.js";
import { createAnthropicProvider } from "../ai-provider-factory.js";
import { CodebaseIndexingService } from "../codebase-indexing-service.js";
import { ConfigService } from "../config-service.js";
import { PlanFileService } from "../plan-file-service.js";
import { APPROVAL } from "./hitl-utils.js";
import { PromptFactory, TEST_AGENT_SYSTEM_PROMPT } from "./prompts.js";
import { makeTokenBudget } from "./token-budget.js";
import {
  createBashExecuteTool,
  createProposeTestTool,
  createSemanticSearchTool,
  createWriteTestFileTool,
} from "./tools/index.js";
import type {
  ProposedTest,
  ProposeTestInput,
  ProposeTestOutput,
  WriteTestFileOutput,
} from "./types.js";

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
      const planFileService = yield* PlanFileService;

      const readPlanFile = (uri: vscode.Uri) =>
        Effect.tryPromise({
          try: () => vscode.workspace.fs.readFile(uri),
          catch: (error) =>
            new TestingAgentError({
              message: `Failed to read plan file: ${error instanceof Error ? error.message : "Unknown error"}`,
              cause: error,
            }),
        });

      const writePlanFile = (uri: vscode.Uri, content: string) =>
        Effect.tryPromise({
          try: async () =>
            vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8")),
          catch: (error) =>
            new TestingAgentError({
              message: `Failed to write plan file: ${error instanceof Error ? error.message : "Unknown error"}`,
              cause: error,
            }),
        });

      const addToolCallIdToFrontmatter = (
        uri: vscode.Uri,
        toolCallId: string,
      ) =>
        Effect.gen(function* () {
          const fileData = yield* readPlanFile(uri);
          const content = Buffer.from(fileData)
            .toString("utf-8")
            .replace(/^---\n/, `---\ntoolCallId: "${toolCallId}"\n`);
          yield* writePlanFile(uri, content);
        });

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
            waitForApproval?: (toolCallId: string) => Promise<unknown>;
            signal?: AbortSignal;
          },
        ) =>
          Effect.gen(function* () {
            const files = Array.isArray(filePaths) ? filePaths : [filePaths];
            const conversationHistory = options?.conversationHistory ?? [];
            const _outputChannel = options?.outputChannel;
            const progressCallback = options?.progressCallback;
            const waitForApproval = options?.waitForApproval;
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

            // Create shared approval registry to track approved proposal IDs
            const approvalRegistry = new Set<string>();

            // Create all tools upfront - writeTestFile will only succeed with approved proposalIds
            const proposeTest = createProposeTestTool(
              waitForApproval
                ? async (toolCallId, input): Promise<boolean> => {
                    // Store input for later use
                    toolCallInputs.set(toolCallId, input);
                    // Wait for approval and convert to boolean
                    const result = await waitForApproval(toolCallId);
                    return (
                      result === APPROVAL.YES ||
                      (typeof result === "object" &&
                        result !== null &&
                        "approved" in result &&
                        result.approved === true)
                    );
                  }
                : undefined,
              approvalRegistry,
            );
            const writeTestFile = createWriteTestFileTool(approvalRegistry);

            const tools = {
              bashExecute: createBashExecuteTool(budget),
              semanticSearch: createSemanticSearchTool(indexingService),
              proposeTest,
              writeTestFile,
            };

            // Build initial prompt
            const initialPrompt =
              files.length === 1
                ? PromptFactory.planTestForFile(files[0])
                : `Analyze these React component files and propose comprehensive Cypress E2E tests:\n${files.map((f) => `- ${f}`).join("\n")}`;

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

            // Track plan files and proposals
            const planFileMap = new Map<string, vscode.Uri>();
            const toolCallIdMap = new Map<string, string>(); // proposalId -> toolCallId
            const toolCallToProposalId = new Map<string, string>(); // toolCallId -> proposalId (for early plan file creation)
            const toolCallInputs = new Map<string, ProposeTestInput>(); // toolCallId -> input
            const subscriptionId = `sub-${Date.now()}-${Math.random().toString(36).substring(7)}`;
            const proposals: ProposedTest[] = [];
            const executions: Array<{ testId: string; filePath?: string }> = [];

            // Single streamText with all tools available
            const streamResult = yield* Effect.try({
              try: () =>
                streamText({
                  model: anthropic(AIModels.anthropic.testing),
                  tools,
                  maxRetries: 0,
                  stopWhen: stepCountIs(20),
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
                    } else if (event.toolName === "proposeTest") {
                      progressCallback?.(
                        "proposing",
                        "Generating test proposal...",
                      );
                    } else if (event.toolName === "writeTestFile") {
                      progressCallback?.("writing", "Writing test file...");
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

                    // Create plan file immediately when proposeTest is called
                    // This allows users to review the plan before approving
                    if (event.toolCallId && event.toolArgs) {
                      const args = event.toolArgs as ProposeTestInput;
                      const proposalId = `${args.sourceFile}-${Date.now()}`;
                      toolCallToProposalId.set(event.toolCallId, proposalId);
                      toolCallInputs.set(event.toolCallId, args);

                      // Create plan file asynchronously (don't block stream)
                      yield* Effect.gen(function* () {
                        const planUri = yield* planFileService
                          .createPlanFile(args.sourceFile, {
                            proposalId,
                            subscriptionId,
                            targetTestPath:
                              args.testStrategies[0]?.targetTestPath || "",
                            status: "pending",
                          })
                          .pipe(
                            Effect.catchAll((error) =>
                              Effect.gen(function* () {
                                yield* Effect.logDebug(
                                  `[TestingAgent:${correlationId}] Failed to create plan file: ${error.message}`,
                                );
                                return yield* Effect.fail(error);
                              }),
                            ),
                          );

                        // Update plan file frontmatter with toolCallId
                        if (event.toolCallId) {
                          yield* addToolCallIdToFrontmatter(
                            planUri,
                            event.toolCallId,
                          );
                          // Refresh CodeLens to show approve/reject buttons
                          yield* Effect.tryPromise({
                            try: () =>
                              vscode.commands.executeCommand(
                                Commands.refreshCodeLens,
                              ),
                            catch: (error) =>
                              new TestingAgentError({
                                message: `Failed to refresh CodeLens: ${error instanceof Error ? error.message : "Unknown error"}`,
                                cause: error,
                              }),
                          });
                        }

                        // Open plan file in editor
                        yield* planFileService.openPlanFile(planUri).pipe(
                          Effect.catchAll((error) =>
                            Effect.gen(function* () {
                              yield* Effect.logDebug(
                                `[TestingAgent:${correlationId}] Failed to open plan file: ${error.message}`,
                              );
                              return Effect.void;
                            }),
                          ),
                        );

                        planFileMap.set(proposalId, planUri);

                        // Send plan file created event
                        progressCallback?.(
                          "plan_file_created",
                          JSON.stringify({
                            type: "plan_file_created",
                            planFilePath: vscode.workspace.asRelativePath(
                              planUri,
                              false,
                            ),
                            proposalId,
                            subscriptionId,
                          }),
                        );

                        yield* Effect.logDebug(
                          `[TestingAgent:${correlationId}] Created plan file early: ${vscode.workspace.asRelativePath(planUri, false)}`,
                        );
                      }).pipe(
                        Effect.catchAll((error) =>
                          Effect.gen(function* () {
                            yield* Effect.logDebug(
                              `[TestingAgent:${correlationId}] Error creating plan file early: ${error.message}`,
                            );
                            // Don't fail the stream - continue processing
                            return Effect.void;
                          }),
                        ),
                      );
                    }
                  }

                  if (event.type === "text-delta" && event.content) {
                    // Stream text to plan files in real-time as content is generated
                    for (const [, planUri] of planFileMap.entries()) {
                      yield* planFileService
                        .appendContent(planUri, event.content)
                        .pipe(
                          Effect.catchAll((error) =>
                            Effect.gen(function* () {
                              yield* Effect.logDebug(
                                `[TestingAgent:${correlationId}] Failed to stream text to plan file: ${error.message}`,
                              );
                              return Effect.void;
                            }),
                          ),
                        );
                    }

                    // Send content streamed event (for UI progress tracking)
                    progressCallback?.(
                      "content_streamed",
                      JSON.stringify({
                        type: "content_streamed",
                        content: event.content,
                      }),
                    );
                  }

                  if (event.type === "tool-result") {
                    yield* Effect.logDebug(
                      `[TestingAgent:${correlationId}] Tool result: ${event.toolName}`,
                    );

                    // Emit structured tool-result event
                    progressCallback?.(
                      "tool-result",
                      JSON.stringify({
                        type: "tool-result",
                        toolCallId: event.toolCallId,
                        toolName: event.toolName,
                        output: event.toolResult,
                        state: "output-available",
                      }),
                    );

                    // Handle tool results for tracking proposals and executions
                    if (event.toolName === "proposeTest" && event.toolResult) {
                      const toolResult = event.toolResult as ToolResult<
                        string,
                        unknown,
                        ProposeTestOutput
                      >;
                      if (toolResult.output?.success) {
                        const output = toolResult.output;
                        const toolCallId = toolResult.toolCallId;
                        const earlyProposalId =
                          toolCallToProposalId.get(toolCallId);
                        const proposalId = earlyProposalId || output.id;

                        // Get args from stored inputs
                        const args = toolCallInputs.get(toolCallId);
                        if (args) {
                          const primaryStrategy = args.testStrategies[0];
                          const proposal: ProposedTest = {
                            id: proposalId,
                            sourceFile: args.sourceFile,
                            targetTestPath:
                              primaryStrategy?.targetTestPath ?? "",
                            description: primaryStrategy?.description ?? "",
                            isUpdate: primaryStrategy?.isUpdate ?? false,
                            testType: primaryStrategy?.testType ?? "unit",
                            framework: primaryStrategy?.framework ?? "",
                            testStrategies: args.testStrategies,
                            proposedContent: "",
                            navigationPath: primaryStrategy?.navigationPath,
                            pageContext: primaryStrategy?.pageContext,
                            prerequisites: primaryStrategy?.prerequisites,
                            relatedTests: args.relatedTests,
                            userFlow: primaryStrategy?.userFlow,
                            testCases: primaryStrategy?.testCases,
                          };
                          proposals.push(proposal);

                          // Emit proposal event to webview
                          progressCallback?.(
                            "proposal",
                            JSON.stringify({
                              type: "proposal",
                              test: proposal,
                              toolCallId,
                            }),
                          );

                          toolCallIdMap.set(proposalId, toolCallId);

                          // Check if plan file was created early
                          const planUri = earlyProposalId
                            ? planFileMap.get(earlyProposalId)
                            : undefined;

                          if (planUri) {
                            // Plan file already exists - update mapping to use proposalId
                            planFileMap.set(proposalId, planUri);
                            yield* Effect.logDebug(
                              `[TestingAgent:${correlationId}] Plan file already exists for proposal: ${proposalId}`,
                            );
                          }
                        }
                      }
                    } else if (
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

            const totalDuration = Date.now() - startTime;
            yield* Effect.logDebug(
              `[TestingAgent:${correlationId}] Completed in ${totalDuration}ms. Proposals: ${proposals.length}, Executions: ${executions.length}`,
            );

            // Return response text
            const responseText = yield* Effect.promise(async () => {
              return (await result.text) || "";
            });

            return {
              proposals,
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
