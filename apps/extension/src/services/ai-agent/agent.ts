import { Effect, Layer } from "effect";
import type vscode from "vscode";
import { ConfigService } from "../config-service.js";
import { createLoggerLayer } from "../logger-service.js";
import { VSCodeService } from "../vs-code.js";
import { ExecutionAgent } from "./execution-agent.js";
import { PlanningAgent } from "./planning-agent.js";
import type {
  ExecuteTestInput,
  GenerateTestInput,
  GenerateTestOutput,
} from "./types.js";

// Create layers for both agents
const planningAgentLayer = Layer.merge(
  PlanningAgent.Default,
  Layer.merge(ConfigService.Default, VSCodeService.Default),
);

const executionAgentLayer = Layer.merge(
  ExecutionAgent.Default,
  Layer.merge(ConfigService.Default, VSCodeService.Default),
);

/**
 * Facade for Cypress test generation agents
 * Delegates to specialized PlanningAgent and ExecutionAgent
 */
export class CypressTestAgent extends Effect.Service<CypressTestAgent>()(
  "CypressTestAgent",
  {
    effect: Effect.gen(function* () {
      return {
        /**
         * Check if the agent is properly configured
         */
        isConfigured: () =>
          Effect.gen(function* () {
            const planningAgent = yield* PlanningAgent;
            return yield* planningAgent.isConfigured();
          }).pipe(Effect.provide(planningAgentLayer)),

        /**
         * Plan Cypress tests for multiple React components
         * Uses PlanningAgent with Claude Opus 4.5 for intelligent analysis
         * Processes files in parallel with a concurrency limit
         */
        planTests: (
          files: string[],
          outputChannel?: vscode.OutputChannel,
          isDev?: boolean,
        ) =>
          Effect.gen(function* () {
            const planningAgent = yield* PlanningAgent;
            const configService = yield* ConfigService;
            const maxConcurrentFiles =
              yield* configService.getMaxConcurrentFiles();
            const results = yield* Effect.all(
              files.map((file) => planningAgent.planTest(file, outputChannel)),
              { concurrency: maxConcurrentFiles },
            );
            // Aggregate all tests from all files
            return {
              tests: results.flatMap((result) => result.tests),
            };
          }).pipe(
            Effect.provide(
              outputChannel && isDev !== undefined
                ? Layer.merge(
                    planningAgentLayer,
                    createLoggerLayer(outputChannel, isDev),
                  )
                : planningAgentLayer,
            ),
          ),

        /**
         * Execute a test proposal by writing the Cypress test file
         * Uses ExecutionAgent with Claude Haiku for fast execution
         */
        executeTest: (
          input: ExecuteTestInput,
          outputChannel?: vscode.OutputChannel,
          isDev?: boolean,
          abortSignal?: AbortSignal,
          progressCallback?: (message: string) => void,
        ) =>
          Effect.gen(function* () {
            const executionAgent = yield* ExecutionAgent;
            return yield* executionAgent.executeTest(
              input,
              outputChannel,
              abortSignal,
              progressCallback,
            );
          }).pipe(
            Effect.provide(
              outputChannel && isDev !== undefined
                ? Layer.merge(
                    executionAgentLayer,
                    createLoggerLayer(outputChannel, isDev),
                  )
                : executionAgentLayer,
            ),
          ),

        /**
         * Generate Cypress test for a React component
         * Legacy method - maintains backward compatibility
         * For new code, prefer using planTests() + executeTest() workflow
         */
        generateTest: (
          input: GenerateTestInput,
          outputChannel?: vscode.OutputChannel,
          isDev?: boolean,
          abortSignal?: AbortSignal,
          progressCallback?: (message: string) => void,
        ) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              `[CypressTestAgent] generateTest called for: ${input.sourceFilePath}`,
            );
            progressCallback?.("Analyzing source file...");

            const service = yield* CypressTestAgent;
            const executeInput: ExecuteTestInput = {
              sourceFile: input.sourceFilePath,
              targetTestPath: "", // Will be determined by the agent
              description: `Generate Cypress E2E test for ${input.sourceFilePath}`,
              isUpdate: input.options?.updateExisting ?? false,
            };

            progressCallback?.("Generating test content...");

            const result = yield* service.executeTest(
              executeInput,
              outputChannel,
              isDev,
              abortSignal,
              progressCallback,
            );

            if (result.success) {
              progressCallback?.("Test generated successfully!");
            } else {
              progressCallback?.("Test generation failed.");
            }

            return {
              success: result.success,
              testFilePath: result.testFilePath,
              testContent: result.testContent,
              error: result.error,
            } as GenerateTestOutput;
          }),
      };
    }),
    dependencies: [ConfigService.Default, VSCodeService.Default],
  },
) {}
