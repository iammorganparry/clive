import {
  createAnthropic,
  type AnthropicProviderOptions,
} from "@ai-sdk/anthropic";
import type { ToolCall, ToolResult } from "@ai-sdk/provider-utils";
import { stepCountIs, streamText } from "ai";
import { Data, Effect, Layer, Match, Stream } from "effect";
import vscode from "vscode";
import { ConfigService } from "../config-service.js";
import { SecretStorageService, VSCodeService } from "../vs-code.js";
import { AIModels } from "../ai-models.js";
import {
  CYPRESS_CONTENT_GENERATION_SYSTEM_PROMPT,
  CYPRESS_PLANNING_SYSTEM_PROMPT,
  PromptFactory,
} from "./prompts.js";
import { streamFromAI } from "../../utils/stream-utils.js";
import {
  createGetCypressConfigTool,
  createGetFileDiffTool,
  createGlobSearchTool,
  createGrepSearchTool,
  createListFilesTool,
  createReadFileTool,
  createSemanticSearchTool,
  proposeTestTool,
  writeTestFileTool,
} from "./tools/index.js";
import { makeTokenBudget } from "./token-budget.js";
import type {
  ProposedTest,
  ProposeTestOutput,
  TestGenerationPlan,
} from "./types.js";

// Removed batch processing - now processing one file at a time

class PlanningAgentError extends Data.TaggedError("PlanningAgentError")<{
  message: string;
  cause?: unknown;
}> {}

class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  message: string;
}> {}

/**
 * Planning Agent for analyzing components and proposing Cypress tests
 * Uses Claude Opus 4.5 for intelligent analysis and planning
 */
