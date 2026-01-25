/**
 * View mode types for the TUI
 * Matches the flow from Go TUI: Setup -> Selection -> Main
 */

export type ViewMode = 'setup' | 'selection' | 'modeSelection' | 'reviewCredentials' | 'main' | 'help';

/**
 * Mode type for Plan vs Build vs Review selection
 */
export type CliveMode = 'plan' | 'build' | 'review';

/**
 * Credentials for review mode browser testing
 */
export interface ReviewCredentials {
  email?: string;
  password?: string;
  baseUrl?: string;  // e.g., http://localhost:3000
  skipAuth?: boolean;  // If app doesn't require auth
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
}
