/**
 * Assistant Prompts & Constants
 *
 * Loading messages, suggested prompts, and helpers for the Slack AI App surface.
 */

/**
 * Rotating loading status messages shown while Clive is working
 */
export const LOADING_MESSAGES = [
  "Hold on bud, I'm thinkin here...",
  "Workin on it, it's not rocket appliances...",
  "Just give me a sec boys...",
  "Almost got it figured out, worst case Ontario...",
  "I'm on it like a frigging hawk...",
];

/**
 * Suggested prompt shown in the assistant split-view
 */
export interface SuggestedPrompt {
  title: string;
  message: string;
}

/**
 * Default prompts when no channel context is available
 */
export const DEFAULT_PROMPTS: SuggestedPrompt[] = [
  {
    title: "Plan a feature",
    message: "Help me plan a new feature for my project",
  },
  {
    title: "Create Linear issues",
    message: "Help me break down a task into Linear issues",
  },
  {
    title: "Fix a bug",
    message: "Help me debug and fix an issue",
  },
  {
    title: "Review code",
    message: "Help me review recent code changes",
  },
];

/**
 * Context from the assistant thread (channel the user opened the panel from)
 */
export interface AssistantContext {
  channel_id?: string;
  team_id?: string;
  enterprise_id?: string | null;
}

/**
 * Get context-aware suggested prompts based on where the user opened the assistant
 */
export function getContextAwarePrompts(
  context?: AssistantContext,
): SuggestedPrompt[] {
  if (!context?.channel_id) {
    return DEFAULT_PROMPTS;
  }

  // When opened from a specific channel, add channel-specific prompts
  return [
    {
      title: "Plan a feature",
      message: "Help me plan a new feature for this project",
    },
    {
      title: "Create Linear issues",
      message: "Help me break down a task into Linear issues",
    },
    {
      title: "Fix a bug",
      message: "Help me debug and fix an issue in this project",
    },
    {
      title: "Review code",
      message: "Help me review recent code changes",
    },
  ];
}

/**
 * Generate a thread title from the first user message
 * Truncated to ~50 chars for Slack's thread title display
 */
export function generateThreadTitle(message: string): string {
  const cleaned = message.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 50) {
    return cleaned;
  }
  return `${cleaned.substring(0, 47)}...`;
}

/**
 * Get a random loading message
 */
export function getLoadingMessage(): string {
  return LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]!;
}
