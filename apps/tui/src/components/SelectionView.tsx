/**
 * SelectionView Component
 * Session/Conversation selection screen
 * Shows list of recent conversations and epics with search and selection
 */

import { OneDarkPro } from '../styles/theme';
import { Session } from '../types';
import { LoadingSpinner } from './LoadingSpinner';
import type { Conversation } from '../services/ConversationService';

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
  return 'just now';
}

interface SelectionViewProps {
  width: number;
  height: number;
  sessions: Session[];
  conversations: Conversation[];
  sessionsLoading: boolean;
  conversationsLoading: boolean;
  selectedIndex: number;
  searchQuery: string;
  onSelect: (session: Session) => void;
  onResumeConversation: (conversation: Conversation) => void;
  onCreateNew: () => void;
  onBack: () => void;
}

export function SelectionView({
  width,
  height,
  sessions,
  conversations,
  sessionsLoading,
  conversationsLoading,
  selectedIndex,
  searchQuery,
  onSelect,
  onResumeConversation,
  onCreateNew,
  onBack,
}: SelectionViewProps) {
  // Filter conversations by search query (search display message and slug)
  const filteredConversations = searchQuery
    ? conversations.filter(c => {
        const query = searchQuery.toLowerCase();
        const display = c.display.toLowerCase();
        const slug = c.slug?.toLowerCase() || '';
        return display.includes(query) || slug.includes(query);
      })
    : conversations;

  // Filter sessions by search query (search both identifier and title)
  const filteredSessions = searchQuery
    ? sessions.filter(s => {
        const query = searchQuery.toLowerCase();
        const identifier = s.linearData?.identifier?.toLowerCase() || '';
        const title = s.name.toLowerCase();
        return identifier.includes(query) || title.includes(query);
      })
    : sessions;

  // Combine conversations and sessions (conversations first)
  const displayConversations = filteredConversations.slice(0, 7);
  const displaySessions = filteredSessions.slice(0, 3);
  const totalDisplayed = displayConversations.length + displaySessions.length;

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
          <text fg={OneDarkPro.foreground.muted}>
            {' · Resume or Start Session'}
          </text>
        </box>

        {/* Loading state */}
        {(conversationsLoading || sessionsLoading) && (
          <box marginTop={3}>
            <LoadingSpinner text="Loading sessions..." color={OneDarkPro.syntax.yellow} />
          </box>
        )}

        {/* Empty state */}
        {!conversationsLoading && !sessionsLoading && conversations.length === 0 && sessions.length === 0 && (
          <box marginTop={3} flexDirection="column" alignItems="center">
            <text fg={OneDarkPro.foreground.muted}>
              No recent sessions found.
            </text>
            <text fg={OneDarkPro.foreground.muted} marginTop={1}>
              Use ↑↓ to select "Create New Session" and press Enter.
            </text>
          </box>
        )}

        {/* Session/Conversation list */}
        {!conversationsLoading && !sessionsLoading && (conversations.length > 0 || sessions.length > 0) && (
          <box marginTop={2} flexDirection="column" width={70}>
            {/* Search box */}
            <box
              backgroundColor={searchQuery ? OneDarkPro.background.highlight : OneDarkPro.background.secondary}
              borderStyle="single"
              borderColor={searchQuery ? OneDarkPro.syntax.green : OneDarkPro.ui.border}
              paddingLeft={1}
              paddingRight={1}
              marginBottom={1}
              flexDirection="row"
            >
              <text fg={OneDarkPro.syntax.green}>🔍 </text>
              <text fg={searchQuery ? OneDarkPro.foreground.primary : OneDarkPro.foreground.muted}>
                {searchQuery || 'Type to search...'}
              </text>
            </box>

            {/* Count */}
            <text fg={OneDarkPro.foreground.muted}>
              {totalDisplayed} of {filteredConversations.length + filteredSessions.length}
              {searchQuery ? ` (${conversations.length + sessions.length} total)` : ' sessions'}
            </text>

            {/* Items */}
            {totalDisplayed === 0 && searchQuery ? (
              <text fg={OneDarkPro.foreground.muted}>
                No matching sessions. Try a different search.
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
                        : 'transparent'
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
                      {selectedIndex === -1 ? '▸ ' : '  '}
                      ✨ Create New Session
                    </text>
                  </box>
                )}

                {/* Recent conversations */}
                {displayConversations.map((conversation, i) => {
                  const isSelected = i === selectedIndex;

                  // Format timestamp
                  const date = new Date(conversation.timestamp);
                  const timeAgo = formatTimeAgo(date);

                  // Get Linear identifier if available
                  const linearId = conversation.linearProjectIdentifier || conversation.linearTaskIdentifier;

                  // Truncate display message (shorter if Linear ID present)
                  const maxLength = linearId ? 40 : 50;
                  const display = conversation.display.length > maxLength
                    ? conversation.display.substring(0, maxLength - 1) + '…'
                    : conversation.display;

                  return (
                    <box
                      key={conversation.sessionId}
                      backgroundColor={
                        isSelected
                          ? OneDarkPro.background.highlight
                          : 'transparent'
                      }
                      paddingLeft={1}
                      paddingRight={1}
                    >
                      <text
                        fg={
                          isSelected
                            ? OneDarkPro.syntax.blue
                            : OneDarkPro.foreground.primary
                        }
                      >
                        {isSelected ? '▸ ' : '  '}
                        💬 {display} {' '}
                        {linearId && (
                          <text fg={OneDarkPro.syntax.magenta}>[{linearId}] </text>
                        )}
                        <text fg={OneDarkPro.foreground.comment}>({timeAgo})</text>
                      </text>
                    </box>
                  );
                })}

                {/* Linear sessions (if any) */}
                {displaySessions.map((session, i) => {
                  const isSelected = (i + displayConversations.length) === selectedIndex;

                  // Get identifier from linearData if available
                  const identifier = session.linearData?.identifier || '';
                  const prefix = identifier ? `${identifier} ` : '';
                  const maxNameLength = identifier ? 30 : 35;

                  const name = session.name.length > maxNameLength
                    ? session.name.substring(0, maxNameLength - 1) + '…'
                    : session.name;

                  return (
                    <box
                      key={session.id}
                      backgroundColor={
                        isSelected
                          ? OneDarkPro.background.highlight
                          : 'transparent'
                      }
                      paddingLeft={1}
                      paddingRight={1}
                    >
                      <text
                        fg={
                          isSelected
                            ? OneDarkPro.syntax.blue
                            : OneDarkPro.foreground.primary
                        }
                      >
                        {isSelected ? '▸ ' : '  '}
                        📋 {identifier ? prefix : ''}
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
            Type to search  •  ↑↓ Select  •  Enter Resume/Start  •  Esc {searchQuery ? 'Clear' : 'Back'}  •  q Quit
          </text>
        </box>
      </box>
    </box>
  );
}
