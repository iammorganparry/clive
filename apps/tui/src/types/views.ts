/**
 * View mode types for the TUI
 * Matches the flow from Go TUI: Setup -> Selection -> Main
 */

export type ViewMode = 'setup' | 'selection' | 'main' | 'help';

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
