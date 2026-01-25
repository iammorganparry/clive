import { Data, Effect } from "effect";
import type * as vscode from "vscode";
import { type AiProviderType, GlobalStateKeys } from "../constants.js";

class SettingsError extends Data.TaggedError("SettingsError")<{
  message: string;
  operation: string;
}> {}

/**
 * Service for managing user preferences using VS Code globalState
 */
export class SettingsService extends Effect.Service<SettingsService>()(
  "SettingsService",
  {
    effect: Effect.gen(function* () {
      // GlobalState is injected via the layer
      let globalState: vscode.Memento | null = null;

      const ensureGlobalState = () => {
        if (!globalState) {
          throw new Error("GlobalState not initialized");
        }
        return globalState;
      };

      return {
        /**
         * Initialize the service with globalState from extension context
         */
        setGlobalState: (state: vscode.Memento) => {
          globalState = state;
        },

        /**
         * Check if onboarding has been completed
         * @returns true if onboarding is complete, false otherwise
         */
        isOnboardingComplete: () =>
          Effect.sync(() => {
            const state = ensureGlobalState();
            return (
              state.get<boolean>(GlobalStateKeys.onboardingComplete) ?? false
            );
          }),

        /**
         * Mark onboarding as complete
         */
        setOnboardingComplete: (complete: boolean) =>
          Effect.tryPromise({
            try: async () => {
              const state = ensureGlobalState();
              await state.update(GlobalStateKeys.onboardingComplete, complete);
            },
            catch: (error) =>
              new SettingsError({
                message: error instanceof Error ? error.message : String(error),
                operation: "setOnboardingComplete",
              }),
          }),

        /**
         * Get user-configured base branch
         * @returns configured base branch name or null for auto-detect
         */
        getBaseBranch: () =>
          Effect.sync(() => {
            const state = ensureGlobalState();
            return state.get<string | null>(GlobalStateKeys.baseBranch) ?? null;
          }),

        /**
         * Set user-configured base branch
         * @param branch - branch name or null to use auto-detect
         */
        setBaseBranch: (branch: string | null) =>
          Effect.tryPromise({
            try: async () => {
              const state = ensureGlobalState();
              await state.update(GlobalStateKeys.baseBranch, branch);
            },
            catch: (error) =>
              new SettingsError({
                message: error instanceof Error ? error.message : String(error),
                operation: "setBaseBranch",
              }),
          }),

        /**
         * Get terminal command approval setting
         * @returns "always" to always ask for approval, "auto" to auto-approve
         */
        getTerminalCommandApproval: () =>
          Effect.sync(() => {
            const state = ensureGlobalState();
            return (
              (state.get<"always" | "auto">(
                GlobalStateKeys.terminalCommandApproval,
              ) as "always" | "auto" | undefined) ?? "always"
            );
          }),

        /**
         * Set terminal command approval setting
         * @param value - "always" to always ask for approval, "auto" to auto-approve
         */
        setTerminalCommandApproval: (value: "always" | "auto") =>
          Effect.tryPromise({
            try: async () => {
              const state = ensureGlobalState();
              await state.update(
                GlobalStateKeys.terminalCommandApproval,
                value,
              );
            },
            catch: (error) =>
              new SettingsError({
                message: error instanceof Error ? error.message : String(error),
                operation: "setTerminalCommandApproval",
              }),
          }),

        /**
         * Get AI provider preference
         * @returns "anthropic" | "gateway" | "claude-cli", defaults to "gateway"
         */
        getAiProvider: () =>
          Effect.sync(() => {
            const state = ensureGlobalState();
            return (
              (state.get<AiProviderType>(GlobalStateKeys.aiProvider) as
                | AiProviderType
                | undefined) ?? "gateway"
            );
          }),

        /**
         * Set AI provider preference
         * @param provider - "anthropic" | "gateway" | "claude-cli"
         */
        setAiProvider: (provider: AiProviderType) =>
          Effect.tryPromise({
            try: async () => {
              const state = ensureGlobalState();
              await state.update(GlobalStateKeys.aiProvider, provider);
            },
            catch: (error) =>
              new SettingsError({
                message: error instanceof Error ? error.message : String(error),
                operation: "setAiProvider",
              }),
          }),
      };
    }),
  },
) {}

/**
 * Create a SettingsService layer with the globalState from extension context
 */
export function createSettingsServiceLayer(context: vscode.ExtensionContext) {
  return Effect.sync(() => {
    const globalState = context.globalState;

    return {
      _tag: "SettingsService" as const,
      setGlobalState: (_state: vscode.Memento) => {
        // Already initialized with context.globalState
      },

      isOnboardingComplete: () =>
        Effect.sync(() => {
          return (
            globalState.get<boolean>(GlobalStateKeys.onboardingComplete) ??
            false
          );
        }),

      setOnboardingComplete: (complete: boolean) =>
        Effect.tryPromise({
          try: async () => {
            await globalState.update(
              GlobalStateKeys.onboardingComplete,
              complete,
            );
          },
          catch: (error) =>
            new SettingsError({
              message: error instanceof Error ? error.message : String(error),
              operation: "setOnboardingComplete",
            }),
        }),

      getBaseBranch: () =>
        Effect.sync(() => {
          return (
            globalState.get<string | null>(GlobalStateKeys.baseBranch) ?? null
          );
        }),

      setBaseBranch: (branch: string | null) =>
        Effect.tryPromise({
          try: async () => {
            await globalState.update(GlobalStateKeys.baseBranch, branch);
          },
          catch: (error) =>
            new SettingsError({
              message: error instanceof Error ? error.message : String(error),
              operation: "setBaseBranch",
            }),
        }),

      getTerminalCommandApproval: () =>
        Effect.sync(() => {
          return (
            (globalState.get<"always" | "auto">(
              GlobalStateKeys.terminalCommandApproval,
            ) as "always" | "auto" | undefined) ?? "always"
          );
        }),

      setTerminalCommandApproval: (value: "always" | "auto") =>
        Effect.tryPromise({
          try: async () => {
            await globalState.update(
              GlobalStateKeys.terminalCommandApproval,
              value,
            );
          },
          catch: (error) =>
            new SettingsError({
              message: error instanceof Error ? error.message : String(error),
              operation: "setTerminalCommandApproval",
            }),
        }),

      getAiProvider: () =>
        Effect.sync(() => {
          return (
            (globalState.get<AiProviderType>(GlobalStateKeys.aiProvider) as
              | AiProviderType
              | undefined) ?? "gateway"
          );
        }),

      setAiProvider: (provider: AiProviderType) =>
        Effect.tryPromise({
          try: async () => {
            await globalState.update(GlobalStateKeys.aiProvider, provider);
          },
          catch: (error) =>
            new SettingsError({
              message: error instanceof Error ? error.message : String(error),
              operation: "setAiProvider",
            }),
        }),
    };
  });
}
