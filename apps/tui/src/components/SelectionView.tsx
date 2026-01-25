/**
 * SelectionView Component
 * Session/Conversation selection screen
 * Shows list of recent conversations and epics with search and selection
 */

import { useMemo } from "react";
import type { Conversation } from "../services/ConversationService";
import { OneDarkPro } from "../styles/theme";
import type { Session } from "../types";
import { LoadingSpinner } from "./LoadingSpinner";

/**
 * Special session ID for the "Other Conversations" group
 */
const UNATTACHED_GROUP_ID = "__unattached__";

/**
 * Format timestamp as relative time
 */
function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

interface SelectionViewProps {
  width: number;
  height: number;
  sessions: Session[];
  conversations: Conversation[];
  sessionsLoading: boolean;
  conversationsLoading: boolean;
  sessionsError?: Error | null;
  conversationsError?: Error | null;
  selectedIndex: number;
  searchQuery: string;
  selectedIssue: Session | null; // null = show issues, Session = show conversations for this issue
  onSelectIssue: (session: Session) => void;
  onResumeConversation: (conversation: Conversation) => void;
  onCreateNew: (issue?: Session) => void;
  onBack: () => void;
}

export function SelectionView({
  width,
  height,
  sessions,
  conversations,
  sessionsLoading,
  conversationsLoading,
  sessionsError,
  conversationsError,
  selectedIndex,
  searchQuery,
  selectedIssue,
  onSelectIssue,
  onResumeConversation,
  onCreateNew,
  onBack,
}: SelectionViewProps) {
  // Separate conversations into attached and unattached
  const { attachedConversations, unattachedConversations } = useMemo(() => {
    const attached: Conversation[] = [];
    const unattached: Conversation[] = [];

    conversations.forEach((conv) => {
      if (conv.linearProjectId || conv.linearTaskId) {
        attached.push(conv);
      } else {
        unattached.push(conv);
      }
    });

    // Sort unattached by timestamp (newest first)
    unattached.sort((a, b) => b.timestamp - a.timestamp);

    return {
      attachedConversations: attached,
      unattachedConversations: unattached,
    };
  }, [conversations]);

  // Create "Other Conversations" group if there are unattached conversations
  const issuesWithOther = useMemo(() => {
    const items: Session[] = [];

    // Always add "Other Conversations" at the TOP if there are unattached conversations
    if (unattachedConversations.length > 0) {
      items.push({
        id: UNATTACHED_GROUP_ID,
        name: `Other Conversations (${unattachedConversations.length})`,
        createdAt: new Date(),
        source: "linear" as const,
        // No linearData - this marks it as the unattached group
      });
    }

    // Add all Linear sessions after
    items.push(...sessions);

    return items;
  }, [sessions, unattachedConversations.length]);

  // Level 1: Show issues (when selectedIssue is null)
  // Level 2: Show conversations for selected issue (when selectedIssue is set)

  if (!selectedIssue) {
    // Level 1: Filter sessions/issues by search query (including "Other Conversations")
    const filteredSessions = searchQuery
      ? issuesWithOther.filter((s) => {
          const query = searchQuery.toLowerCase();
          const identifier = s.linearData?.identifier?.toLowerCase() || "";
          const title = s.name.toLowerCase();
          return identifier.includes(query) || title.includes(query);
        })
      : issuesWithOther;

    const displayIssues = filteredSessions.slice(0, 10);
    const totalDisplayed = displayIssues.length;

    return (
      <box
        width={width}
        height={height}
        backgroundColor={OneDarkPro.background.primary}
        alignItems="center"
        justifyContent="center"
        flexDirection="column"
      >
        <box flexDirection="column" alignItems="center" width={50}>
          {/* Header */}
          <box flexDirection="row">
            <text fg={OneDarkPro.syntax.red} bold>
              CLIVE
            </text>
            <text fg={OneDarkPro.foreground.muted}>{" · Select Issue"}</text>
          </box>

          {/* Loading state - wait for both sessions and conversations */}
          {(sessionsLoading || conversationsLoading) && (
            <box marginTop={3}>
              <LoadingSpinner
                text={
                  sessionsLoading && conversationsLoading
                    ? "Loading issues and conversations..."
                    : sessionsLoading
                      ? "Loading issues..."
                      : "Loading conversations..."
                }
                color={OneDarkPro.syntax.yellow}
              />
            </box>
          )}

          {/* Error state */}
          {!sessionsLoading && !conversationsLoading && sessionsError && (
            <box
              marginTop={3}
              flexDirection="column"
              alignItems="center"
              width={70}
            >
              <text fg={OneDarkPro.syntax.red}>
                Failed to load Linear issues:
              </text>
              <text fg={OneDarkPro.foreground.primary} marginTop={1}>
                {sessionsError.message}
              </text>
              <box marginTop={2} flexDirection="column" alignItems="flex-start">
                <text fg={OneDarkPro.foreground.muted}>
                  • Check that your Linear API key is set correctly
                </text>
                <text fg={OneDarkPro.foreground.muted}>
                  • Verify your team ID is correct
                </text>
                <text fg={OneDarkPro.foreground.muted}>
                  • Run the Linear setup flow again if needed
                </text>
              </box>
              <text fg={OneDarkPro.foreground.muted} marginTop={2}>
                Press Esc to go back or q to quit
              </text>
            </box>
          )}

          {/* Empty state */}
          {!sessionsLoading &&
            !conversationsLoading &&
            !sessionsError &&
            issuesWithOther.length === 0 && (
              <box marginTop={3} flexDirection="column" alignItems="center">
                <text fg={OneDarkPro.foreground.muted}>
                  No Linear issues or conversations found.
                </text>
                <text fg={OneDarkPro.foreground.muted} marginTop={1}>
                  Use ↑↓ to select "Create New Session" and press Enter.
                </text>
              </box>
            )}

          {/* Issue list */}
          {!sessionsLoading &&
            !conversationsLoading &&
            !sessionsError &&
            issuesWithOther.length > 0 && (
              <box marginTop={2} flexDirection="column" width={70}>
                {/* Search box */}
                <box
                  backgroundColor={
                    searchQuery
                      ? OneDarkPro.background.highlight
                      : OneDarkPro.background.secondary
                  }
                  borderStyle="single"
                  borderColor={
                    searchQuery ? OneDarkPro.syntax.green : OneDarkPro.ui.border
                  }
                  paddingLeft={1}
                  paddingRight={1}
                  marginBottom={1}
                  flexDirection="row"
                >
                  <text fg={OneDarkPro.syntax.green}>🔍 </text>
                  <text
                    fg={
                      searchQuery
                        ? OneDarkPro.foreground.primary
                        : OneDarkPro.foreground.muted
                    }
                  >
                    {searchQuery || "Type to search..."}
                  </text>
                </box>

                {/* Count */}
                <text fg={OneDarkPro.foreground.muted}>
                  {totalDisplayed} of {filteredSessions.length}
                  {searchQuery
                    ? ` (${issuesWithOther.length} total)`
                    : " items"}
                </text>

                {/* Items */}
                {totalDisplayed === 0 && searchQuery ? (
                  <text fg={OneDarkPro.foreground.muted}>
                    No matching issues. Try a different search.
                  </text>
                ) : (
                  <>
                    {/* Create New option (only show when not searching) */}
                    {!searchQuery && (
                      <box
                        key="create-new"
                        backgroundColor={
                          selectedIndex === -1
                            ? OneDarkPro.background.highlight
                            : "transparent"
                        }
                        paddingLeft={1}
                        paddingRight={1}
                        marginBottom={1}
                      >
                        <text
                          fg={
                            selectedIndex === -1
                              ? OneDarkPro.syntax.green
                              : OneDarkPro.syntax.cyan
                          }
                        >
                          {selectedIndex === -1 ? "▸ " : "  "}✨ Create New
                          Session
                        </text>
                      </box>
                    )}

                    {/* Linear issues and Other Conversations */}
                    {displayIssues.map((session, i) => {
                      const isSelected = i === selectedIndex;
                      const isUnattachedGroup =
                        session.id === UNATTACHED_GROUP_ID;

                      // Get identifier from linearData if available
                      const identifier = session.linearData?.identifier || "";
                      const prefix = identifier ? `${identifier} ` : "";
                      const maxNameLength = identifier ? 30 : 35;

                      const name =
                        session.name.length > maxNameLength
                          ? `${session.name.substring(0, maxNameLength - 1)}…`
                          : session.name;

                      // Use different icon and styling for unattached group
                      const icon = isUnattachedGroup ? "💬" : "📋";

                      return (
                        <box
                          key={session.id}
                          backgroundColor={
                            isSelected
                              ? OneDarkPro.background.highlight
                              : "transparent"
                          }
                          paddingLeft={1}
                          paddingRight={1}
                          borderStyle={
                            isUnattachedGroup && !isSelected
                              ? "single"
                              : undefined
                          }
                          borderColor={
                            isUnattachedGroup && !isSelected
                              ? OneDarkPro.syntax.cyan
                              : undefined
                          }
                        >
                          <text
                            fg={
                              isSelected
                                ? OneDarkPro.syntax.blue
                                : isUnattachedGroup
                                  ? OneDarkPro.syntax.cyan
                                  : OneDarkPro.foreground.primary
                            }
                            fontWeight={isUnattachedGroup ? "bold" : "normal"}
                          >
                            {isSelected ? "▸ " : "  "}
                            {icon} {identifier ? prefix : ""}
                            {name}
                          </text>
                        </box>
                      );
                    })}
                  </>
                )}
              </box>
            )}

          {/* Keyboard hints */}
          <box marginTop={4} flexDirection="column" alignItems="center">
            <text fg={OneDarkPro.foreground.muted}>
              Type to search • ↑↓ Select • Enter Choose • Esc Back • q Quit
            </text>
          </box>
        </box>
      </box>
    );
  }

  // Level 2: Show conversations for the selected issue
  // Check if this is the "Other Conversations" group
  const isUnattachedGroup = selectedIssue.id === UNATTACHED_GROUP_ID;

  // Filter conversations based on selection
  const conversationsForIssue = isUnattachedGroup
    ? unattachedConversations
    : attachedConversations.filter((c) => {
        const issueLinearId = selectedIssue.linearData?.id;
        return (
          c.linearProjectId === issueLinearId ||
          c.linearTaskId === issueLinearId
        );
      });

  // Filter by search query
  const filteredConversations = searchQuery
    ? conversationsForIssue.filter((c) => {
        const query = searchQuery.toLowerCase();
        const display = c.display.toLowerCase();
        const slug = c.slug?.toLowerCase() || "";
        return display.includes(query) || slug.includes(query);
      })
    : conversationsForIssue;

  const displayConversations = filteredConversations.slice(0, 10);
  const totalDisplayed = displayConversations.length;

  // Level 2: Render conversations for the selected issue
  const issueIdentifier = isUnattachedGroup
    ? "Other Conversations"
    : selectedIssue.linearData?.identifier || "";

  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.primary}
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
    >
      <box flexDirection="column" alignItems="center" width={50}>
        {/* Header with issue identifier or "Other Conversations" */}
        <box flexDirection="row">
          <text fg={OneDarkPro.syntax.red} bold>
            CLIVE
          </text>
          <text fg={OneDarkPro.foreground.muted}>{" · "}</text>
          <text
            fg={
              isUnattachedGroup
                ? OneDarkPro.syntax.cyan
                : OneDarkPro.syntax.magenta
            }
          >
            {issueIdentifier}
          </text>
          <text fg={OneDarkPro.foreground.muted}>{" · Sessions"}</text>
        </box>

        {/* Loading state */}
        {conversationsLoading && (
          <box marginTop={3}>
            <LoadingSpinner
              text="Loading conversations..."
              color={OneDarkPro.syntax.yellow}
            />
          </box>
        )}

        {/* Empty state */}
        {!conversationsLoading && conversationsForIssue.length === 0 && (
          <box marginTop={3} flexDirection="column" alignItems="center">
            <text fg={OneDarkPro.foreground.muted}>
              No conversations for this issue yet.
            </text>
            <text fg={OneDarkPro.foreground.muted} marginTop={1}>
              Use ↑↓ to select "Create New Session" and press Enter.
            </text>
          </box>
        )}

        {/* Conversation list */}
        {!conversationsLoading &&
          (conversationsForIssue.length > 0 || !searchQuery) && (
            <box marginTop={2} flexDirection="column" width={70}>
              {/* Search box */}
              <box
                backgroundColor={
                  searchQuery
                    ? OneDarkPro.background.highlight
                    : OneDarkPro.background.secondary
                }
                borderStyle="single"
                borderColor={
                  searchQuery ? OneDarkPro.syntax.green : OneDarkPro.ui.border
                }
                paddingLeft={1}
                paddingRight={1}
                marginBottom={1}
                flexDirection="row"
              >
                <text fg={OneDarkPro.syntax.green}>🔍 </text>
                <text
                  fg={
                    searchQuery
                      ? OneDarkPro.foreground.primary
                      : OneDarkPro.foreground.muted
                  }
                >
                  {searchQuery || "Type to search..."}
                </text>
              </box>

              {/* Count */}
              <text fg={OneDarkPro.foreground.muted}>
                {totalDisplayed} of {filteredConversations.length}
                {searchQuery
                  ? ` (${conversationsForIssue.length} total)`
                  : " conversations"}
              </text>

              {/* Items */}
              {totalDisplayed === 0 && searchQuery ? (
                <text fg={OneDarkPro.foreground.muted}>
                  No matching conversations. Try a different search.
                </text>
              ) : (
                <>
                  {/* Create New option (only show when not searching and not in unattached group) */}
                  {!searchQuery && !isUnattachedGroup && (
                    <box
                      key="create-new"
                      backgroundColor={
                        selectedIndex === -1
                          ? OneDarkPro.background.highlight
                          : "transparent"
                      }
                      paddingLeft={1}
                      paddingRight={1}
                      marginBottom={1}
                    >
                      <text
                        fg={
                          selectedIndex === -1
                            ? OneDarkPro.syntax.green
                            : OneDarkPro.syntax.cyan
                        }
                      >
                        {selectedIndex === -1 ? "▸ " : "  "}✨ Create New
                        Session for {issueIdentifier}
                      </text>
                    </box>
                  )}

                  {/* Conversations for this issue */}
                  {displayConversations.map((conversation, i) => {
                    const isSelected = i === selectedIndex;

                    // Format timestamp
                    const date = new Date(conversation.timestamp);
                    const timeAgo = formatTimeAgo(date);

                    // Truncate display message
                    const maxLength = 50;
                    const display =
                      conversation.display.length > maxLength
                        ? `${conversation.display.substring(0, maxLength - 1)}…`
                        : conversation.display;

                    return (
                      <box
                        key={conversation.sessionId}
                        backgroundColor={
                          isSelected
                            ? OneDarkPro.background.highlight
                            : "transparent"
                        }
                        paddingLeft={1}
                        paddingRight={1}
                        flexDirection="row"
                      >
                        <text
                          fg={
                            isSelected
                              ? OneDarkPro.syntax.blue
                              : OneDarkPro.foreground.primary
                          }
                        >
                          {isSelected ? "▸ " : "  "}💬 {display}
                        </text>
                        <text fg={OneDarkPro.foreground.comment}>
                          {" "}
                          ({timeAgo})
                        </text>
                      </box>
                    );
                  })}
                </>
              )}
            </box>
          )}

        {/* Keyboard hints */}
        <box marginTop={4} flexDirection="column" alignItems="center">
          <text fg={OneDarkPro.foreground.muted}>
            Type to search • ↑↓ Select • Enter Resume/Start • Esc{" "}
            {searchQuery ? "Clear" : "Back to Issues"} • q Quit
          </text>
        </box>
      </box>
    </box>
  );
}
