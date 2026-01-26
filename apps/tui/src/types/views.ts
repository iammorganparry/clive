/**
 * View mode types for the TUI
 * Matches the flow from Go TUI: Setup -> Selection -> Main
 */

// Re-export config types from the canonical source
export type {
  Config as IssueTrackerConfig,
  LinearConfig,
  WorkerConfig,
} from "./index";

export type ViewMode =
  | "setup"
  | "mode_selection"
  | "worker_setup"
  | "worker"
  | "selection"
  | "main"
  | "help"
  | "linear_settings";
