import type { LanguageModel } from "ai";
import { tool } from "ai";
import { Effect, Runtime } from "effect";
import { z } from "zod";
import { countTokensInText } from "../../../utils/token-utils.js";
import { getMessagesToKeep, type Message } from "../context-tracker.js";
import type { SummaryService } from "../summary-service.js";

/**
 * Create a summarizeContext tool that the AI can call during execution
 * to free up context by summarizing older messages
 */
interface SummarizeResult {
  success: boolean;
  summary?: string;
  messagesSummarized?: number;
  tokensFreed?: number;
  error?: string;
}

export const createSummarizeContextTool = (
  summaryService: SummaryService,
  model: LanguageModel,
  getMessages: Effect.Effect<Message[]>,
  updateMessages: (messages: Message[]) => Effect.Effect<void>,
  progressCallback?: (status: string, message: string) => void,
  getPersistentContext?: Effect.Effect<string>,
) => {
  const runtime = Runtime.defaultRuntime;

  return tool({
    description: `Summarize older conversation history to free up context window space. 
    Use this when you're running low on context or when you need to make room for more work.
    
    This tool will:
    1. Take the oldest messages (keeping the most recent for immediate context)
    2. Create a concise summary preserving key information
    3. Replace the old messages with the summary
    
    The summary will preserve critical information like decisions, findings, file paths, and current state.`,
    inputSchema: z.object({
      focus: z
        .string()
        .optional()
        .describe(
          "Optional: What to focus on in the summary (e.g., 'test strategies', 'file analysis', 'tool results')",
        ),
    }),
    execute: async ({
      focus,
    }: {
      focus?: string;
    }): Promise<SummarizeResult> => {
      return Runtime.runPromise(runtime)(
        Effect.gen(function* () {
          progressCallback?.(
            "summarizing",
            "Summarizing conversation history...",
          );

          const allMessages = yield* getMessages;
          const messagesToKeep = getMessagesToKeep();

          // Validation check
          if (allMessages.length <= messagesToKeep) {
            return {
              success: false,
              error: `Not enough messages to summarize. Need more than ${messagesToKeep} messages.`,
            };
          }

          // Separate messages
          const messagesToSummarize = allMessages.slice(
            0,
            allMessages.length - messagesToKeep,
          );
          const messagesToKeepArray = allMessages.slice(-messagesToKeep);

          // Count tokens before
          const tokensBefore = yield* Effect.sync(() =>
            messagesToSummarize.reduce(
              (total, msg) => total + countTokensInText(msg.content),
              0,
            ),
          );

          // Get persistent context if available
          const persistentContext = getPersistentContext
            ? yield* getPersistentContext.pipe(
                Effect.catchAll(() => Effect.succeed("")),
              )
            : undefined;

          // Generate summary using SummaryService
          const summary = yield* summaryService
            .summarizeMessages(
              messagesToSummarize,
              model,
              focus,
              persistentContext,
            )
            .pipe(
              Effect.catchAll((error) =>
                Effect.fail(
                  error instanceof Error ? error : new Error(String(error)),
                ),
              ),
            );
          const tokensAfter = countTokensInText(summary);
          const tokensFreed = tokensBefore - tokensAfter;

          // Update messages
          const summarizedMessage: Message = {
            role: "system",
            content: `Previous conversation summary (${messagesToSummarize.length} messages summarized):\n\n${summary}`,
          };

          yield* updateMessages([summarizedMessage, ...messagesToKeepArray]);

          progressCallback?.(
            "summarized",
            "Summarized " +
              messagesToSummarize.length +
              " messages, freed " +
              tokensFreed +
              " tokens",
          );

          return {
            success: true,
            summary,
            messagesSummarized: messagesToSummarize.length,
            tokensFreed,
          };
        }).pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
              progressCallback?.(
                "summarize_error",
                `Failed to summarize: ${errorMessage}`,
              );
              return {
                success: false,
                error: errorMessage,
              };
            }),
          ),
        ),
      );
    },
  });
};
