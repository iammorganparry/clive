import type * as vscode from "vscode";
import { streamText, stepCountIs } from "ai";
import { AIModels } from "../ai-models.js";
import {
  createReadFileTool,
  createListFilesTool,
  createGetCypressConfigTool,
  writeTestFileTool,
} from "./tools/index.js";
import type {
  ExecuteTestInput,
  ExecuteTestOutput,
  WriteTestFileOutput,
} from "./types.js";
import { Data, Effect, Layer, Match, Stream } from "effect";
import { ConfigService } from "../config-service.js";
import { VSCodeService } from "../vs-code.js";
import { CYPRESS_EXECUTION_SYSTEM_PROMPT, PromptFactory } from "./prompts.js";
import { streamFromAI } from "../../utils/stream-utils.js";
import { makeTokenBudget } from "./token-budget.js";
import { createAnthropicProvider } from "../ai-provider-factory.js";

class ExecutionAgentError extends Data.TaggedError("ExecutionAgentError")<{
  message: string;
  cause?: unknown;
}> {}

class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  message: string;
}> {}

/**
 * Execution Agent for writing Cypress test files
 * Uses Claude Haiku for fast, cost-effective test file generation
 */
export class ExecutionAgent extends Effect.Service<ExecutionAgent>()(
  "ExecutionAgent",
  {
    effect: Effect.gen(function* () {
      const configService = yield* ConfigService;

      /**
       * Type guard to check if output matches WriteTestFileOutput structure
       */
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
            `[ExecutionAgent] Extracting test file path from ${result.steps.length} step(s)`,
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
            `[ExecutionAgent] Found ${writeResults.length} writeTestFile tool result(s)`,
          );

          if (writeResults.length > 0) {
            const lastWrite = writeResults[writeResults.length - 1] as {
              result?: unknown;
              output?: unknown;
            };
            const toolOutput = lastWrite.result ?? lastWrite.output;
            if (toolOutput && isWriteTestFileOutput(toolOutput)) {
              yield* Effect.logDebug(
                `[ExecutionAgent] Extracted test file: ${toolOutput.filePath} (success: ${toolOutput.success})`,
              );
              return {
                testFilePath: toolOutput.filePath,
                success: toolOutput.success,
                message: toolOutput.message,
              };
            } else {
              yield* Effect.logDebug(
                "[ExecutionAgent] writeTestFile result found but format invalid",
              );
            }
          } else {
            yield* Effect.logDebug(
              "[ExecutionAgent] No writeTestFile results found in tool results",
            );
          }

          return {
            success: false,
            message:
              "Test execution completed but no test file was written. The model may have encountered an issue or decided not to create a test file.",
          };
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
         * Execute a test proposal by writing the Cypress test file
         * Takes an approved proposal and generates the actual test file
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
                    "[ExecutionAgent] AI Gateway token not available. Please log in to authenticate.",
                }),
              );
            }

            yield* Effect.logDebug(
              `[ExecutionAgent] Executing test generation for: ${input.sourceFile}`,
            );

            // Create fresh budget for execution phase
            const budget = yield* makeTokenBudget();

            // Create tool set for execution (minimal tools needed, budget-aware)
            const tools = {
              readFile: createReadFileTool(budget),
              listFiles: createListFilesTool(budget),
              getCypressConfig: createGetCypressConfigTool(budget),
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
              "[ExecutionAgent] Calling AI model for execution...",
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
                  model: anthropic(AIModels.anthropic.execution),
                  tools,
                  stopWhen: stepCountIs(20), // Increased for iteration and file reading
                  system: CYPRESS_EXECUTION_SYSTEM_PROMPT,
                  prompt,
                  abortSignal,
                }),
              catch: (error) =>
                new ExecutionAgentError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                }),
            });

            // Process stream for real-time feedback
            const eventStream = streamFromAI(streamResult);
            yield* eventStream.pipe(
              // Map stream errors to ExecutionAgentError
              Stream.mapError(
                (error) =>
                  new ExecutionAgentError({
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
                          // Log full AI streaming text response
                          yield* Effect.logDebug(
                            `[ExecutionAgent] AI text: ${event.content}`,
                          );
                        }
                      });
                    }),
                    Match.when("tool-call", () => {
                      return Effect.gen(function* () {
                        yield* Effect.logDebug(
                          `[ExecutionAgent] Tool call: ${event.toolName}`,
                        );
                        if (event.toolArgs) {
                          yield* Effect.logDebug(
                            `[ExecutionAgent]   Tool args: ${JSON.stringify(event.toolArgs, null, 2)}`,
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
                          `[ExecutionAgent] Tool result: ${event.toolName}`,
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
                            `[ExecutionAgent]   Result: ${truncated}`,
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
                          `[ExecutionAgent] Execution stream finished`,
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
                new ExecutionAgentError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                }),
            });

            // Await steps before using them
            const awaitedSteps = yield* Effect.tryPromise({
              try: async () => await result.steps,
              catch: (error) =>
                new ExecutionAgentError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                }),
            });

            yield* Effect.logDebug(
              `[ExecutionAgent] Execution completed. Steps: ${awaitedSteps.length}`,
            );

            // Log step details
            yield* Effect.logDebug(
              `[ExecutionAgent] Step breakdown: ${JSON.stringify(
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
              `[ExecutionAgent] Extraction result: ${extractionResult.success ? "success" : "failed"} - ${extractionResult.testFilePath || "no file path"}`,
            );

            const output: ExecuteTestOutput = {
              success: extractionResult.success,
              testFilePath: extractionResult.testFilePath,
              testContent: extractionResult.message,
            };

            yield* Effect.logDebug(
              `[ExecutionAgent] Execution output: ${JSON.stringify(
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
              ExecutionAgentError: (error) =>
                Effect.gen(function* () {
                  yield* Effect.logDebug(
                    `[ExecutionAgent] Error: ${error.message}`,
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
 * Use this in production code; use ExecutionAgent.Default in tests with mocked deps.

 * ExecutionAgent depends on VSCodeService (context-specific) and ConfigService.
 * All have context-specific deps in their chain.
 * Use ExecutionAgent.Default directly - dependencies provided at composition site.
 */
export const ExecutionAgentLive = ExecutionAgent.Default;
