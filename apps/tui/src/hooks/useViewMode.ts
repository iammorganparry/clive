/**
 * useViewMode Hook
 * Manages view mode transitions using XState: Setup -> Selection -> Main <-> Help
 */

import { useMachine } from "@xstate/react";
import { useEffect } from "react";
import { assign, setup } from "xstate";
import type { IssueTrackerConfig, ViewMode } from "../types/views";
import {
  loadConfig,
  saveConfig,
} from "../utils/config-loader";

/**
 * View Mode State Machine
 * Flow: setup -> mode_selection -> (worker | selection -> main) <-> help
 */
const viewModeMachine = setup({
  types: {
    context: {} as {
      config: IssueTrackerConfig | null;
      previousView: ViewMode | null;
    },
    events: {} as
      | { type: "GO_TO_SETUP" }
      | { type: "GO_TO_MODE_SELECTION" }
      | { type: "GO_TO_WORKER_SETUP" }
      | { type: "GO_TO_WORKER" }
      | { type: "GO_TO_SELECTION" }
      | { type: "GO_TO_MAIN" }
      | { type: "GO_TO_HELP" }
      | { type: "GO_TO_LINEAR_SETTINGS" }
      | { type: "GO_BACK" }
      | { type: "UPDATE_CONFIG"; config: IssueTrackerConfig },
  },
  actions: {
    savePreviousView: assign({
      previousView: ({ context }, currentState: ViewMode) =>
        currentState as ViewMode,
    }),
    updateConfig: assign({
      config: ({ event }) => {
        if (event.type !== "UPDATE_CONFIG") return null;
        saveConfig(event.config);
        return event.config;
      },
    }),
  },
}).createMachine({
  id: "viewMode",
  initial: "setup",
  context: {
    config: null,
    previousView: null,
  },
  states: {
    setup: {
      on: {
        GO_TO_MODE_SELECTION: "mode_selection",
        GO_TO_SELECTION: "selection",
        GO_TO_MAIN: "main",
        UPDATE_CONFIG: {
          target: "mode_selection",
          actions: "updateConfig",
        },
      },
    },
    mode_selection: {
      on: {
        GO_TO_SETUP: "setup",
        GO_TO_WORKER_SETUP: "worker_setup",
        GO_TO_WORKER: "worker",
        GO_TO_SELECTION: "selection",
        GO_TO_LINEAR_SETTINGS: "linear_settings",
        GO_BACK: "setup",
      },
    },
    worker_setup: {
      on: {
        GO_TO_MODE_SELECTION: "mode_selection",
        GO_TO_WORKER: "worker",
        GO_BACK: "mode_selection",
        UPDATE_CONFIG: {
          target: "worker",
          actions: "updateConfig",
        },
      },
    },
    worker: {
      on: {
        GO_TO_MODE_SELECTION: "mode_selection",
        GO_TO_HELP: {
          target: "help",
          actions: assign({
            previousView: "worker",
          }),
        },
        GO_BACK: "mode_selection",
      },
    },
    selection: {
      on: {
        GO_TO_SETUP: "setup",
        GO_TO_MODE_SELECTION: "mode_selection",
        GO_TO_MAIN: "main",
        GO_TO_HELP: {
          target: "help",
          actions: assign({
            previousView: "selection",
          }),
        },
        GO_BACK: "mode_selection",
      },
    },
    main: {
      on: {
        GO_TO_SELECTION: "selection",
        GO_TO_HELP: {
          target: "help",
          actions: assign({
            previousView: "main",
          }),
        },
        GO_BACK: "selection",
      },
    },
    help: {
      on: {
        GO_BACK: [
          {
            target: "main",
            guard: ({ context }) => context.previousView === "main",
          },
          {
            target: "selection",
            guard: ({ context }) => context.previousView === "selection",
          },
          {
            target: "worker",
            guard: ({ context }) => context.previousView === "worker",
          },
          {
            target: "setup",
            guard: ({ context }) => context.previousView === "setup",
          },
        ],
      },
    },
    linear_settings: {
      on: {
        GO_TO_MODE_SELECTION: "mode_selection",
        GO_BACK: "mode_selection",
        UPDATE_CONFIG: {
          target: "mode_selection",
          actions: "updateConfig",
        },
      },
    },
  },
});

export interface ViewModeState {
  viewMode: ViewMode;
  config: IssueTrackerConfig | null;

  // Actions
  goToSetup: () => void;
  goToModeSelection: () => void;
  goToWorkerSetup: () => void;
  goToWorker: () => void;
  goToSelection: () => void;
  goToMain: () => void;
  goToHelp: () => void;
  goToLinearSettings: () => void;
  goBack: () => void;
  updateConfig: (config: IssueTrackerConfig) => void;
}

export function useViewMode(): ViewModeState {
  // Load config and determine initial state
  const loadedConfig = loadConfig();

  const [state, send] = useMachine(viewModeMachine);

  // Navigate to mode_selection if config exists (issue tracker configured)
  useEffect(() => {
    if (loadedConfig?.issueTracker && state.value === "setup") {
      send({ type: "GO_TO_MODE_SELECTION" });
    }
  }, [loadedConfig, send, state.value]); // Only run once on mount

  // Determine current view mode from state
  const viewMode = state.value as ViewMode;

  // Use loadedConfig directly since XState v5 doesn't merge context options properly
  // The state.context.config is updated via UPDATE_CONFIG events
  const config = state.context.config ?? loadedConfig;

  return {
    viewMode,
    config,
    goToSetup: () => send({ type: "GO_TO_SETUP" }),
    goToModeSelection: () => send({ type: "GO_TO_MODE_SELECTION" }),
    goToWorkerSetup: () => send({ type: "GO_TO_WORKER_SETUP" }),
    goToWorker: () => send({ type: "GO_TO_WORKER" }),
    goToSelection: () => send({ type: "GO_TO_SELECTION" }),
    goToMain: () => send({ type: "GO_TO_MAIN" }),
    goToHelp: () => send({ type: "GO_TO_HELP" }),
    goToLinearSettings: () => send({ type: "GO_TO_LINEAR_SETTINGS" }),
    goBack: () => send({ type: "GO_BACK" }),
    updateConfig: (config: IssueTrackerConfig) =>
      send({ type: "UPDATE_CONFIG", config }),
  };
}
