/**
 * View mode types for the TUI
 * Matches the flow from Go TUI: Setup -> Selection -> Main
 */

export type ViewMode = 'setup' | 'selection' | 'main' | 'help';

/**
 * Config interface for issue tracker setup
 */
export interface IssueTrackerConfig {
  tracker: 'linear' | 'github' | null;
  linear?: {
    apiKey: string;
    teamID: string;
  };
  github?: {
    token: string;
    owner: string;
    repo: string;
  };
}
