/**
 * View mode types for the TUI
 * Matches the flow from Go TUI: Setup -> Selection -> Main
 */

export type ViewMode = 'setup' | 'mode_selection' | 'worker_setup' | 'worker' | 'selection' | 'main' | 'help';

/**
 * Worker configuration for connecting to central Slack service
 */
export interface WorkerConfig {
  /** Whether worker mode is enabled */
  enabled: boolean;
  /** WebSocket URL of the central service (e.g., wss://slack-central-production.up.railway.app/ws) */
  centralUrl: string;
  /** Worker API token for authentication */
  token: string;
  /** Whether to auto-connect on startup (default: true) */
  autoConnect?: boolean;
}

/**
 * Config interface for issue tracker setup
 */
export interface IssueTrackerConfig {
  issueTracker: 'linear' | 'beads' | null;
  linear?: {
    apiKey: string;
    teamID: string;
  };
  beads?: {
    // Beads uses local git-based issue tracking
    // No additional config needed
  };
  /** Worker configuration for Slack integration */
  worker?: WorkerConfig;
}
