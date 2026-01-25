import { Effect } from "effect";
import { SectionId, sections } from "./sections";
import type { BuildConfig, PromptBuildError } from "./types";

/**
 * PromptService - builds system prompts for TUI Claude CLI execution
 *
 * Provides a single source of truth for prompt construction using
 * composable sections and mode-specific templates.
 */
export class PromptService extends Effect.Service<PromptService>()(
  "PromptService",
  {
    effect: Effect.gen(function* () {
      /**
       * Build a complete system prompt for the given mode
       */
      const buildPrompt = (config: BuildConfig) =>
        Effect.gen(function* () {
          const { mode } = config;

          if (!mode) {
            return yield* Effect.fail(
              new Error("Mode is required to build prompt") as PromptBuildError,
            );
          }

          // Build all sections in order
          const commandFileContent =
            yield* sections[SectionId.CommandFile](config);
          const workspaceContextContent =
            yield* sections[SectionId.WorkspaceContext](config);
          const issueTrackerContextContent =
            yield* sections[SectionId.IssueTrackerContext](config);
          const terminalFormattingContent =
            yield* sections[SectionId.TerminalFormatting](config);
          const conversationContextContent =
            yield* sections[SectionId.ConversationContext](config);

          // Compose all sections into final prompt
          const prompt = [
            commandFileContent,
            workspaceContextContent,
            issueTrackerContextContent,
            terminalFormattingContent,
            conversationContextContent,
          ]
            .filter((section) => section.trim().length > 0)
            .join("\n");

          return prompt;
        });

      return {
        /**
         * Build system prompt for plan or build mode
         */
        buildPrompt,
      };
    }),
  },
) {}

/**
 * Live layer for PromptService
 */
export const PromptServiceLive = PromptService.Default;
