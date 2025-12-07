import type * as vscode from "vscode";
import { generateText, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  readFileTool,
  listFilesTool,
  getCypressConfigTool,
  writeTestFileTool,
} from "./tools/index.js";
import type {
  ExecuteTestInput,
  ExecuteTestOutput,
  WriteTestFileOutput,
} from "./types.js";
import { Data, Effect } from "effect";
import { ConfigService } from "../config-service.js";
import { VSCodeService } from "../vs-code.js";
import { CYPRESS_EXECUTION_SYSTEM_PROMPT, PromptFactory } from "./prompts.js";

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
            };
            const toolOutput = lastWrite.result;
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
          outputChannel?: vscode.OutputChannel,
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

            // Create tool set for execution (minimal tools needed)
            const tools = {
              readFile: readFileTool,
              listFiles: listFilesTool,
              getCypressConfig: getCypressConfigTool,
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

            // Get AI Gateway OIDC token
            const gatewayToken = yield* configService.getAiApiKey();
            if (!gatewayToken) {
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
            const result = yield* Effect.tryPromise({
              try: () =>
                generateText({
                  model: anthropic("claude-haiku-4-5"),
                  tools,
                  stopWhen: stepCountIs(10), // Fewer steps needed since we're just executing
                  system: CYPRESS_EXECUTION_SYSTEM_PROMPT,
                  prompt,
                }),
              catch: (error) =>
                new ExecutionAgentError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                }),
            });

            yield* Effect.logDebug(
              `[ExecutionAgent] Execution completed. Steps: ${result.steps.length}`,
            );

            // Log step details
            yield* Effect.logDebug(
              `[ExecutionAgent] Step breakdown: ${JSON.stringify(
                result.steps.map((step, idx) => ({
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
            const extractionResult = yield* extractTestFilePath(result);

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
            Effect.catchAll((error) => {
              if (error instanceof ConfigurationError) {
                return Effect.succeed({
                  success: false,
                  error: error.message,
                } as ExecuteTestOutput);
              }
              return Effect.gen(function* () {
                const errorMessage =
                  error instanceof ExecutionAgentError
                    ? error.message
                    : error instanceof Error
                      ? error.message
                      : "Unknown error";
                yield* Effect.logDebug(
                  `[ExecutionAgent] Error: ${errorMessage}`,
                );
                return {
                  success: false,
                  error: errorMessage,
                } as ExecuteTestOutput;
              });
            }),
          ),
      };
    }),
    dependencies: [ConfigService.Default, VSCodeService.Default],
  },
) {}
