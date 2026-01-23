import { Effect } from "effect";
import { loadCommand } from "../../../utils/command-loader";
import type { BuildConfig } from "../types";
import { PromptBuildError } from "../types";

/**
 * Command file section
 * Loads the main command file (plan.md or build.md)
 */
export const commandFile = (
  config: BuildConfig,
): Effect.Effect<string, PromptBuildError> =>
  Effect.gen(function* () {
    const { mode, workspaceRoot } = config;

    if (!mode) {
      return yield* Effect.fail(
        new PromptBuildError({
          message: "Mode is required to load command file",
        }),
      );
    }

    // Load the appropriate command file based on mode
    const commandName = mode;
    const command = loadCommand(commandName, workspaceRoot);

    if (!command) {
      return yield* Effect.fail(
        new PromptBuildError({
          message: `Command file not found: ${commandName}.md`,
        }),
      );
    }

    return command.content;
  });
