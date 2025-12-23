import type { ToolCall, ToolResult } from "@ai-sdk/provider-utils";
import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import { stepCountIs, streamText } from "ai";
import { Data, Effect, Layer, Match, Stream } from "effect";
import vscode from "vscode";
import { ConfigService } from "../config-service.js";
import { SecretStorageService, VSCodeService } from "../vs-code.js";
import { CodebaseIndexingService } from "../codebase-indexing-service.js";
import { AIModels } from "../ai-models.js";
import { createAnthropicProvider } from "../ai-provider-factory.js";
import {
  CYPRESS_CONTENT_GENERATION_SYSTEM_PROMPT,
  CYPRESS_EXECUTION_SYSTEM_PROMPT,
  CYPRESS_PLANNING_SYSTEM_PROMPT,
  PromptFactory,
} from "./prompts.js";
import { streamFromAI } from "../../utils/stream-utils.js";
import {
  createBashExecuteTool,
  createSemanticSearchTool,
  createProposeTestTool,
  proposeTestTool,
  createWriteTestFileTool,
  writeTestFileTool,
} from "./tools/index.js";
import { APPROVAL } from "./hitl-utils.js";
import { makeTokenBudget } from "./token-budget.js";
import { PlanFileService } from "../plan-file-service.js";
import type {
  ExecuteTestInput,
  ExecuteTestOutput,
  ProposedTest,
  ProposeTestInput,
  ProposeTestOutput,
  TestGenerationPlan,
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
      const vscodeService = yield* VSCodeService;
      const indexingService = yield* CodebaseIndexingService;
      const planFileService = yield* PlanFileService;

      /**
       * Read existing test file content if it exists
       */
      const readExistingContent = (
        targetTestPath: string,
      ): Effect.Effect<string | undefined, never> =>
        Effect.gen(function* () {
          const workspaceFolders = vscodeService.workspace.workspaceFolders;
          if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
          }

          const workspaceRoot = workspaceFolders[0].uri;
          const fileUri = vscode.Uri.joinPath(workspaceRoot, targetTestPath);

          return yield* Effect.tryPromise({
            try: async () => {
              const fileData =
                await vscodeService.workspace.fs.readFile(fileUri);
              return Buffer.from(fileData).toString("utf-8");
            },
            catch: () => undefined as string | undefined, // File doesn't exist, that's okay
          }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
        });

      /**
       * Extract test content from AI text response
       * During planning phase, we capture content from the AI's text output, not from file writes
       */
      const extractTestContent = <T extends { text: Promise<string> | string }>(
        result: T,
        test: ProposedTest,
      ): Effect.Effect<string, never> =>
        Effect.gen(function* () {
          // Extract content from AI text response
          const text = yield* Effect.promise(async () => {
            if (typeof result.text === "string") {
              return result.text;
            }
            return await result.text;
          });

          // Look for code blocks in the response (markdown format)
          const codeBlockRegex =
            /```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/g;
          const matches = Array.from(text.matchAll(codeBlockRegex));

          if (matches.length > 0) {
            // Use the last code block (most likely the final test file)
            const content = matches[matches.length - 1][1];
            if (content && content.trim().length > 0) {
              return content.trim();
            }
          }

          // If no code blocks found, try to extract content after common markers
          const markers = [
            /test content:\s*\n([\s\S]*)/i,
            /cypress test:\s*\n([\s\S]*)/i,
            /```([\s\S]*?)```/,
          ];

          for (const marker of markers) {
            const match = text.match(marker);
            if (match?.[1]?.trim().length) {
              return match[1].trim();
            }
          }

          // Fallback: return the full text if it looks like test code
          if (
            text.includes("cy.") ||
            text.includes("describe(") ||
            text.includes("it(")
          ) {
            return text.trim();
          }

          // Final fallback
          return `// Test content generation in progress...\n// Target: ${test.targetTestPath}\n// Description: ${test.description}\n\n// Please review the AI response for the test content.`;
        });

      /**
       * Generate test content for a proposed test without writing it
       * Returns both proposed content and existing content (if update)
       */
      const generateTestContent = (
        test: ProposedTest,
        _outputChannel?: vscode.OutputChannel,
      ) =>
        Effect.gen(function* () {
          const correlationId = `content-gen-${Date.now()}-${Math.random().toString(36).substring(7)}`;
          const startTime = Date.now();

          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Starting content generation for test: ${test.id}`,
          );
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Test details: sourceFile=${test.sourceFile}, targetPath=${test.targetTestPath}, isUpdate=${test.isUpdate}`,
          );

          // Read existing content if this is an update
          let existingContent: string | undefined;
          if (test.isUpdate) {
            yield* Effect.logDebug(
              `[PlanningAgent:${correlationId}] Reading existing test file: ${test.targetTestPath}`,
            );
            const readStartTime = Date.now();
            existingContent = yield* readExistingContent(
              test.targetTestPath,
            ).pipe(Effect.provide(VSCodeService.Default));
            const readDuration = Date.now() - readStartTime;
            yield* Effect.logDebug(
              `[PlanningAgent:${correlationId}] Read existing content in ${readDuration}ms (${existingContent?.length || 0} chars)`,
            );
          }

          // Create fresh budget for content generation phase
          const contentBudget = yield* makeTokenBudget();

          // Create tool set for content generation (budget-aware)
          // NOTE: NO writeTestFile - this is planning phase, we only generate content preview
          const tools = {
            bashExecute: createBashExecuteTool(contentBudget),
            // Semantic search for finding related code patterns
            semanticSearch: createSemanticSearchTool(indexingService),
          };

          // Build prompt for content generation with E2E metadata
          const prompt = PromptFactory.writeTestFile({
            sourceFile: test.sourceFile,
            targetTestPath: test.targetTestPath,
            description: test.description,
            isUpdate: test.isUpdate,
            navigationPath: test.navigationPath,
            prerequisites: test.prerequisites,
            userFlow: test.userFlow,
          });

          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Prompt length: ${prompt.length} chars`,
          );

          const tokenStartTime = Date.now();
          const tokenResult = yield* configService.getAiApiKey().pipe(
            Effect.mapError(
              (error) =>
                new ConfigurationError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                }),
            ),
          );
          const tokenDuration = Date.now() - tokenStartTime;
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Retrieved AI token in ${tokenDuration}ms (gateway: ${tokenResult.isGateway})`,
          );

          if (!tokenResult.token) {
            yield* Effect.logDebug(
              `[PlanningAgent:${correlationId}] ERROR: AI token not available`,
            );
            return yield* Effect.fail(
              new ConfigurationError({
                message:
                  "AI token not available. Please log in or provide API key.",
              }),
            );
          }

          const anthropic = createAnthropicProvider(tokenResult);

          // Generate text using AI SDK
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Calling AI model (${AIModels.anthropic.testing}) for content generation...`,
          );
          const aiStartTime = Date.now();
          const streamResult = yield* Effect.try({
            try: () =>
              streamText({
                model: anthropic(AIModels.anthropic.testing),
                tools,
                maxRetries: 0,
                stopWhen: stepCountIs(20),
                // System prompt with cache control for cost optimization
                messages: [
                  {
                    role: "system",
                    content: CYPRESS_CONTENT_GENERATION_SYSTEM_PROMPT,
                    providerOptions: {
                      anthropic: { cacheControl: { type: "ephemeral" } },
                    },
                  },
                  {
                    role: "user",
                    content: prompt,
                  },
                ],
                // Enable extended thinking for test content generation (lower budget than planning)
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

          // Process stream for real-time feedback (content generation is typically fast, so minimal streaming)
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
                const effect = Match.value(event.type).pipe(
                  Match.when("text-delta", () => {
                    return Effect.gen(function* () {
                      if (event.content) {
                        yield* Effect.logDebug(
                          `[PlanningAgent:${correlationId}] Content generation text: ${event.content}`,
                        );
                      }
                    });
                  }),
                  Match.when("tool-call", () => {
                    return Effect.gen(function* () {
                      yield* Effect.logDebug(
                        `[PlanningAgent:${correlationId}] Content generation tool call: ${event.toolName}`,
                      );
                      if (event.toolArgs) {
                        yield* Effect.logDebug(
                          `[PlanningAgent:${correlationId}]   Tool args: ${JSON.stringify(event.toolArgs, null, 2)}`,
                        );
                      }
                    });
                  }),
                  Match.when("tool-result", () => {
                    return Effect.gen(function* () {
                      yield* Effect.logDebug(
                        `[PlanningAgent:${correlationId}] Content generation tool result: ${event.toolName}`,
                      );
                      if (event.toolResult) {
                        const resultStr =
                          typeof event.toolResult === "string"
                            ? event.toolResult
                            : JSON.stringify(event.toolResult, null, 2);
                        // Truncate very long results for readability
                        const truncated =
                          resultStr.length > 500
                            ? `${resultStr.substring(0, 500)}... (truncated)`
                            : resultStr;
                        yield* Effect.logDebug(
                          `[PlanningAgent:${correlationId}]   Tool result: ${truncated}`,
                        );
                      }
                    });
                  }),
                  Match.when("finish", () => {
                    return Effect.logDebug(
                      `[PlanningAgent:${correlationId}] Content generation stream finished`,
                    );
                  }),
                  Match.orElse(() => Effect.void),
                );
                return yield* effect;
              }),
            ),
          );

          // Get final result for extraction
          const result = yield* Effect.promise(async () => {
            return await streamResult;
          });
          const aiDuration = Date.now() - aiStartTime;

          // Await steps and text before using them
          const awaitedResult = yield* Effect.promise(async () => {
            const steps = await result.steps;
            const text = await result.text;
            return { ...result, steps, text };
          });

          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] AI model completed in ${aiDuration}ms. Steps: ${awaitedResult.steps.length}`,
          );

          // Log tool call details
          for (let i = 0; i < awaitedResult.steps.length; i++) {
            const step = awaitedResult.steps[i];
            const toolCalls = step.toolCalls || [];
            const toolResults = step.toolResults || [];
            yield* Effect.logDebug(
              `[PlanningAgent:${correlationId}] Step ${i + 1}: ${toolCalls.length} tool call(s), ${toolResults.length} result(s)`,
            );
            for (let idx = 0; idx < toolCalls.length; idx++) {
              const call = toolCalls[idx];
              const toolCall = call as { toolName?: string; args?: unknown };
              yield* Effect.logDebug(
                `[PlanningAgent:${correlationId}]   Tool call ${idx + 1}: ${toolCall.toolName || "unknown"}`,
              );
              if (toolCall.args) {
                yield* Effect.logDebug(
                  `[PlanningAgent:${correlationId}]     Args: ${JSON.stringify(toolCall.args, null, 2)}`,
                );
              }
            }
          }

          // Extract test content from AI text response
          yield* Effect.logDebug(
            `[TestingAgent:${correlationId}] Extracting test content from AI response...`,
          );
          const extractStartTime = Date.now();
          const proposedContent = yield* extractTestContent(
            { text: awaitedResult.text },
            test,
          );
          const extractDuration = Date.now() - extractStartTime;

          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Extracted test content in ${extractDuration}ms (${proposedContent.length} chars)`,
          );

          const totalDuration = Date.now() - startTime;
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Content generation completed in ${totalDuration}ms total`,
          );

          return {
            proposedContent,
            ...(existingContent !== undefined && { existingContent }),
          };
        }).pipe(
          Effect.provide(
            Layer.merge(ConfigService.Default, SecretStorageService.Default),
          ),
        );

      /**
       * Extract ProposedTest objects from tool results
       */
      const extractProposedTests = <
        T extends {
          steps: Array<{
            toolResults: Array<unknown>;
            toolCalls: Array<unknown>;
          }>;
        },
      >(
        result: T,
      ): Effect.Effect<ProposedTest[], never> =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[PlanningAgent] Extracting proposed tests from ${result.steps.length} step(s)`,
          );
          const proposedTests: ProposedTest[] = [];
          const proposeResults = result.steps
            .flatMap((step) => step.toolResults)
            .filter(
              (
                toolResult,
              ): toolResult is ToolResult<string, unknown, unknown> =>
                (toolResult as ToolResult<string, unknown, unknown>)
                  .toolName === "proposeTest",
            );

          yield* Effect.logDebug(
            `[PlanningAgent] Found ${proposeResults.length} proposeTest tool result(s)`,
          );

          for (const toolResult of proposeResults) {
            const toolOutput = toolResult.output;
            if (toolOutput) {
              const isProposeTestOutput = (
                value: unknown,
              ): value is ProposeTestOutput => {
                return (
                  typeof value === "object" &&
                  value !== null &&
                  "success" in value &&
                  "id" in value &&
                  "message" in value &&
                  typeof (value as ProposeTestOutput).success === "boolean"
                );
              };

              if (isProposeTestOutput(toolOutput) && toolOutput.success) {
                // Extract input from tool call to build ProposedTest
                const toolCall = result.steps
                  .flatMap((step) => step.toolCalls)
                  .find((call) => {
                    const typedCall = call as ToolCall<string, unknown>;
                    return typedCall.toolCallId === toolResult.toolCallId;
                  });

                if (toolCall) {
                  const typedCall = toolCall as ToolCall<string, unknown>;
                  const args = typedCall.input as {
                    sourceFile: string;
                    targetTestPath: string;
                    description: string;
                    isUpdate: boolean;
                    navigationPath?: string;
                    pageContext?: string;
                    prerequisites?: string[];
                    relatedTests?: string[];
                    userFlow?: string;
                    testCases?: ProposedTest["testCases"];
                  };

                  const testProposal = {
                    id: toolOutput.id,
                    sourceFile: args.sourceFile,
                    targetTestPath: args.targetTestPath,
                    description: args.description,
                    isUpdate: args.isUpdate,
                    proposedContent: "", // Will be populated during content generation
                    existingContent: undefined, // Will be populated during content generation if update
                    // E2E fields
                    navigationPath: args.navigationPath,
                    pageContext: args.pageContext,
                    prerequisites: args.prerequisites,
                    relatedTests: args.relatedTests,
                    userFlow: args.userFlow,
                    testCases: args.testCases,
                  };
                  proposedTests.push(testProposal);

                  yield* Effect.logDebug(
                    `[PlanningAgent] Extracted test proposal: ${toolOutput.id} for ${args.sourceFile} -> ${args.targetTestPath}`,
                  );
                }
              }
            }
          }

          yield* Effect.logDebug(
            `[PlanningAgent] Successfully extracted ${proposedTests.length} test proposal(s)`,
          );
          return proposedTests;
        });

      /**
       * Internal helper: Plan tests for a single file
       * This is the core planning logic extracted for reuse
       */
      const planTestForSingleFile = (
        filePath: string,
        conversationHistory: Array<{
          role: "user" | "assistant" | "system";
          content: string;
        }>,
        outputChannel?: vscode.OutputChannel,
        progressCallback?: (status: string, message: string) => void,
      ) =>
        Effect.gen(function* () {
          const correlationId = `plan-${Date.now()}-${Math.random().toString(36).substring(7)}`;
          const startTime = Date.now();

          const sendProgress = (status: string, message: string) => {
            if (progressCallback) {
              progressCallback(status, message);
            }
          };

          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] ========== Starting test planning for single file ==========`,
          );
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] File to analyze: ${filePath}`,
          );
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Conversation history: ${conversationHistory.length} message(s)`,
          );

          sendProgress("planning", `Planning tests for ${filePath}...`);

          // Check configuration first
          const configStartTime = Date.now();
          const configured = yield* configService.isConfigured();
          const configDuration = Date.now() - configStartTime;
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Configuration check completed in ${configDuration}ms: ${configured ? "configured" : "not configured"}`,
          );

          if (!configured) {
            yield* Effect.logDebug(
              `[PlanningAgent:${correlationId}] ERROR: Not configured, aborting`,
            );
            return yield* Effect.fail(
              new ConfigurationError({
                message:
                  "AI Gateway token not available. Please log in to authenticate.",
              }),
            );
          }

          // Create fresh per-request token budget
          const budgetStartTime = Date.now();
          const budget = yield* makeTokenBudget();
          const initialRemaining = yield* budget.remaining();
          const initialMaxBudget = yield* budget.getMaxBudget();
          const budgetDuration = Date.now() - budgetStartTime;
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Created token budget in ${budgetDuration}ms: ${initialRemaining}/${initialMaxBudget} tokens available`,
          );

          // Create tools: bash + semantic search + proposeTest
          const tools = {
            // Bash tool for file system operations
            bashExecute: createBashExecuteTool(budget),
            // Semantic search for finding related code patterns and existing tests
            semanticSearch: createSemanticSearchTool(indexingService),
            // Output tool for proposing tests
            proposeTest: proposeTestTool,
          };

          // Build initial prompt for this single file
          const initialPrompt = PromptFactory.planTestForFile(filePath);

          // Convert conversation history to AI SDK message format
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
            // Include conversation history
            messages.push(...conversationHistory);
            // If the last message is from user, we're continuing the conversation
            // Otherwise, add the initial prompt as context
            if (
              conversationHistory[conversationHistory.length - 1]?.role ===
              "user"
            ) {
              // User just sent a message, continue conversation
            } else {
              // Add initial prompt as context for new user message
              messages.push({
                role: "user",
                content: initialPrompt,
              });
            }
          }

          // Get AI API key (user-provided or gateway token)
          const tokenStartTime = Date.now();
          const tokenResult = yield* configService.getAiApiKey().pipe(
            Effect.mapError(
              (error) =>
                new ConfigurationError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                }),
            ),
          );
          const tokenDuration = Date.now() - tokenStartTime;
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Retrieved AI token in ${tokenDuration}ms (gateway: ${tokenResult.isGateway})`,
          );

          if (!tokenResult.token) {
            yield* Effect.logDebug(
              `[PlanningAgent:${correlationId}] ERROR: AI token not available`,
            );
            return yield* Effect.fail(
              new ConfigurationError({
                message:
                  "AI token not available. Please log in or provide API key.",
              }),
            );
          }

          // Create Anthropic provider (direct or gateway)
          const anthropic = createAnthropicProvider(tokenResult);

          // Generate text using AI SDK
          sendProgress("analyzing", `Analyzing ${filePath} with AI model...`);
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Calling AI model (${AIModels.anthropic.testing}) for file: ${filePath}`,
          );
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Mode: ${conversationHistory.length > 0 ? "conversation continuation" : "initial planning"}`,
          );
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Initial prompt length: ${initialPrompt.length} chars`,
          );

          const aiStartTime = Date.now();
          if (conversationHistory.length > 0) {
            yield* Effect.logDebug(
              `[PlanningAgent:${correlationId}] Using conversation history with ${messages.length} message(s)`,
            );
          } else {
            yield* Effect.logDebug(
              `[PlanningAgent:${correlationId}] Using initial prompt`,
            );
          }

          // Create streamText result (synchronous call, returns StreamTextResult)
          const streamResult = yield* Effect.try({
            try: () => {
              // Use messages for conversation continuation
              return streamText({
                model: anthropic(AIModels.anthropic.testing),
                tools,
                maxRetries: 0,
                stopWhen: stepCountIs(20),
                // System prompt with cache control, followed by conversation messages
                messages: [
                  {
                    role: "system" as const,
                    content: CYPRESS_PLANNING_SYSTEM_PROMPT,
                    providerOptions: {
                      anthropic: {
                        cacheControl: { type: "ephemeral" },
                      },
                    },
                  },
                  ...messages,
                ],
                // Enable extended thinking for complex test planning
                providerOptions: {
                  anthropic: {
                    thinking: { type: "enabled", budgetTokens: 10000 },
                  } satisfies AnthropicProviderOptions,
                },
                headers: {
                  "anthropic-beta": "interleaved-thinking-2025-05-14",
                },
              });
            },
            catch: (error) =>
              new TestingAgentError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          // Convert to Effect Stream and process events in real-time
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
                const effect = Match.value(event.type).pipe(
                  Match.when("tool-call", () => {
                    const toolName = event.toolName || "unknown";
                    return Effect.gen(function* () {
                      yield* Effect.logDebug(
                        `[PlanningAgent:${correlationId}] Tool call: ${toolName}`,
                      );

                      // Send progress update for tool calls using Match
                      Match.value(toolName).pipe(
                        Match.when("bashExecute", () => {
                          const args = event.toolArgs as
                            | { command?: string }
                            | undefined;
                          const command = args?.command || "unknown";
                          // Extract first word of command for display
                          const firstWord =
                            command.split(/\s+/)[0] || "command";
                          sendProgress("analyzing", `Running ${firstWord}...`);
                        }),
                        Match.when("proposeTest", () => {
                          sendProgress(
                            "analyzing",
                            "Proposing test structure...",
                          );
                        }),
                        Match.orElse(() => {
                          // Unknown tool name - no progress update
                        }),
                      );
                    });
                  }),
                  Match.when("text-delta", () => {
                    return Effect.gen(function* () {
                      if (event.content) {
                        // Log AI's streaming text response
                        yield* Effect.logDebug(
                          `[PlanningAgent:${correlationId}] AI text: ${event.content}`,
                        );
                        // Stream text deltas to UI for real-time feedback
                        sendProgress("analyzing", event.content);
                      }
                    });
                  }),
                  Match.when("tool-result", () => {
                    return Effect.gen(function* () {
                      yield* Effect.logDebug(
                        `[PlanningAgent:${correlationId}] Tool result: ${event.toolName}`,
                      );
                      if (event.toolResult) {
                        const resultStr =
                          typeof event.toolResult === "string"
                            ? event.toolResult
                            : JSON.stringify(event.toolResult, null, 2);
                        // Truncate very long results for readability
                        const truncated =
                          resultStr.length > 500
                            ? `${resultStr.substring(0, 500)}... (truncated)`
                            : resultStr;
                        yield* Effect.logDebug(
                          `[PlanningAgent:${correlationId}]   Result: ${truncated}`,
                        );
                      }
                    });
                  }),
                  Match.when("step-finish", () => {
                    return Effect.logDebug(
                      `[PlanningAgent:${correlationId}] Step ${event.stepIndex || "unknown"} finished`,
                    );
                  }),
                  Match.when("finish", () => {
                    return Effect.logDebug(
                      `[PlanningAgent:${correlationId}] Planning stream finished`,
                    );
                  }),
                  Match.orElse(() => {
                    // Other event types - no action needed
                    return Effect.void;
                  }),
                );
                yield* effect;
              }),
            ),
          );

          // Get final result for extraction (await after stream processing)
          const result = yield* Effect.promise(async () => {
            // StreamTextResult is thenable, so we can await it
            return await streamResult;
          });
          const aiDuration = Date.now() - aiStartTime;

          // Await steps before using them
          const awaitedSteps = yield* Effect.promise(async () => {
            return await result.steps;
          });

          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] AI model completed in ${aiDuration}ms. Steps: ${awaitedSteps.length}`,
          );

          // Log step details (progress updates are now handled in stream processing)
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Step breakdown:`,
          );
          for (let idx = 0; idx < awaitedSteps.length; idx++) {
            const step = awaitedSteps[idx];
            const toolCalls = step.toolCalls || [];
            const toolResults = step.toolResults || [];
            yield* Effect.logDebug(
              `[PlanningAgent:${correlationId}]   Step ${idx + 1}: ${toolCalls.length} tool call(s), ${toolResults.length} result(s)`,
            );
            for (let callIdx = 0; callIdx < toolCalls.length; callIdx++) {
              const call = toolCalls[callIdx];
              const toolCall = call as {
                toolName?: string;
                args?: unknown;
              };
              const toolName = toolCall.toolName || "unknown";
              yield* Effect.logDebug(
                `[PlanningAgent:${correlationId}] Tool call ${callIdx + 1}: ${toolName}`,
              );

              if (toolCall.args) {
                yield* Effect.logDebug(
                  `[PlanningAgent:${correlationId}] Args: ${JSON.stringify(toolCall.args, null, 2)}`,
                );
              }
            }
            for (
              let resultIdx = 0;
              resultIdx < toolResults.length;
              resultIdx++
            ) {
              const toolResult = toolResults[resultIdx] as {
                toolName?: string;
                result?: unknown;
              };
              yield* Effect.logDebug(
                `[PlanningAgent:${correlationId}] Tool result ${resultIdx + 1}: ${toolResult.toolName || "unknown"}`,
              );
              if (toolResult.result) {
                const resultStr = JSON.stringify(toolResult.result, null, 2);
                yield* Effect.logDebug(
                  `[PlanningAgent:${correlationId}] Result: ${resultStr.substring(0, 500)}${resultStr.length > 500 ? "..." : ""}`,
                );
              }
            }
          }

          // Extract ProposedTest objects from tool results
          const proposedTests = yield* extractProposedTests({
            ...result,
            steps: awaitedSteps,
          });

          yield* Effect.logDebug(
            `[PlanningAgent] Proposed ${proposedTests.length} test file(s) for ${filePath}`,
          );

          // Log proposed test details
          for (const test of proposedTests) {
            yield* Effect.logDebug(
              `[PlanningAgent] Proposed test: ${test.id} - ${test.targetTestPath} (${test.isUpdate ? "update" : "new"})`,
            );
          }

          // Generate test content for each proposed test
          sendProgress(
            "generating_content",
            `Generating test content for ${proposedTests.length} test(s)...`,
          );
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Generating content for ${proposedTests.length} proposed test(s)...`,
          );
          const testsWithContent: ProposedTest[] = [];
          for (let i = 0; i < proposedTests.length; i++) {
            const test = proposedTests[i];
            sendProgress(
              "generating_content",
              `Generating content for test ${i + 1}/${proposedTests.length}: ${test.targetTestPath}...`,
            );
            yield* Effect.logDebug(
              `[PlanningAgent:${correlationId}] Generating content for test ${i + 1}/${proposedTests.length}: ${test.targetTestPath}`,
            );

            const contentStartTime = Date.now();
            const contentResult = yield* generateTestContent(
              test,
              outputChannel,
            ).pipe(
              Effect.catchTags({
                ConfigurationError: (error: ConfigurationError) =>
                  Effect.gen(function* () {
                    yield* Effect.logDebug(
                      `[TestingAgent] Failed to generate content for ${test.targetTestPath}: ${error.message}`,
                    );
                    return {
                      proposedContent: `// Failed to generate content: ${error.message}`,
                      existingContent: undefined,
                    };
                  }),
                TestingAgentError: (error: TestingAgentError) =>
                  Effect.gen(function* () {
                    yield* Effect.logDebug(
                      `[TestingAgent] Failed to generate content for ${test.targetTestPath}: ${error.message}`,
                    );
                    return {
                      proposedContent: `// Failed to generate content: ${error.message}`,
                      existingContent: undefined,
                    };
                  }),
              }),
            );

            const contentDuration = Date.now() - contentStartTime;
            yield* Effect.logDebug(
              `[PlanningAgent:${correlationId}] Generated content for ${test.targetTestPath} in ${contentDuration}ms (${contentResult.proposedContent.length} chars)`,
            );

            testsWithContent.push({
              ...test,
              proposedContent: contentResult.proposedContent,
              existingContent: contentResult.existingContent,
            });
          }

          // Log final budget consumption
          const consumed = yield* budget.getConsumed();
          const remaining = yield* budget.remaining();
          const maxBudget = yield* budget.getMaxBudget();
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Token budget: ${consumed}/${maxBudget} consumed, ${remaining} remaining`,
          );

          const totalDuration = Date.now() - startTime;
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] ========== Planning complete in ${totalDuration}ms ==========`,
          );
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Generated ${testsWithContent.length} test(s) with content`,
          );

          // Extract the assistant's response text (await the Promise)
          const assistantResponse = yield* Effect.promise(async () => {
            return (await result.text) || "";
          });

          return {
            tests: testsWithContent,
            response: assistantResponse,
          } as TestGenerationPlan & { response: string };
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
         * Plan and execute tests with human-in-the-loop approval
         * Uses a single streamText call that pauses for user approval on each proposal
         * Yields proposals to the client, waits for approval, then writes approved tests
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
            const outputChannel = options?.outputChannel;
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

            // Create proposeTest tool with approval callback and registry
            const proposeTest = createProposeTestTool(
              waitForApproval
                ? async (toolCallId: string, input: ProposeTestInput) => {
                    // Use pre-generated proposalId from stream processing (plan file already created)
                    // If not found (shouldn't happen), generate one as fallback
                    const proposalId =
                      toolCallToProposalId.get(toolCallId) ||
                      `${input.sourceFile}-${input.targetTestPath}-${Date.now()}`;

                    // Yield proposal to client via progress callback
                    // Include id and proposedContent (empty for now) to satisfy schema
                    progressCallback?.(
                      "proposal",
                      JSON.stringify({
                        type: "proposal",
                        toolCallId,
                        test: {
                          id: proposalId,
                          sourceFile: input.sourceFile,
                          targetTestPath: input.targetTestPath,
                          description: input.description,
                          isUpdate: input.isUpdate,
                          proposedContent: "", // Content generated later
                          navigationPath: input.navigationPath,
                          pageContext: input.pageContext,
                          prerequisites: input.prerequisites,
                          relatedTests: input.relatedTests,
                          userFlow: input.userFlow,
                          testCases: input.testCases,
                        },
                      }),
                    );

                    // Wait for approval
                    const approval = await waitForApproval(toolCallId);
                    return (
                      approval === APPROVAL.YES ||
                      (typeof approval === "object" &&
                        approval !== null &&
                        "approved" in approval &&
                        approval.approved === true)
                    );
                  }
                : undefined,
              approvalRegistry,
            );

            // Phase 1: Planning tools - ONLY proposeTest (no writeTestFile)
            // This forces the AI to propose first before any file writing
            const planningTools = {
              bashExecute: createBashExecuteTool(budget),
              semanticSearch: createSemanticSearchTool(indexingService),
              proposeTest,
              // NO writeTestFile here - it will be added in Phase 2 after approval
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

            const anthropic = createAnthropicProvider(tokenResult);

            progressCallback?.(
              "analyzing",
              `Analyzing ${files.length} file(s)...`,
            );

            // Phase 1: Planning streamText - only proposeTest tool available
            const planningStreamResult = yield* Effect.try({
              try: () =>
                streamText({
                  model: anthropic(AIModels.anthropic.testing),
                  tools: planningTools,
                  maxRetries: 0,
                  stopWhen: stepCountIs(20),
                  abortSignal: signal,
                  messages: [
                    {
                      role: "system" as const,
                      content: CYPRESS_PLANNING_SYSTEM_PROMPT,
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
                      thinking: { type: "enabled", budgetTokens: 10000 },
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

            // Track plan files
            const planFileMap = new Map<string, vscode.Uri>();
            const toolCallIdMap = new Map<string, string>(); // proposalId -> toolCallId
            const toolCallToProposalId = new Map<string, string>(); // toolCallId -> proposalId (for early plan file creation)
            const subscriptionId = `sub-${Date.now()}-${Math.random().toString(36).substring(7)}`;

            // Phase 1: Process planning stream (only proposeTest available)
            const planningEventStream = streamFromAI(planningStreamResult);
            yield* planningEventStream.pipe(
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
                      `[TestingAgent:${correlationId}] [Phase 1] Tool call: ${event.toolName}`,
                    );

                    // Send progress checkpoint for tool calls
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

                      // Create plan file immediately when proposeTest is called
                      // This allows users to review the plan before approving
                      if (event.toolCallId && event.toolArgs) {
                        const args = event.toolArgs as ProposeTestInput;
                        const proposalId = `${args.sourceFile}-${args.targetTestPath}-${Date.now()}`;
                        toolCallToProposalId.set(event.toolCallId, proposalId);

                        // Create plan file asynchronously (don't block stream)
                        yield* Effect.gen(function* () {
                          const planUri = yield* planFileService
                            .createPlanFile(args.sourceFile, {
                              proposalId,
                              subscriptionId,
                              targetTestPath: args.targetTestPath,
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
                          const fileData = yield* Effect.tryPromise({
                            try: () => vscode.workspace.fs.readFile(planUri),
                            catch: (error) =>
                              new TestingAgentError({
                                message: `Failed to read plan file: ${error instanceof Error ? error.message : "Unknown error"}`,
                                cause: error,
                              }),
                          });
                          let content = Buffer.from(fileData).toString("utf-8");
                          // Add toolCallId to frontmatter
                          content = content.replace(
                            /^---\n/,
                            `---\ntoolCallId: "${event.toolCallId}"\n`,
                          );
                          yield* Effect.tryPromise({
                            try: async () => {
                              await vscode.workspace.fs.writeFile(
                                planUri,
                                Buffer.from(content, "utf-8"),
                              );
                            },
                            catch: (error) =>
                              new TestingAgentError({
                                message: `Failed to update plan file: ${error instanceof Error ? error.message : "Unknown error"}`,
                                cause: error,
                              }),
                          });

                          // Plan file created - AI will write plan content naturally in its response
                          // The plan content will be written after the stream completes

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

                  if (event.type === "tool-result") {
                    yield* Effect.logDebug(
                      `[TestingAgent:${correlationId}] [Phase 1] Tool result: ${event.toolName}`,
                    );
                  }
                }),
              ),
            );

            // Get Phase 1 result
            const planningResult = yield* Effect.promise(async () => {
              return await planningStreamResult;
            });

            const planningSteps = yield* Effect.promise(async () => {
              return await planningResult.steps;
            });

            // Extract approved proposals from Phase 1 and create plan files
            const proposals: ProposedTest[] = [];
            const approvedProposals: Array<{
              proposal: ProposedTest;
              proposalId: string;
            }> = [];

            for (const step of planningSteps) {
              for (const toolCall of step.toolCalls || []) {
                const typedCall = toolCall as ToolCall<string, unknown>;
                if (typedCall.toolName === "proposeTest") {
                  const args = typedCall.input as ProposeTestInput;
                  const toolResult = step.toolResults?.find(
                    (r) =>
                      (r as ToolResult<string, unknown, unknown>).toolCallId ===
                      typedCall.toolCallId,
                  ) as ToolResult<string, unknown, unknown> | undefined;

                  if (toolResult?.output) {
                    const output = toolResult.output as ProposeTestOutput;
                    // Use early proposalId if available (from stream processing), otherwise use output.id
                    const toolCallId = typedCall.toolCallId;
                    const earlyProposalId = toolCallId
                      ? toolCallToProposalId.get(toolCallId)
                      : undefined;
                    const proposalId = earlyProposalId || output.id;

                    const proposal: ProposedTest = {
                      id: proposalId,
                      sourceFile: args.sourceFile,
                      targetTestPath: args.targetTestPath,
                      description: args.description,
                      isUpdate: args.isUpdate,
                      proposedContent: "", // Will be generated
                      navigationPath: args.navigationPath,
                      pageContext: args.pageContext,
                      prerequisites: args.prerequisites,
                      relatedTests: args.relatedTests,
                      userFlow: args.userFlow,
                      testCases: args.testCases,
                    };
                    proposals.push(proposal);

                    // Plan file should already be created during stream processing
                    // Just track the mapping and verify it exists
                    if (output.success) {
                      // Get toolCallId from the tool call
                      const toolCallId = typedCall.toolCallId;
                      toolCallIdMap.set(proposalId, toolCallId);

                      // Check if plan file was created early (during stream processing)
                      const earlyProposalId =
                        toolCallToProposalId.get(toolCallId);
                      const planUri = earlyProposalId
                        ? planFileMap.get(earlyProposalId)
                        : undefined;

                      if (planUri) {
                        // Plan file already exists - update mapping to use proposalId
                        planFileMap.set(proposalId, planUri);
                        yield* Effect.logDebug(
                          `[TestingAgent:${correlationId}] Plan file already exists for proposal: ${proposalId}`,
                        );
                      } else {
                        // Fallback: create plan file if it wasn't created early (shouldn't happen normally)
                        yield* Effect.logDebug(
                          `[TestingAgent:${correlationId}] Plan file not found early, creating as fallback for: ${proposalId}`,
                        );
                        const fallbackPlanUri = yield* planFileService
                          .createPlanFile(args.sourceFile, {
                            proposalId: proposalId,
                            subscriptionId,
                            targetTestPath: args.targetTestPath,
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
                        const fileData = yield* Effect.tryPromise({
                          try: () =>
                            vscode.workspace.fs.readFile(fallbackPlanUri),
                          catch: (error) =>
                            new TestingAgentError({
                              message: `Failed to read plan file: ${error instanceof Error ? error.message : "Unknown error"}`,
                              cause: error,
                            }),
                        });
                        let content = Buffer.from(fileData).toString("utf-8");
                        // Add toolCallId to frontmatter
                        content = content.replace(
                          /^---\n/,
                          `---\ntoolCallId: "${toolCallId}"\n`,
                        );
                        yield* Effect.tryPromise({
                          try: async () => {
                            await vscode.workspace.fs.writeFile(
                              fallbackPlanUri,
                              Buffer.from(content, "utf-8"),
                            );
                          },
                          catch: (error) =>
                            new TestingAgentError({
                              message: `Failed to update plan file: ${error instanceof Error ? error.message : "Unknown error"}`,
                              cause: error,
                            }),
                        });

                        planFileMap.set(proposalId, fallbackPlanUri);
                      }
                    }

                    // Track approved proposals for Phase 2 execution
                    // The approval registry may have output.id (from tool's processProposeTestApproval)
                    // If we have an early proposalId and output.id is different, sync them
                    if (earlyProposalId && proposalId !== output.id) {
                      // If output.id is approved, also mark early proposalId as approved
                      if (approvalRegistry.has(output.id)) {
                        approvalRegistry.add(proposalId);
                      }
                    }
                    if (output.success && approvalRegistry.has(proposalId)) {
                      approvedProposals.push({
                        proposal,
                        proposalId: proposalId,
                      });
                    }
                  }
                }
              }
            }

            // Write AI's natural plan text to each plan file
            const aiPlanText = yield* Effect.promise(async () => {
              return (await planningResult.text) || "";
            });

            if (aiPlanText) {
              for (const [, planUri] of planFileMap.entries()) {
                yield* planFileService
                  .appendContent(planUri, `\n${aiPlanText}`)
                  .pipe(
                    Effect.catchAll((error) =>
                      Effect.gen(function* () {
                        yield* Effect.logDebug(
                          `[TestingAgent:${correlationId}] Failed to write AI plan text: ${error.message}`,
                        );
                        return Effect.void;
                      }),
                    ),
                  );
              }
            }

            // Phase 2: Execute approved proposals with writeTestFile tool available
            const executions: Array<{ testId: string; filePath?: string }> = [];

            // Check for cancellation before Phase 2
            if (signal?.aborted) {
              yield* Effect.logDebug(
                `[TestingAgent:${correlationId}] Cancelled before Phase 2`,
              );
              return yield* Effect.fail(
                new TestingAgentError({
                  message: "Operation cancelled by user",
                }),
              );
            }

            if (approvedProposals.length > 0) {
              yield* Effect.logDebug(
                `[TestingAgent:${correlationId}] Starting Phase 2: Executing ${approvedProposals.length} approved proposal(s)`,
              );

              // Create writeTestFile tool for Phase 2
              const writeTestFile = createWriteTestFileTool(approvalRegistry);

              // Phase 2 tools - writeTestFile is now available
              const executionTools = {
                bashExecute: createBashExecuteTool(budget),
                writeTestFile,
              };

              // Execute each approved proposal
              for (const { proposal, proposalId } of approvedProposals) {
                // Check for cancellation before each proposal
                if (signal?.aborted) {
                  yield* Effect.logDebug(
                    `[TestingAgent:${correlationId}] Cancelled during execution loop`,
                  );
                  break; // Exit loop gracefully, return partial results
                }

                progressCallback?.(
                  "executing",
                  `Generating test file for ${proposal.targetTestPath}...`,
                );

                // Build execution prompt with approved proposal context
                const executionPrompt = PromptFactory.writeTestFile({
                  sourceFile: proposal.sourceFile,
                  targetTestPath: proposal.targetTestPath,
                  description: proposal.description,
                  isUpdate: proposal.isUpdate,
                  navigationPath: proposal.navigationPath,
                  prerequisites: proposal.prerequisites,
                  userFlow: proposal.userFlow,
                });

                // Phase 2: Execution streamText with writeTestFile available
                const executionStreamResult = yield* Effect.try({
                  try: () =>
                    streamText({
                      model: anthropic(AIModels.anthropic.testing),
                      tools: executionTools,
                      maxRetries: 0,
                      stopWhen: stepCountIs(20),
                      abortSignal: signal,
                      messages: [
                        {
                          role: "system" as const,
                          content: CYPRESS_EXECUTION_SYSTEM_PROMPT,
                          providerOptions: {
                            anthropic: {
                              cacheControl: { type: "ephemeral" },
                            },
                          },
                        },
                        {
                          role: "user" as const,
                          content: `${executionPrompt}\n\nIMPORTANT: Use proposalId "${proposalId}" when calling writeTestFile.`,
                        },
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
                        error instanceof Error
                          ? error.message
                          : "Unknown error",
                      cause: error,
                    }),
                });

                // Process Phase 2 execution stream
                const executionEventStream = streamFromAI(
                  executionStreamResult,
                );
                yield* executionEventStream.pipe(
                  Stream.mapError(
                    (error) =>
                      new TestingAgentError({
                        message:
                          error instanceof Error
                            ? error.message
                            : "Unknown error",
                        cause: error,
                      }),
                  ),
                  Stream.runForEach((event) =>
                    Effect.gen(function* () {
                      // Check for abort signal
                      if (signal?.aborted) {
                        yield* Effect.logDebug(
                          `[TestingAgent:${correlationId}] Abort signal detected, stopping execution stream`,
                        );
                        return yield* Effect.fail(
                          new TestingAgentError({
                            message: "Operation cancelled by user",
                          }),
                        );
                      }

                      if (event.type === "tool-call") {
                        yield* Effect.logDebug(
                          `[TestingAgent:${correlationId}] [Phase 2] Tool call: ${event.toolName}`,
                        );
                        if (event.toolName === "writeTestFile") {
                          progressCallback?.("writing", "Writing test file...");
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
                          } else {
                            progressCallback?.(
                              "executing",
                              "Running command...",
                            );
                          }
                        }
                      }

                      if (event.type === "text-delta" && event.content) {
                        // Don't send raw AI text as progress - only send structured checkpoints
                        // The content is already handled by the streamText result
                      }

                      if (event.type === "tool-result") {
                        yield* Effect.logDebug(
                          `[TestingAgent:${correlationId}] [Phase 2] Tool result: ${event.toolName}`,
                        );
                      }
                    }),
                  ),
                );

                // Get Phase 2 result
                const executionResult = yield* Effect.promise(async () => {
                  return await executionStreamResult;
                });

                const executionSteps = yield* Effect.promise(async () => {
                  return await executionResult.steps;
                });

                // Extract execution results
                for (const step of executionSteps) {
                  for (const toolCall of step.toolCalls || []) {
                    const typedCall = toolCall as ToolCall<string, unknown>;
                    if (typedCall.toolName === "writeTestFile") {
                      const toolResult = step.toolResults?.find(
                        (r) =>
                          (r as ToolResult<string, unknown, unknown>)
                            .toolCallId === typedCall.toolCallId,
                      ) as ToolResult<string, unknown, unknown> | undefined;

                      if (toolResult?.output) {
                        const output = toolResult.output as WriteTestFileOutput;
                        if (output.success) {
                          executions.push({
                            testId: proposalId,
                            filePath: output.filePath,
                          });
                        }
                      }
                    }
                  }
                }
              }
            }

            const totalDuration = Date.now() - startTime;
            yield* Effect.logDebug(
              `[TestingAgent:${correlationId}] Completed in ${totalDuration}ms. Proposals: ${proposals.length}, Executions: ${executions.length}`,
            );

            // Combine response text from both phases
            const planningResponseText = yield* Effect.promise(async () => {
              return (await planningResult.text) || "";
            });

            return {
              proposals,
              executions,
              response: planningResponseText,
            };
          }),

        /**
         * Plan Cypress tests for one or more React component files
         * Analyzes files with git diff context and proposes test files without writing them
         * Supports multi-turn conversations for refining plans
         * Handles single file or multiple files with internal batching
         */
        planTest: (
          filePaths: string | string[],
          options?: {
            conversationHistory?: Array<{
              role: "user" | "assistant" | "system";
              content: string;
            }>;
            outputChannel?: vscode.OutputChannel;
            progressCallback?: (status: string, message: string) => void;
          },
        ) =>
          Effect.gen(function* () {
            // Normalize to array
            const files = Array.isArray(filePaths) ? filePaths : [filePaths];
            const conversationHistory = options?.conversationHistory ?? [];
            const outputChannel = options?.outputChannel;
            const progressCallback = options?.progressCallback;

            // If single file, use the original single-file logic
            if (files.length === 1) {
              return yield* planTestForSingleFile(
                files[0],
                conversationHistory,
                outputChannel,
                progressCallback,
              );
            }

            // Multiple files - batch process with concurrency
            const maxConcurrentFiles =
              yield* configService.getMaxConcurrentFiles();

            yield* Effect.logDebug(
              `[PlanningAgent] Planning tests for ${files.length} file(s) with concurrency limit: ${maxConcurrentFiles}`,
            );

            const results = yield* Effect.all(
              files.map((filePath) =>
                planTestForSingleFile(
                  filePath,
                  [], // Each file gets empty conversation history in batch mode
                  outputChannel,
                  progressCallback,
                ),
              ),
              { concurrency: maxConcurrentFiles },
            );

            // Aggregate all tests from all files
            const allTests = results.flatMap((result) => result.tests);
            const lastResponse =
              results.length > 0 ? results[results.length - 1].response : "";

            yield* Effect.logDebug(
              `[PlanningAgent] Aggregated ${allTests.length} test(s) from ${files.length} file(s)`,
            );

            return {
              tests: allTests,
              response: lastResponse,
            } as TestGenerationPlan & { response: string };
          }).pipe(
            Effect.catchTag("ConfigurationError", (error) =>
              Effect.fail(error),
            ),
            Effect.catchTag("TestingAgentError", (error) =>
              Effect.gen(function* () {
                yield* Effect.logDebug(
                  `[TestingAgent] Error during planning: ${error.message}`,
                );
                return yield* Effect.fail(error);
              }),
            ),
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                const errorMessage =
                  error instanceof Error ? error.message : "Unknown error";
                yield* Effect.logDebug(
                  `[PlanningAgent] Error during planning: ${errorMessage}`,
                );
                return yield* Effect.fail(
                  new TestingAgentError({
                    message: errorMessage,
                    cause: error,
                  }),
                );
              }),
            ),
          ),

        /**
         * Execute a test proposal by writing the Cypress test file
         * Takes an approved proposal and generates the actual test file
         * This is the execution phase - file writes are allowed here
         */
        executeTest: (
          input: ExecuteTestInput,
          _outputChannel?: vscode.OutputChannel,
          abortSignal?: AbortSignal,
          progressCallback?: (message: string) => void,
        ) =>
          Effect.gen(function* () {
            // Check configuration first
            const configured = yield* configService.isConfigured();
            if (!configured) {
              return yield* Effect.fail(
                new ConfigurationError({
                  message:
                    "[TestingAgent] AI Gateway token not available. Please log in to authenticate.",
                }),
              );
            }

            yield* Effect.logDebug(
              `[TestingAgent] Executing test generation for: ${input.sourceFile}`,
            );

            // Type guard to check if output matches WriteTestFileOutput structure
            const isWriteTestFileOutput = (
              value: unknown,
            ): value is WriteTestFileOutput => {
              return (
                typeof value === "object" &&
                value !== null &&
                "filePath" in value &&
                "success" in value &&
                "message" in value &&
                typeof (value as WriteTestFileOutput).filePath === "string"
              );
            };

            /**
             * Extract test file path from tool results
             */
            const extractTestFilePath = <
              T extends { steps: Array<{ toolResults: Array<unknown> }> },
            >(
              result: T,
            ): Effect.Effect<
              { testFilePath?: string; success: boolean; message: string },
              never
            > =>
              Effect.gen(function* () {
                yield* Effect.logDebug(
                  `[TestingAgent] Extracting test file path from ${result.steps.length} step(s)`,
                );
                const writeResults = result.steps
                  .flatMap((step) => step.toolResults)
                  .filter((toolResult: unknown) => {
                    return (
                      typeof toolResult === "object" &&
                      toolResult !== null &&
                      "toolName" in toolResult &&
                      toolResult.toolName === "writeTestFile"
                    );
                  });

                yield* Effect.logDebug(
                  `[TestingAgent] Found ${writeResults.length} writeTestFile tool result(s)`,
                );

                if (writeResults.length > 0) {
                  const lastWrite = writeResults[writeResults.length - 1] as {
                    result?: unknown;
                    output?: unknown;
                  };
                  const toolOutput = lastWrite.result ?? lastWrite.output;
                  if (toolOutput && isWriteTestFileOutput(toolOutput)) {
                    yield* Effect.logDebug(
                      `[TestingAgent] Extracted test file: ${toolOutput.filePath} (success: ${toolOutput.success})`,
                    );
                    return {
                      testFilePath: toolOutput.filePath,
                      success: toolOutput.success,
                      message: toolOutput.message,
                    };
                  } else {
                    yield* Effect.logDebug(
                      "[TestingAgent] writeTestFile result found but format invalid",
                    );
                  }
                } else {
                  yield* Effect.logDebug(
                    "[TestingAgent] No writeTestFile results found in tool results",
                  );
                }

                return {
                  success: false,
                  message:
                    "Test execution completed but no test file was written. The model may have encountered an issue or decided not to create a test file.",
                };
              });

            // Create fresh budget for execution phase
            const budget = yield* makeTokenBudget();

            // Create tool set for execution (bash + write)
            const tools = {
              bashExecute: createBashExecuteTool(budget),
              writeTestFile: writeTestFileTool,
            };

            // Build prompt for execution
            const prompt = PromptFactory.writeTestFile({
              sourceFile: input.sourceFile,
              targetTestPath: input.targetTestPath,
              description: input.description,
              isUpdate: input.isUpdate,
            });

            yield* Effect.logDebug(
              "[TestingAgent] Calling AI model for execution...",
            );

            // Get AI API key (user-provided or gateway token)
            const tokenResult = yield* configService.getAiApiKey();
            if (!tokenResult.token) {
              return yield* Effect.fail(
                new ConfigurationError({
                  message:
                    "AI token not available. Please log in or provide API key.",
                }),
              );
            }

            // Create Anthropic provider (direct or gateway)
            const anthropic = createAnthropicProvider(tokenResult);

            // Generate text using AI SDK with streaming
            const streamResult = yield* Effect.try({
              try: () =>
                streamText({
                  model: anthropic(AIModels.anthropic.testing),
                  tools,
                  maxRetries: 0,
                  stopWhen: stepCountIs(8),
                  system: CYPRESS_EXECUTION_SYSTEM_PROMPT,
                  prompt,
                  abortSignal,
                }),
              catch: (error) =>
                new TestingAgentError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                }),
            });

            // Process stream for real-time feedback
            const eventStream = streamFromAI(streamResult);
            yield* eventStream.pipe(
              Stream.mapError(
                (error) =>
                  new TestingAgentError({
                    message: error.message,
                    cause: error,
                  }),
              ),
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  const effect = Match.value(event.type).pipe(
                    Match.when("text-delta", () => {
                      return Effect.gen(function* () {
                        if (event.content) {
                          yield* Effect.logDebug(
                            `[TestingAgent] AI text: ${event.content}`,
                          );
                        }
                      });
                    }),
                    Match.when("tool-call", () => {
                      return Effect.gen(function* () {
                        yield* Effect.logDebug(
                          `[TestingAgent] Tool call: ${event.toolName}`,
                        );
                        if (event.toolArgs) {
                          yield* Effect.logDebug(
                            `[TestingAgent]   Tool args: ${JSON.stringify(event.toolArgs, null, 2)}`,
                          );
                        }
                        // Send progress update for tool calls
                        if (event.toolName) {
                          const toolMessages: Record<string, string> = {
                            readFile: "Reading source file...",
                            listFiles: "Scanning directory structure...",
                            getCypressConfig:
                              "Checking Cypress configuration...",
                            writeTestFile: "Writing test file...",
                          };
                          const message =
                            toolMessages[event.toolName] ||
                            `Using ${event.toolName}...`;
                          progressCallback?.(message);
                        }
                      });
                    }),
                    Match.when("tool-result", () => {
                      return Effect.gen(function* () {
                        yield* Effect.logDebug(
                          `[TestingAgent] Tool result: ${event.toolName}`,
                        );
                        if (event.toolResult) {
                          const resultStr =
                            typeof event.toolResult === "string"
                              ? event.toolResult
                              : JSON.stringify(event.toolResult, null, 2);
                          const truncated =
                            resultStr.length > 500
                              ? `${resultStr.substring(0, 500)}... (truncated)`
                              : resultStr;
                          yield* Effect.logDebug(
                            `[TestingAgent]   Result: ${truncated}`,
                          );
                        }
                        // Send progress update for tool results
                        if (event.toolName === "writeTestFile") {
                          progressCallback?.("Test file written successfully!");
                        }
                      });
                    }),
                    Match.when("finish", () => {
                      return Effect.gen(function* () {
                        yield* Effect.logDebug(
                          `[TestingAgent] Execution stream finished`,
                        );
                        progressCallback?.("Finalizing test generation...");
                      });
                    }),
                    Match.orElse(() => Effect.void),
                  );
                  return yield* effect;
                }),
              ),
            );

            // Get final result for extraction
            const result = yield* Effect.tryPromise({
              try: async () => await streamResult,
              catch: (error) =>
                new TestingAgentError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                }),
            });

            // Await steps before using them
            const awaitedSteps = yield* Effect.tryPromise({
              try: async () => await result.steps,
              catch: (error) =>
                new TestingAgentError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                }),
            });

            yield* Effect.logDebug(
              `[TestingAgent] Execution completed. Steps: ${awaitedSteps.length}`,
            );

            // Log step details
            yield* Effect.logDebug(
              `[TestingAgent] Step breakdown: ${JSON.stringify(
                awaitedSteps.map((step, idx) => ({
                  step: idx + 1,
                  toolCalls: step.toolCalls?.length || 0,
                  toolResults: step.toolResults?.length || 0,
                  toolNames: step.toolCalls?.map(
                    (call: unknown) =>
                      (call as { toolName?: string })?.toolName || "unknown",
                  ),
                })),
                null,
                2,
              )}`,
            );

            // Extract structured data from tool results
            const extractionResult = yield* extractTestFilePath({
              ...result,
              steps: awaitedSteps,
            });

            yield* Effect.logDebug(
              `[TestingAgent] Extraction result: ${extractionResult.success ? "success" : "failed"} - ${extractionResult.testFilePath || "no file path"}`,
            );

            const output: ExecuteTestOutput = {
              success: extractionResult.success,
              testFilePath: extractionResult.testFilePath,
              testContent: extractionResult.message,
            };

            yield* Effect.logDebug(
              `[TestingAgent] Execution output: ${JSON.stringify(
                {
                  success: output.success,
                  testFilePath: output.testFilePath,
                  testContentLength: output.testContent?.length || 0,
                },
                null,
                2,
              )}`,
            );

            return output;
          }).pipe(
            Effect.catchTags({
              ConfigurationError: (error) =>
                Effect.succeed({
                  success: false,
                  error: error.message,
                } as ExecuteTestOutput),
              TestingAgentError: (error) =>
                Effect.gen(function* () {
                  yield* Effect.logDebug(
                    `[TestingAgent] Error: ${error.message}`,
                  );
                  return {
                    success: false,
                    error: error.message,
                  } as ExecuteTestOutput;
                }),
            }),
          ),
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