export class PlanningAgent extends Effect.Service<PlanningAgent>()(
  "PlanningAgent",
  {
    effect: Effect.gen(function* () {
      const configService = yield* ConfigService;
      const vscodeService = yield* VSCodeService;

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
       * Extract test content from generateText result
       */
      const extractTestContent = <
        T extends { steps: Array<{ toolCalls: Array<unknown> }> },
      >(
        result: T,
        test: ProposedTest,
      ): Effect.Effect<string, never> =>
        Effect.sync(() => {
          const writeCalls = result.steps
            .flatMap((step) => step.toolCalls)
            .filter(
              (call): call is ToolCall<string, unknown> =>
                (call as ToolCall<string, unknown>).toolName ===
                "writeTestFile",
            );

          if (writeCalls.length > 0) {
            const lastCall = writeCalls[writeCalls.length - 1];
            if (lastCall.input && typeof lastCall.input === "object") {
              const input = lastCall.input as { testContent?: string };
              if (input.testContent) {
                return input.testContent;
              }
            }
          }

          // Fallback if no content was captured
          return `// Test content generation in progress...\n// Target: ${test.targetTestPath}\n// Description: ${test.description}`;
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
          const tools = {
            readFile: createReadFileTool(contentBudget),
            listFiles: createListFilesTool(contentBudget),
            getCypressConfig: createGetCypressConfigTool(contentBudget),
            semanticSearch: createSemanticSearchTool(contentBudget), // E2E: Can search for context if needed
            writeTestFile: writeTestFileTool,
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
          const gatewayToken = yield* configService.getAiApiKey().pipe(
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
            `[PlanningAgent:${correlationId}] Retrieved gateway token in ${tokenDuration}ms`,
          );

          if (!gatewayToken) {
            yield* Effect.logDebug(
              `[PlanningAgent:${correlationId}] ERROR: Gateway token not available`,
            );
            return yield* Effect.fail(
              new ConfigurationError({
                message: "AI Gateway token not available. Please log in.",
              }),
            );
          }

          const anthropic = createAnthropic({
            apiKey: gatewayToken,
          });

          // Generate text using AI SDK
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Calling AI model (${AIModels.anthropic.planning}) for content generation...`,
          );
          const aiStartTime = Date.now();
          const streamResult = yield* Effect.try({
            try: () =>
              streamText({
                model: anthropic(AIModels.anthropic.planning),
                tools,
                stopWhen: stepCountIs(10),
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
              new PlanningAgentError({
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
                new PlanningAgentError({
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

          // Extract test content
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Extracting test content from result...`,
          );
          const extractStartTime = Date.now();
          const proposedContent = yield* extractTestContent(
            awaitedResult,
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

          // Create budget-aware tools using factory functions
          const tools = {
            readFile: createReadFileTool(budget),
            listFiles: createListFilesTool(budget),
            grepSearch: createGrepSearchTool(budget),
            globSearch: createGlobSearchTool(budget),
            getCypressConfig: createGetCypressConfigTool(budget),
            getFileDiff: createGetFileDiffTool(budget),
            semanticSearch: createSemanticSearchTool(budget), // E2E: Semantic search for application context
            proposeTest: proposeTestTool, // No budget needed - output only
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

          // Get AI Gateway OIDC token
          const tokenStartTime = Date.now();
          const gatewayToken = yield* configService.getAiApiKey().pipe(
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
            `[PlanningAgent:${correlationId}] Retrieved gateway token in ${tokenDuration}ms`,
          );

          if (!gatewayToken) {
            yield* Effect.logDebug(
              `[PlanningAgent:${correlationId}] ERROR: Gateway token not available`,
            );
            return yield* Effect.fail(
              new ConfigurationError({
                message: "AI Gateway token not available. Please log in.",
              }),
            );
          }

          // Create Anthropic client with OIDC token (SDK auto-detects gateway)
          const anthropic = createAnthropic({
            apiKey: gatewayToken,
          });

          // Generate text using AI SDK
          sendProgress("analyzing", `Analyzing ${filePath} with AI model...`);
          yield* Effect.logDebug(
            `[PlanningAgent:${correlationId}] Calling AI model (${AIModels.anthropic.planning}) for file: ${filePath}`,
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
                model: anthropic(AIModels.anthropic.planning),
                tools,
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
              new PlanningAgentError({
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
                new PlanningAgentError({
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
                        Match.when("getFileDiff", () => {
                          sendProgress(
                            "analyzing",
                            "Getting git diff to see what changed...",
                          );
                        }),
                        Match.when("readFile", () => {
                          const args = event.toolArgs as
                            | { filePath?: string }
                            | undefined;
                          const filePath = args?.filePath || "unknown";
                          sendProgress(
                            "analyzing",
                            `Reading component file: ${filePath.split("/").pop()}...`,
                          );
                        }),
                        Match.when("listFiles", () => {
                          sendProgress(
                            "analyzing",
                            "Checking for existing tests...",
                          );
                        }),
                        Match.when("grepSearch", () => {
                          sendProgress("analyzing", "Searching codebase...");
                        }),
                        Match.when("globSearch", () => {
                          sendProgress(
                            "analyzing",
                            "Finding files by pattern...",
                          );
                        }),
                        Match.when("getCypressConfig", () => {
                          sendProgress(
                            "analyzing",
                            "Reading Cypress config...",
                          );
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
                ConfigurationError: (error) =>
                  Effect.gen(function* () {
                    yield* Effect.logDebug(
                      `[PlanningAgent] Failed to generate content for ${test.targetTestPath}: ${error.message}`,
                    );
                    return {
                      proposedContent: `// Failed to generate content: ${error.message}`,
                      existingContent: undefined,
                    };
                  }),
                PlanningAgentError: (error) =>
                  Effect.gen(function* () {
                    yield* Effect.logDebug(
                      `[PlanningAgent] Failed to generate content for ${test.targetTestPath}: ${error.message}`,
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
            Effect.catchTag("PlanningAgentError", (error) =>
              Effect.gen(function* () {
                yield* Effect.logDebug(
                  `[PlanningAgent] Error during planning: ${error.message}`,
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
                  new PlanningAgentError({
                    message: errorMessage,
                    cause: error,
                  }),
                );
              }),
            ),
          ),
      };
    }),
    // No dependencies - allows test injection via Layer.provide()
  },
) {}

/**
 * Production layer with all dependencies composed.
 * Use this in production code; use PlanningAgent.Default in tests with mocked deps.
 */
export const PlanningAgentLive = PlanningAgent.Default.pipe(
  Layer.provide(ConfigService.Default),
  Layer.provide(VSCodeService.Default),
);
