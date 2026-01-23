import type { Effect } from "effect";
import type { BuildConfig, PromptBuildError } from "../types";
import { commandFile } from "./command-file";
import { conversationContext } from "./conversation-context";
import { issueTrackerContext } from "./issue-tracker-context";
import { terminalFormatting } from "./terminal-formatting";
import { workspaceContext } from "./workspace-context";

/**
 * Section type - a function that builds a section of the prompt
 */
export type Section = (
  config: BuildConfig,
) => Effect.Effect<string, PromptBuildError>;

/**
 * Section IDs for type-safe section references
 */
export const SectionId = {
  CommandFile: "COMMAND_FILE",
  WorkspaceContext: "WORKSPACE_CONTEXT",
  IssueTrackerContext: "ISSUE_TRACKER_CONTEXT",
  TerminalFormatting: "TERMINAL_FORMATTING",
  ConversationContext: "CONVERSATION_CONTEXT",
} as const;

export type SectionId = (typeof SectionId)[keyof typeof SectionId];

/**
 * Section registry - maps section IDs to section implementations
 */
export const sections: Record<SectionId, Section> = {
  [SectionId.CommandFile]: commandFile,
  [SectionId.WorkspaceContext]: workspaceContext,
  [SectionId.IssueTrackerContext]: issueTrackerContext,
  [SectionId.TerminalFormatting]: terminalFormatting,
  [SectionId.ConversationContext]: conversationContext,
};
