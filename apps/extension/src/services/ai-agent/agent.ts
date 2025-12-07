import { Effect, Layer } from "effect";
import * as vscode from "vscode";
import { ConfigService } from "../config-service.js";
import { VSCodeService } from "../vs-code.js";
import { ExecutionAgent } from "./execution-agent.js";
import { PlanningAgent } from "./planning-agent.js";
import { createLoggerLayer } from "../logger-service.js";
import type {
  ExecuteTestInput,
  GenerateTestInput,
  GenerateTestOutput,
} from "./types.js";
import { LoggerConfig } from "src/constants.js";

/**
 * Facade for Cypress test generation agents
 * Delegates to specialized PlanningAgent and ExecutionAgent
 */
export class CypressTestAgent extends Effect.Service<CypressTestAgent>()(
  "CypressTestAgent",
  {
    effect: Effect.gen(function* () {
      // Create layers for both agents
      const planningAgentLayer = Layer.merge(
        PlanningAgent.Default,
        Layer.merge(ConfigService.Default, VSCodeService.Default),
      );

      const executionAgentLayer = Layer.merge(
        ExecutionAgent.Default,
        Layer.merge(ConfigService.Default, VSCodeService.Default),
      );

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
         */
        planTests: (files: string[], outputChannel?: vscode.OutputChannel) =>
          Effect.gen(function* () {
            const planningAgent = yield* PlanningAgent;
            return yield* planningAgent.planTests(files, outputChannel);
          }).pipe(
            Effect.provide(
              outputChannel
                ? Layer.merge(
                    planningAgentLayer,
                    createLoggerLayer(
                      outputChannel,
                      vscode.workspace
                        .getConfiguration()
                        .get<boolean>(LoggerConfig.devModeSettingKey, false) ||
                        process.env.NODE_ENV === "development",
                    ),
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
        ) =>
          Effect.gen(function* () {
            const executionAgent = yield* ExecutionAgent;
            return yield* executionAgent.executeTest(input, outputChannel);
          }).pipe(
            Effect.provide(
              outputChannel
                ? Layer.merge(
                    executionAgentLayer,
                    createLoggerLayer(
                      outputChannel,
                      vscode.workspace
                        .getConfiguration()
                        .get<boolean>(LoggerConfig.devModeSettingKey, false) ||
                        process.env.NODE_ENV === "development",
                    ),
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
        ) =>
          Effect.gen(function* () {
            const service = yield* CypressTestAgent;
            const executeInput: ExecuteTestInput = {
              sourceFile: input.sourceFilePath,
              targetTestPath: "", // Will be determined by the agent
              description: `Generate Cypress E2E test for ${input.sourceFilePath}`,
              isUpdate: input.options?.updateExisting ?? false,
            };

            const result = yield* service.executeTest(
              executeInput,
              outputChannel,
            );

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
