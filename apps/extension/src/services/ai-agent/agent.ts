import { Effect, Layer } from "effect";
import type vscode from "vscode";
import { ConfigService } from "../config-service.js";
import { CodebaseIndexingService } from "../codebase-indexing-service.js";
import { createLoggerLayer } from "../logger-service.js";
import { VSCodeService } from "../vs-code.js";
import { TestingAgent } from "./testing-agent.js";
import type {
  ExecuteTestInput,
  GenerateTestInput,
  GenerateTestOutput,
} from "./types.js";

// Create layer for TestingAgent
const testingAgentLayer = Layer.merge(
  TestingAgent.Default,
  Layer.merge(
    ConfigService.Default,
    Layer.merge(VSCodeService.Default, CodebaseIndexingService.Default),
  ),
);

/**
 * Facade for Cypress test generation agent
 * Delegates to TestingAgent which handles both planning and execution phases
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
            const testingAgent = yield* TestingAgent;
            return yield* testingAgent.isConfigured();
          }).pipe(Effect.provide(testingAgentLayer)),

        /**
         * Plan Cypress tests for multiple React components
         * Uses TestingAgent with Claude Opus 4.5 for intelligent analysis
         * Processes files in parallel with a concurrency limit (handled internally by TestingAgent)
         */
        planTests: (
          files: string[],
          outputChannel?: vscode.OutputChannel,
          isDev?: boolean,
        ) =>
          Effect.gen(function* () {
            const testingAgent = yield* TestingAgent;
            // TestingAgent now handles batching internally
            const result = yield* testingAgent.planTest(files, {
              outputChannel,
            });
            return {
              tests: result.tests,
            };
          }).pipe(
            Effect.provide(
              outputChannel && isDev !== undefined
                ? Layer.merge(
                    testingAgentLayer,
                    createLoggerLayer(outputChannel, isDev),
                  )
                : testingAgentLayer,
            ),
          ),

        /**
         * Execute a test proposal by writing the Cypress test file
         * Uses TestingAgent with Claude Haiku for fast execution
         */
        executeTest: (
          input: ExecuteTestInput,
          outputChannel?: vscode.OutputChannel,
          isDev?: boolean,
          abortSignal?: AbortSignal,
          progressCallback?: (message: string) => void,
        ) =>
          Effect.gen(function* () {
            const testingAgent = yield* TestingAgent;
            return yield* testingAgent.executeTest(
              input,
              outputChannel,
              abortSignal,
              progressCallback,
            );
          }).pipe(
            Effect.provide(
              outputChannel && isDev !== undefined
                ? Layer.merge(
                    testingAgentLayer,
                    createLoggerLayer(outputChannel, isDev),
                  )
                : testingAgentLayer,
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
    // No dependencies - allows test injection via Layer.provide()
  },
) {}

/**
 * Production layer with all dependencies composed.
 * Use this in production code; use CypressTestAgent.Default in tests with mocked deps.
 *
 * CypressTestAgent depends on VSCodeService (context-specific) and ConfigService.
 * All have context-specific deps in their chain.
 * Use CypressTestAgent.Default directly - dependencies provided at composition site.
 */
export const CypressTestAgentLive = CypressTestAgent.Default;
