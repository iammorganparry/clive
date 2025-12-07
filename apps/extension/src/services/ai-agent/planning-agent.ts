import vscode from "vscode";
import { generateText, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  readFileTool,
  listFilesTool,
  grepSearchTool,
  globSearchTool,
  getCypressConfigTool,
  proposeTestTool,
  writeTestFileTool,
} from "./tools/index.js";
import type {
  ProposedTest,
  TestGenerationPlan,
  ProposeTestOutput,
} from "./types.js";
import { Data, Effect, Layer } from "effect";
import { ConfigService } from "../config-service.js";
import { SecretStorageService, VSCodeService } from "../vs-code.js";
import {
  CYPRESS_PLANNING_SYSTEM_PROMPT,
  CYPRESS_CONTENT_GENERATION_SYSTEM_PROMPT,
  PromptFactory,
} from "./prompts.js";

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
            .filter((call: unknown) => {
              return (
                typeof call === "object" &&
                call !== null &&
                "toolName" in call &&
                call.toolName === "writeTestFile"
              );
            });

          if (writeCalls.length > 0) {
            const lastCall = writeCalls[writeCalls.length - 1] as {
              args?: unknown;
            };
            if (lastCall.args && typeof lastCall.args === "object") {
              const args = lastCall.args as { testContent?: string };
              if (args.testContent) {
                return args.testContent;
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
          // Read existing content if this is an update
          const existingContent = test.isUpdate
            ? yield* readExistingContent(test.targetTestPath).pipe(
                Effect.provide(VSCodeService.Default),
              )
            : undefined;

          // Create tool set for content generation
          const tools = {
            readFile: readFileTool,
            listFiles: listFilesTool,
            getCypressConfig: getCypressConfigTool,
            writeTestFile: writeTestFileTool,
          };

          // Build prompt for content generation
          const prompt = PromptFactory.writeTestFile({
            sourceFile: test.sourceFile,
            targetTestPath: test.targetTestPath,
            description: test.description,
            isUpdate: test.isUpdate,
          });

          // Get AI Gateway OIDC token
          const gatewayToken = yield* configService.getAiApiKey().pipe(
            Effect.mapError(
              (error) =>
                new ConfigurationError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                }),
            ),
          );
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
          yield* Effect.logDebug(
            `[PlanningAgent] Generating test content for ${test.targetTestPath}`,
          );
          const result = yield* Effect.tryPromise({
            try: () =>
              generateText({
                model: anthropic("claude-opus-4-5"),
                tools,
                stopWhen: stepCountIs(10),
                system: CYPRESS_CONTENT_GENERATION_SYSTEM_PROMPT,
                prompt,
              }),
            catch: (error) =>
              new PlanningAgentError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          yield* Effect.logDebug(
            `[PlanningAgent] Content generation completed. Steps: ${result.steps.length}`,
          );

          // Extract test content
          const proposedContent = yield* extractTestContent(result, test);

          yield* Effect.logDebug(
            `[PlanningAgent] Extracted test content (${proposedContent.length} chars)`,
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
            .filter((toolResult: unknown) => {
              return (
                typeof toolResult === "object" &&
                toolResult !== null &&
                "toolName" in toolResult &&
                toolResult.toolName === "proposeTest"
              );
            });

          yield* Effect.logDebug(
            `[PlanningAgent] Found ${proposeResults.length} proposeTest tool result(s)`,
          );

          for (const toolResult of proposeResults) {
            const typedResult = toolResult as {
              toolCallId?: string;
              result?: unknown;
            };
            const toolOutput = typedResult.result;
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
                  .find(
                    (call: unknown) =>
                      typeof call === "object" &&
                      call !== null &&
                      "toolCallId" in call &&
                      call.toolCallId === typedResult.toolCallId,
                  );

                if (
                  toolCall &&
                  typeof toolCall === "object" &&
                  "args" in toolCall
                ) {
                  const args = toolCall.args as {
                    sourceFile: string;
                    targetTestPath: string;
                    description: string;
                    isUpdate: boolean;
                  };

                  const testProposal = {
                    id: toolOutput.id,
                    sourceFile: args.sourceFile,
                    targetTestPath: args.targetTestPath,
                    description: args.description,
                    isUpdate: args.isUpdate,
                    proposedContent: "", // Will be populated during content generation
                    existingContent: undefined, // Will be populated during content generation if update
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

      return {
        /**
         * Check if the agent is properly configured
         */
        isConfigured: () =>
          Effect.gen(function* () {
            return yield* configService.isConfigured();
          }),

        /**
         * Plan Cypress tests for multiple React components
         * Analyzes files and proposes test files without writing them
         */
        planTests: (files: string[], outputChannel?: vscode.OutputChannel) =>
          Effect.gen(function* () {
            // Check configuration first
            const configured = yield* configService.isConfigured();
            if (!configured) {
              return yield* Effect.fail(
                new ConfigurationError({
                  message:
                    "AI Gateway token not available. Please log in to authenticate.",
                }),
              );
            }

            yield* Effect.logDebug(
              `[PlanningAgent] Starting test planning for ${files.length} file(s)`,
            );

            // Create tool set for planning (read-only tools + proposeTest)
            const tools = {
              readFile: readFileTool,
              listFiles: listFilesTool,
              grepSearch: grepSearchTool,
              globSearch: globSearchTool,
              getCypressConfig: getCypressConfigTool,
              proposeTest: proposeTestTool,
            };

            // Build prompt for planning
            const prompt = PromptFactory.planTests(files);

            yield* Effect.logDebug(
              "[PlanningAgent] Calling AI model for planning...",
            );

            // Get AI Gateway OIDC token
            const gatewayToken = yield* configService.getAiApiKey().pipe(
              Effect.mapError(
                (error) =>
                  new ConfigurationError({
                    message:
                      error instanceof Error ? error.message : "Unknown error",
                  }),
              ),
            );
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
                  model: anthropic("claude-opus-4-5"),
                  tools,
                  stopWhen: stepCountIs(20), // Allow more steps for multiple files
                  system: CYPRESS_PLANNING_SYSTEM_PROMPT,
                  prompt,
                }),
              catch: (error) =>
                new PlanningAgentError({
                  message:
                    error instanceof Error ? error.message : "Unknown error",
                  cause: error,
                }),
            });

            yield* Effect.logDebug(
              `[PlanningAgent] Planning completed. Steps: ${result.steps.length}`,
            );

            // Log step details
            yield* Effect.logDebug(
              `[PlanningAgent] Step breakdown: ${JSON.stringify(
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

            // Extract ProposedTest objects from tool results
            const proposedTests = yield* extractProposedTests(result);

            yield* Effect.logDebug(
              `[PlanningAgent] Proposed ${proposedTests.length} test file(s)`,
            );

            // Log proposed test details
            for (const test of proposedTests) {
              yield* Effect.logDebug(
                `[PlanningAgent] Proposed test: ${test.id} - ${test.targetTestPath} (${test.isUpdate ? "update" : "new"})`,
              );
            }

            // Generate test content for each proposed test
            const testsWithContent: ProposedTest[] = [];
            for (const test of proposedTests) {
              yield* Effect.logDebug(
                `[PlanningAgent] Generating content for test: ${test.targetTestPath}`,
              );

              const contentResult = yield* generateTestContent(
                test,
                outputChannel,
              ).pipe(
                Effect.catchTag("ConfigurationError", (error) =>
                  Effect.gen(function* () {
                    yield* Effect.logDebug(
                      `[PlanningAgent] Failed to generate content for ${test.targetTestPath}: ${error.message}`,
                    );
                    return {
                      proposedContent: `// Failed to generate content: ${error.message}`,
                      existingContent: undefined,
                    };
                  }),
                ),
                Effect.catchTag("PlanningAgentError", (error) =>
                  Effect.gen(function* () {
                    yield* Effect.logDebug(
                      `[PlanningAgent] Failed to generate content for ${test.targetTestPath}: ${error.message}`,
                    );
                    return {
                      proposedContent: `// Failed to generate content: ${error.message}`,
                      existingContent: undefined,
                    };
                  }),
                ),
              );

              yield* Effect.logDebug(
                `[PlanningAgent] Generated content for ${test.targetTestPath} (${contentResult.proposedContent.length} chars)`,
              );

              testsWithContent.push({
                ...test,
                proposedContent: contentResult.proposedContent,
                existingContent: contentResult.existingContent,
              });
            }

            yield* Effect.logDebug(
              `[PlanningAgent] Planning complete: ${testsWithContent.length} test(s) with content generated`,
            );

            return {
              tests: testsWithContent,
            } as TestGenerationPlan;
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
    dependencies: [ConfigService.Default, VSCodeService.Default],
  },
) {}
