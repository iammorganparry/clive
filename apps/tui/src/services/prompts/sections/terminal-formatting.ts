import { Effect } from "effect";
import type { BuildConfig, PromptBuildError } from "../types";

/**
 * Terminal formatting section
 * Provides instructions for outputting to a terminal interface
 */
export const terminalFormatting = (
  _config: BuildConfig,
): Effect.Effect<string, PromptBuildError> =>
  Effect.succeed(`
IMPORTANT OUTPUT FORMATTING: You are outputting to a terminal interface. Follow these formatting rules:
- Use clear, concise language
- Structure output with headers and sections
- Use bullet points for lists
- Keep line lengths reasonable for terminal display
- Use markdown formatting where appropriate
- Provide progress updates for long-running operations
`);
