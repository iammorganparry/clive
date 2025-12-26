import { generateText, type LanguageModel } from "ai";
import { Data, Effect } from "effect";
import type { Message } from "./context-tracker.js";

export class SummaryError extends Data.TaggedError("SummaryError")<{
  message: string;
  cause?: unknown;
}> {}

export class SummaryService extends Effect.Service<SummaryService>()(
  "SummaryService",
  {
    effect: Effect.gen(function* () {
      return {
        /**
         * Summarize a list of messages using the provided AI model
         * @param persistentContext - Knowledge context that must be preserved verbatim (not summarized)
         */
        summarizeMessages: (
          messagesToSummarize: Message[],
          model: LanguageModel,
          focus?: string,
          persistentContext?: string,
        ) =>
          Effect.gen(function* () {
            const persistentContextSection = persistentContext
              ? `\n\n## CRITICAL: Preserve This Knowledge Context Verbatim\n\nThe following knowledge base information MUST be preserved exactly as-is in the summary. Do NOT summarize or compress this section - include it verbatim:\n\n${persistentContext}\n\n---\n\n`
              : "";

            const basePrompt = `Summarize this conversation history concisely, preserving:
                1. Key decisions made and their rationale
                2. Important findings from tool executions
                3. Current task state and next steps
                4. Any file paths, code snippets, or test names that are critical
                ${persistentContext ? "5. The persistent knowledge context section below MUST be included verbatim" : ""}

                Keep the summary under 2000 tokens while retaining all actionable information.
                ${persistentContext ? "The persistent knowledge context does NOT count toward the 2000 token limit - include it separately." : ""}
                ${persistentContextSection}
                Conversation to summarize:
                ${messagesToSummarize.map((msg) => `${msg.role}: ${msg.content}`).join("\n\n")}`;

            const summaryPrompt = focus
              ? `${basePrompt}\n\nFocus on: ${focus}`
              : basePrompt;

            const summaryResult = yield* Effect.tryPromise({
              try: () =>
                generateText({
                  model,
                  prompt: summaryPrompt,
                }),
              catch: (error) =>
                new SummaryError({
                  message:
                    error instanceof Error
                      ? error.message
                      : "Failed to summarize context",
                  cause: error,
                }),
            });

            return summaryResult.text;
          }),
      };
    }),
  },
) {}

export const SummaryServiceLive = SummaryService.Default;
