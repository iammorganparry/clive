import { Effect } from "effect";
import type * as vscode from "vscode";
import { GlobalStateKeys } from "../constants.js";

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
         * Check if codebase indexing is enabled
         * @returns true if indexing is enabled, false otherwise (default: false - opt-in)
         */
        isIndexingEnabled: () =>
          Effect.sync(() => {
            const state = ensureGlobalState();
            return state.get<boolean>(GlobalStateKeys.indexingEnabled) ?? false;
          }),

        /**
         * Set the indexing enabled preference
         */
        setIndexingEnabled: (enabled: boolean) =>
          Effect.promise(async () => {
            const state = ensureGlobalState();
            await state.update(GlobalStateKeys.indexingEnabled, enabled);
          }),

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
          Effect.promise(async () => {
            const state = ensureGlobalState();
            await state.update(GlobalStateKeys.onboardingComplete, complete);
          }),
      };
    }),
  },
) {}

/**
 * Create a SettingsService layer with the globalState from extension context
 */
export function createSettingsServiceLayer(context: vscode.ExtensionContext) {
  return Effect.gen(function* () {
    const service = yield* SettingsService;
    service.setGlobalState(context.globalState);
    return service;
  });
}
