import { stepCountIs, streamText } from "ai";
import { Data, Effect, Match, Stream } from "effect";
import { ConfigService } from "../config-service.js";
import { AIModels } from "../ai-models.js";
import { createXaiProvider } from "../ai-provider-factory.js";
import { KnowledgeBasePromptFactory } from "./prompts.js";
import { streamFromAI } from "../../utils/stream-utils.js";
import {
  createBashExecuteTool,
  createWriteKnowledgeFileTool,
  createWebTools,
} from "./tools/index.js";
import { KnowledgeFileService } from "../knowledge-file-service.js";
import { makeTokenBudget } from "./token-budget.js";
import type { KnowledgeBaseProgressEvent } from "../knowledge-base-types.js";

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
 * Uses bashExecute for file discovery and writeKnowledgeFile for storing findings
 */
export class KnowledgeBaseAgent extends Effect.Service<KnowledgeBaseAgent>()(
  "KnowledgeBaseAgent",
  {
    effect: Effect.gen(function* () {
      const configService = yield* ConfigService;
      const knowledgeFileService = yield* KnowledgeFileService;

      /**
       * Analyze repository and build knowledge base
       * Single organic exploration pass - agent decides what to document
       */
      const analyze = (
        progressCallback?: (event: KnowledgeBaseProgressEvent) => void,
        _options?: { skipCategories?: string[] },
      ) =>
        Effect.gen(function* () {
          const correlationId = `kb-${Date.now()}-${Math.random().toString(36).substring(7)}`;
          const startTime = Date.now();

          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] Starting knowledge base exploration`,
          );

          const categoryEntryCounts: Record<string, number> = {};

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

          // Pre-fetch context values needed by tools
          progressCallback?.({
            type: "progress",
            message: "Preparing repository analysis...",
          });

          // Get Firecrawl API key and set as environment variable
          const firecrawlApiKey = yield* configService
            .getFirecrawlApiKey()
            .pipe(Effect.catchAll(() => Effect.succeed(null)));
          if (firecrawlApiKey) {
            process.env.FIRECRAWL_API_KEY = firecrawlApiKey;
          }

          // Create tools
          const webTools = firecrawlApiKey
            ? createWebTools({ enableSearch: true, enableScrape: true })
            : {};
          const tools = {
            bashExecute: createBashExecuteTool(budget),
            writeKnowledgeFile: createWriteKnowledgeFileTool(
              knowledgeFileService,
              (category, success) => {
                if (success) {
                  categoryEntryCounts[category] =
                    (categoryEntryCounts[category] || 0) + 1;
                  progressCallback?.({
                    type: "category_complete",
                    category,
                    entryCount: categoryEntryCounts[category],
                  });
                }
              },
            ),
            ...webTools,
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

          const xai = createXaiProvider(tokenResult);

          // Single organic exploration pass
          progressCallback?.({
            type: "progress",
            message: "Exploring codebase and building knowledge base...",
          });

          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] Starting single exploration pass`,
          );

          // Run AI exploration
          const aiStartTime = Date.now();
          const streamResult = yield* Effect.try({
            try: () =>
              streamText({
                model: xai(AIModels.knowledgeBase.analysis),
                tools,
                maxRetries: 0,
                stopWhen: stepCountIs(60), // Higher limit for deep exploration
                messages: [
                  {
                    role: "system",
                    content:
                      "You are a Knowledge Base Explorer. Deeply explore this codebase and document valuable insights that will help a testing agent write intelligent tests. Use writeKnowledgeFile to store your discoveries as you go.",
                  },
                  {
                    role: "user",
                    content: KnowledgeBasePromptFactory.exploreCodebase(),
                  },
                ],
              }),
            catch: (error) =>
              new KnowledgeBaseAgentError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          // Process stream
          const eventStream = streamFromAI(streamResult);
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
                          `[KnowledgeBaseAgent:${correlationId}] AI text: ${event.content.substring(0, 100)}...`,
                        );
                      }
                    });
                  }),
                  Match.when("tool-call", () => {
                    return Effect.gen(function* () {
                      yield* Effect.logDebug(
                        `[KnowledgeBaseAgent:${correlationId}] Tool call: ${event.toolName}`,
                      );
                      if (
                        event.toolName === "writeKnowledgeFile" &&
                        event.toolArgs
                      ) {
                        const args = event.toolArgs as {
                          category?: string;
                          title?: string;
                        };
                        progressCallback?.({
                          type: "progress",
                          message: `Documenting: ${args.category || "knowledge"} - ${args.title || ""}`,
                        });
                      }
                    });
                  }),
                  Match.when("tool-result", () => {
                    return Effect.logDebug(
                      `[KnowledgeBaseAgent:${correlationId}] Tool result: ${event.toolName}`,
                    );
                  }),
                  Match.when("step-finish", () => {
                    return Effect.logDebug(
                      `[KnowledgeBaseAgent:${correlationId}] Step finished`,
                    );
                  }),
                  Match.when("finish", () => {
                    return Effect.logDebug(
                      `[KnowledgeBaseAgent:${correlationId}] Exploration finished`,
                    );
                  }),
                  Match.orElse(() => Effect.void),
                );
                return yield* effect;
              }),
            ),
          );

          // Get final result
          const result = yield* Effect.promise(async () => {
            return await streamResult;
          });

          const awaitedSteps = yield* Effect.promise(async () => {
            return await result.steps;
          });
          const aiDuration = Date.now() - aiStartTime;

          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] Steps used: ${awaitedSteps.length}/60`,
          );
          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] Exploration completed in ${aiDuration}ms`,
          );

          // Calculate total entry count
          const totalEntryCount = Object.values(categoryEntryCounts).reduce(
            (sum, count) => sum + count,
            0,
          );

          // Generate index file at the end
          progressCallback?.({
            type: "progress",
            message: "Generating knowledge base index...",
          });
          yield* knowledgeFileService.generateIndex().pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                yield* Effect.logDebug(
                  `[KnowledgeBaseAgent:${correlationId}] Failed to generate index: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
                // Don't fail the whole operation if index generation fails
                return Effect.void;
              }),
            ),
          );

          const totalDuration = Date.now() - startTime;
          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] Exploration completed in ${totalDuration}ms. Total entries: ${totalEntryCount}`,
          );

          return {
            success: true,
            entryCount: totalEntryCount,
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
