import { stepCountIs, streamText } from "ai";
import { Data, Effect, Match, Stream } from "effect";
import { ConfigService } from "../config-service.js";
import { RepositoryService } from "../repository-service.js";
import { SecretStorageService } from "../vs-code.js";
import { AIModels } from "../ai-models.js";
import { createXaiProvider } from "../ai-provider-factory.js";
import { KnowledgeBasePromptFactory } from "./prompts.js";
import { streamFromAI } from "../../utils/stream-utils.js";
import { getWorkspaceRoot } from "../../lib/vscode-effects.js";
import {
  createBashExecuteTool,
  createUpsertKnowledgeTool,
} from "./tools/index.js";
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
 * Uses bashExecute for file discovery and upsertKnowledge for storing findings
 */
export class KnowledgeBaseAgent extends Effect.Service<KnowledgeBaseAgent>()(
  "KnowledgeBaseAgent",
  {
    effect: Effect.gen(function* () {
      const configService = yield* ConfigService;
      const repositoryService = yield* RepositoryService;
      const secretStorageService = yield* SecretStorageService;

      /**
       * Analyze repository and build knowledge base
       */
      const analyze = (
        progressCallback?: (event: KnowledgeBaseProgressEvent) => void,
        options?: { skipCategories?: string[] },
      ) =>
        Effect.gen(function* () {
          const correlationId = `kb-${Date.now()}-${Math.random().toString(36).substring(7)}`;
          const startTime = Date.now();

          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] Starting knowledge base analysis`,
          );

          // Phase definitions based on priority order
          const phaseDefinitions = [
            {
              id: 1,
              name: "Framework Discovery",
              categories: ["framework", "patterns"],
            },
            {
              id: 2,
              name: "Core Infrastructure",
              categories: ["mocks", "fixtures", "hooks"],
            },
            {
              id: 3,
              name: "Test Details",
              categories: [
                "selectors",
                "routes",
                "assertions",
                "utilities",
                "coverage",
              ],
            },
            { id: 4, name: "Analysis", categories: ["gaps", "improvements"] },
          ];

          let currentPhase: number | null = null;
          const categoryEntryCounts: Record<string, number> = {};

          // Helper to get phase for a category
          const getPhaseForCategory = (category: string): number => {
            for (const phase of phaseDefinitions) {
              if (phase.categories.includes(category)) {
                return phase.id;
              }
            }
            return 4; // Default to analysis phase
          };

          // Helper to check if phase changed
          const checkPhaseChange = (category: string) => {
            const newPhaseId = getPhaseForCategory(category);
            if (currentPhase !== newPhaseId) {
              currentPhase = newPhaseId;
              const phase = phaseDefinitions.find((p) => p.id === newPhaseId);
              if (phase) {
                progressCallback?.({
                  type: "phase_started",
                  phaseId: newPhaseId,
                  phaseName: phase.name,
                });
              }
            }
          };

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
          const userId = yield* configService.getUserId();
          const organizationId = yield* configService.getOrganizationId();
          const workspaceRoot = yield* getWorkspaceRoot();
          const gatewayToken = yield* configService.getAiGatewayToken();

          // Create repository for this workspace
          const repository = yield* repositoryService.upsertRepository(
            userId,
            workspaceRoot.fsPath.split("/").pop() || "workspace",
            workspaceRoot.fsPath,
            organizationId,
          );
          const repositoryId = repository.id;

          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] Pre-fetched context: userId=${userId}, orgId=${organizationId}, repoId=${repositoryId}`,
          );

          // Create tools
          const tools = {
            bashExecute: createBashExecuteTool(budget),
            upsertKnowledge: createUpsertKnowledgeTool(
              repositoryService,
              {
                userId,
                organizationId,
                workspaceRoot,
                repositoryId,
                gatewayToken,
                secretStorageService,
              },
              (category, success) => {
                if (success) {
                  checkPhaseChange(category);
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

          // Process categories sequentially by phases
          const allAnalysisPhases = [
            {
              id: 1,
              name: "Framework Discovery",
              categories: ["framework", "patterns"],
            },
            {
              id: 2,
              name: "Core Infrastructure",
              categories: ["mocks", "fixtures", "hooks"],
            },
            {
              id: 3,
              name: "Test Details",
              categories: [
                "selectors",
                "routes",
                "assertions",
                "utilities",
                "coverage",
              ],
            },
            { id: 4, name: "Analysis", categories: ["gaps", "improvements"] },
          ];

          // Filter out phases and categories that are already completed
          const skipCategories = options?.skipCategories ?? [];
          const analysisPhases = allAnalysisPhases
            .map((phase) => ({
              ...phase,
              categories: phase.categories.filter(
                (category) => !skipCategories.includes(category),
              ),
            }))
            .filter((phase) => phase.categories.length > 0); // Remove phases with no remaining categories

          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] Resume mode: skipping ${skipCategories.length} categories, analyzing ${analysisPhases.length} phases`,
          );

          let totalEntryCount = 0;

          for (const phase of analysisPhases) {
            progressCallback?.({
              type: "phase_started",
              phaseId: phase.id,
              phaseName: phase.name,
            });

            for (const category of phase.categories) {
              progressCallback?.({
                type: "progress",
                message: `Analyzing ${category}...`,
              });

              // Generate category-specific prompt
              const prompt =
                KnowledgeBasePromptFactory.analyzeCategory(category);

              yield* Effect.logDebug(
                `[KnowledgeBaseAgent:${correlationId}] Analyzing category: ${category}`,
              );
              yield* Effect.logDebug(
                `[KnowledgeBaseAgent:${correlationId}] Prompt length: ${prompt.length} chars`,
              );

              // Run AI analysis for this category
              const aiStartTime = Date.now();
              const streamResult = yield* Effect.try({
                try: () =>
                  streamText({
                    model: xai(AIModels.knowledgeBase.analysis),
                    tools,
                    maxRetries: 0,
                    stopWhen: stepCountIs(20), // Limited steps per category
                    messages: [
                      {
                        role: "system",
                        content:
                          "You are a focused Testing Knowledge Base Analyzer. Analyze the specified category efficiently and call upsertKnowledge exactly once.",
                      },
                      {
                        role: "user",
                        content: prompt,
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

              // Process stream for this category
              const eventStream = streamFromAI(streamResult);
              let categoryEntryCount = 0;

              yield* eventStream.pipe(
                Stream.mapError(
                  (error) =>
                    new KnowledgeBaseAgentError({
                      message:
                        error instanceof Error
                          ? error.message
                          : "Unknown error",
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
                              `[KnowledgeBaseAgent:${correlationId}] [${category}] AI text: ${event.content}`,
                            );
                          }
                        });
                      }),
                      Match.when("tool-call", () => {
                        return Effect.gen(function* () {
                          yield* Effect.logDebug(
                            `[KnowledgeBaseAgent:${correlationId}] [${category}] Tool call: ${event.toolName}`,
                          );
                          if (event.toolArgs) {
                            const argsStr = JSON.stringify(
                              event.toolArgs,
                              null,
                              2,
                            );
                            const truncated =
                              argsStr.length > 500
                                ? `${argsStr.substring(0, 500)}... (truncated)`
                                : argsStr;
                            yield* Effect.logDebug(
                              `[KnowledgeBaseAgent:${correlationId}] [${category}] Args: ${truncated}`,
                            );
                          }

                          // Special logging for upsertKnowledge
                          if (event.toolName === "upsertKnowledge") {
                            categoryEntryCount++;
                            yield* Effect.logDebug(
                              `[KnowledgeBaseAgent:${correlationId}] [${category}] Storing knowledge entry #${categoryEntryCount}`,
                            );
                          }
                        });
                      }),
                      Match.when("tool-result", () => {
                        return Effect.gen(function* () {
                          yield* Effect.logDebug(
                            `[KnowledgeBaseAgent:${correlationId}] [${category}] Tool result: ${event.toolName}`,
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
                              `[KnowledgeBaseAgent:${correlationId}] [${category}] Result: ${truncated}`,
                            );
                          }
                        });
                      }),
                      Match.when("step-finish", () => {
                        return Effect.logDebug(
                          `[KnowledgeBaseAgent:${correlationId}] [${category}] Step finished`,
                        );
                      }),
                      Match.when("finish", () => {
                        return Effect.logDebug(
                          `[KnowledgeBaseAgent:${correlationId}] [${category}] Analysis finished`,
                        );
                      }),
                      Match.orElse(() => Effect.void),
                    );
                    return yield* effect;
                  }),
                ),
              );

              // Get final result for extraction (await after stream processing)
              const result = yield* Effect.promise(async () => {
                return await streamResult;
              });

              // CRITICAL: Await steps to ensure all tool executions complete
              const awaitedSteps = yield* Effect.promise(async () => {
                return await result.steps;
              });
              const aiDuration = Date.now() - aiStartTime;

              yield* Effect.logDebug(
                `[KnowledgeBaseAgent:${correlationId}] [${category}] Steps: ${awaitedSteps.length}`,
              );

              yield* Effect.logDebug(
                `[KnowledgeBaseAgent:${correlationId}] [${category}] Completed in ${aiDuration}ms`,
              );

              // Emit category completion
              progressCallback?.({
                type: "category_complete",
                category,
                entryCount: categoryEntryCount,
              });

              totalEntryCount += categoryEntryCount;
            }

            // Emit phase completion
            progressCallback?.({
              type: "phase_complete",
              phaseId: phase.id,
              totalEntries: totalEntryCount,
            });
          }

          const totalDuration = Date.now() - startTime;
          yield* Effect.logDebug(
            `[KnowledgeBaseAgent:${correlationId}] All phases completed in ${totalDuration}ms. Total entries: ${totalEntryCount}`,
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
