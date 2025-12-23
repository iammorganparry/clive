import { stepCountIs, streamText } from "ai";
import { Data, Effect, Match, Stream } from "effect";
import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import { ConfigService } from "../config-service.js";
import { RepositoryService } from "../repository-service.js";
import { AIModels } from "../ai-models.js";
import { createAnthropicProvider } from "../ai-provider-factory.js";
import {
  KNOWLEDGE_BASE_SYSTEM_PROMPT,
  KnowledgeBasePromptFactory,
} from "./prompts.js";
import { streamFromAI } from "../../utils/stream-utils.js";
import {
  createBashExecuteTool,
  createUpsertKnowledgeTool,
} from "./tools/index.js";
import { makeTokenBudget } from "./token-budget.js";

class KnowledgeBaseAgentError extends Data.TaggedError(
  "KnowledgeBaseAgentError",
)<{
  message: string;
  cause?: unknown;
}> {}

class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  message: string;
}> {}

/**
 * Agent for analyzing repository and building knowledge base
 * Uses bashExecute for file discovery and upsertKnowledge for storing findings
 */
export class KnowledgeBaseAgent extends Effect.Service<KnowledgeBaseAgent>()(
  "KnowledgeBaseAgent",
  {
    effect: Effect.gen(function* () {
      const configService = yield* ConfigService;
      const repositoryService = yield* RepositoryService;

      /**
       * Analyze repository and build knowledge base
       */
      const analyze = () =>
        Effect.gen(function* () {
          const correlationId = `kb-${Date.now()}-${Math.random().toString(36).substring(7)}`;
          const startTime = Date.now();

          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] Starting knowledge base analysis`,
          );

          // Check configuration
          const configStartTime = Date.now();
          const configured = yield* configService.isConfigured();
          const configDuration = Date.now() - configStartTime;
          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] Configuration check completed in ${configDuration}ms: ${configured ? "configured" : "not configured"}`,
          );

          if (!configured) {
            return yield* Effect.fail(
              new ConfigurationError({
                message:
                  "AI Gateway token not available. Please log in to authenticate.",
              }),
            );
          }

          // Create token budget
          const budgetStartTime = Date.now();
          const budget = yield* makeTokenBudget();
          const initialRemaining = yield* budget.remaining();
          const initialMaxBudget = yield* budget.getMaxBudget();
          const budgetDuration = Date.now() - budgetStartTime;
          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] Created token budget in ${budgetDuration}ms: ${initialRemaining}/${initialMaxBudget} tokens available`,
          );

          // Create tools
          const tools = {
            bashExecute: createBashExecuteTool(budget),
            upsertKnowledge: createUpsertKnowledgeTool(repositoryService),
          };

          // Get AI token
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
            `[KnowledgeBaseAgent:${correlationId}] Retrieved AI token in ${tokenDuration}ms (gateway: ${tokenResult.isGateway})`,
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

          // Generate prompt
          const prompt = KnowledgeBasePromptFactory.analyzeRepository();

          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] Prompt length: ${prompt.length} chars`,
          );
          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] Calling AI model (${AIModels.anthropic.testing}) for knowledge base analysis...`,
          );

          // Run agent loop
          const aiStartTime = Date.now();
          const streamResult = yield* Effect.try({
            try: () =>
              streamText({
                model: anthropic(AIModels.anthropic.testing),
                tools,
                maxRetries: 0,
                stopWhen: stepCountIs(60), // Allow more steps for comprehensive analysis
                messages: [
                  {
                    role: "system",
                    content: KNOWLEDGE_BASE_SYSTEM_PROMPT,
                    providerOptions: {
                      anthropic: { cacheControl: { type: "ephemeral" } },
                    },
                  },
                  {
                    role: "user",
                    content: prompt,
                  },
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
              new KnowledgeBaseAgentError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          // Process stream for logging
          const eventStream = streamFromAI(streamResult);
          let upsertCount = 0;
          yield* eventStream.pipe(
            Stream.mapError(
              (error) =>
                new KnowledgeBaseAgentError({
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
                          `[KnowledgeBaseAgent:${correlationId}] AI text: ${event.content}`,
                        );
                      }
                    });
                  }),
                  Match.when("tool-call", () => {
                    return Effect.gen(function* () {
                      yield* Effect.logDebug(
                        `[KnowledgeBaseAgent:${correlationId}] Tool call: ${event.toolName}`,
                      );
                      if (event.toolArgs) {
                        const argsStr = JSON.stringify(event.toolArgs, null, 2);
                        const truncated =
                          argsStr.length > 500
                            ? `${argsStr.substring(0, 500)}... (truncated)`
                            : argsStr;
                        yield* Effect.logDebug(
                          `[KnowledgeBaseAgent:${correlationId}]   Args: ${truncated}`,
                        );
                      }
                      // Special logging for upsertKnowledge
                      if (event.toolName === "upsertKnowledge") {
                        upsertCount++;
                        yield* Effect.logDebug(
                          `[KnowledgeBaseAgent:${correlationId}] Storing knowledge entry #${upsertCount}`,
                        );
                      }
                    });
                  }),
                  Match.when("tool-result", () => {
                    return Effect.gen(function* () {
                      yield* Effect.logDebug(
                        `[KnowledgeBaseAgent:${correlationId}] Tool result: ${event.toolName}`,
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
                          `[KnowledgeBaseAgent:${correlationId}]   Result: ${truncated}`,
                        );
                      }
                      if (event.toolName === "upsertKnowledge") {
                        const result = event.toolResult as {
                          success: boolean;
                          error?: string;
                        };
                        if (result.success) {
                          yield* Effect.logDebug(
                            `[KnowledgeBaseAgent:${correlationId}] Successfully stored knowledge entry`,
                          );
                        } else {
                          yield* Effect.logDebug(
                            `[KnowledgeBaseAgent:${correlationId}] Failed to store knowledge entry: ${result.error}`,
                          );
                        }
                      }
                    });
                  }),
                  Match.when("step-finish", () => {
                    return Effect.logDebug(
                      `[KnowledgeBaseAgent:${correlationId}] Step ${event.stepIndex || "unknown"} finished`,
                    );
                  }),
                  Match.when("finish", () => {
                    return Effect.logDebug(
                      `[KnowledgeBaseAgent:${correlationId}] Analysis stream finished`,
                    );
                  }),
                  Match.orElse(() => Effect.void),
                );
                return yield* effect;
              }),
            ),
          );

          // Get final result for extraction
          const result = yield* Effect.promise(async () => await streamResult);
          const aiDuration = Date.now() - aiStartTime;

          // Await steps and text before using them
          const awaitedSteps = yield* Effect.promise(async () => {
            return await result.steps;
          });
          const awaitedText = yield* Effect.promise(async () => {
            return await result.text;
          });

          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] AI model completed in ${aiDuration}ms. Steps: ${awaitedSteps.length}`,
          );

          // Log step breakdown
          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] Step breakdown:`,
          );
          for (let idx = 0; idx < awaitedSteps.length; idx++) {
            const step = awaitedSteps[idx];
            const toolCalls = step.toolCalls || [];
            const toolResults = step.toolResults || [];
            yield* Effect.logDebug(
              `[KnowledgeBaseAgent:${correlationId}]   Step ${idx + 1}: ${toolCalls.length} tool call(s), ${toolResults.length} result(s)`,
            );
            // Log tool call details
            for (let callIdx = 0; callIdx < toolCalls.length; callIdx++) {
              const call = toolCalls[callIdx] as {
                toolName?: string;
                args?: unknown;
              };
              yield* Effect.logDebug(
                `[KnowledgeBaseAgent:${correlationId}]     Tool call ${callIdx + 1}: ${call.toolName || "unknown"}`,
              );
              if (call.args) {
                const argsStr = JSON.stringify(call.args, null, 2);
                const truncated =
                  argsStr.length > 500
                    ? `${argsStr.substring(0, 500)}... (truncated)`
                    : argsStr;
                yield* Effect.logDebug(
                  `[KnowledgeBaseAgent:${correlationId}]       Args: ${truncated}`,
                );
              }
            }
            // Log tool result details
            for (
              let resultIdx = 0;
              resultIdx < toolResults.length;
              resultIdx++
            ) {
              const toolResult = toolResults[resultIdx] as {
                toolName?: string;
                result?: unknown;
                output?: unknown;
              };
              yield* Effect.logDebug(
                `[KnowledgeBaseAgent:${correlationId}]     Tool result ${resultIdx + 1}: ${toolResult.toolName || "unknown"}`,
              );
              if (toolResult.result || toolResult.output) {
                const resultStr =
                  typeof (toolResult.result || toolResult.output) === "string"
                    ? ((toolResult.result || toolResult.output) as string)
                    : JSON.stringify(
                        toolResult.result || toolResult.output,
                        null,
                        2,
                      );
                const truncated =
                  resultStr.length > 500
                    ? `${resultStr.substring(0, 500)}... (truncated)`
                    : resultStr;
                yield* Effect.logDebug(
                  `[KnowledgeBaseAgent:${correlationId}]       Result: ${truncated}`,
                );
              }
            }
          }

          // Log AI response text (truncated)
          if (awaitedText) {
            const truncatedText =
              awaitedText.length > 1000
                ? `${awaitedText.substring(0, 1000)}... (truncated)`
                : awaitedText;
            yield* Effect.logDebug(
              `[KnowledgeBaseAgent:${correlationId}] AI response text: ${truncatedText}`,
            );
          }

          // Log final budget consumption
          const consumed = yield* budget.getConsumed();
          const remaining = yield* budget.remaining();
          const maxBudget = yield* budget.getMaxBudget();
          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] Token budget: ${consumed}/${maxBudget} consumed, ${remaining} remaining`,
          );

          const totalDuration = Date.now() - startTime;
          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] Analysis completed in ${totalDuration}ms. Stored ${upsertCount} knowledge entries.`,
          );

          return {
            success: true,
            entryCount: upsertCount,
          };
        }).pipe(
          Effect.catchTag("ConfigurationError", (error) =>
            Effect.gen(function* () {
              yield* Effect.logDebug(
                `[KnowledgeBaseAgent] Configuration error: ${error.message}`,
              );
              return yield* Effect.fail(
                new KnowledgeBaseAgentError({
                  message: error.message,
                }),
              );
            }),
          ),
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
              yield* Effect.logDebug(
                `[KnowledgeBaseAgent] Error during analysis: ${errorMessage}`,
              );
              return yield* Effect.fail(
                new KnowledgeBaseAgentError({
                  message: errorMessage,
                  cause: error,
                }),
              );
            }),
          ),
        );

      return {
        analyze,
      };
    }),
  },
) {}

/**
 * Production layer - dependencies provided at composition site
 */
export const KnowledgeBaseAgentLive = KnowledgeBaseAgent.Default;
