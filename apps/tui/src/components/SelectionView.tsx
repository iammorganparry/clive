/**
 * SelectionView Component
 * Epic/Session selection screen
 * Shows list of available epics with search and selection
 */

import { OneDarkPro } from '../styles/theme';
import { Session } from '../types';
import { LoadingSpinner } from './LoadingSpinner';

interface SelectionViewProps {
  width: number;
  height: number;
  sessions: Session[];
  sessionsLoading: boolean;
  selectedIndex: number;
  searchQuery: string;
  onSelect: (session: Session) => void;
  onBack: () => void;
}

export function SelectionView({
  width,
  height,
  sessions,
  sessionsLoading,
  selectedIndex,
  searchQuery,
  onSelect,
  onBack,
}: SelectionViewProps) {
  // Filter sessions by search query
  const filteredSessions = searchQuery
    ? sessions.filter(s =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sessions;

  // Limit to first 10
  const displaySessions = filteredSessions.slice(0, 10);

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
            {' · Select Epic'}
          </text>
        </box>

        {/* Loading state */}
        {sessionsLoading && (
          <box marginTop={3}>
            <LoadingSpinner text="Loading epics..." color={OneDarkPro.syntax.yellow} />
          </box>
        )}

        {/* Empty state */}
        {!sessionsLoading && sessions.length === 0 && (
          <box marginTop={3} flexDirection="column" alignItems="center">
            <text fg={OneDarkPro.foreground.muted}>
              No epics found.
            </text>
            <text fg={OneDarkPro.foreground.muted} marginTop={1}>
              Press 'n' to create a new session.
            </text>
          </box>
        )}

        {/* Session list */}
        {!sessionsLoading && sessions.length > 0 && (
          <box marginTop={3} flexDirection="column" width={50}>
            {/* Search box */}
            <box
              backgroundColor={searchQuery ? OneDarkPro.background.highlight : OneDarkPro.background.secondary}
              borderStyle="single"
              borderColor={searchQuery ? OneDarkPro.syntax.green : OneDarkPro.ui.border}
              padding={1}
              marginBottom={2}
            >
              <text fg={OneDarkPro.syntax.green}>🔍 </text>
              <text fg={searchQuery ? OneDarkPro.foreground.primary : OneDarkPro.foreground.muted}>
                {searchQuery || 'Type to search epics...'}
              </text>
            </box>

            {/* Count */}
            <text fg={OneDarkPro.foreground.muted} marginBottom={1}>
              {displaySessions.length} of {filteredSessions.length}
              {searchQuery ? ` (${sessions.length} total)` : ' epics'}
            </text>

            {/* Session items */}
            {displaySessions.length === 0 ? (
              <text fg={OneDarkPro.foreground.muted}>
                No matching epics. Try a different search.
              </text>
            ) : (
              displaySessions.map((session, i) => {
                const isSelected = i === selectedIndex;

                // Get identifier from linearData if available
                const identifier = session.linearData?.identifier || '';
                const prefix = identifier ? `${identifier} ` : '';
                const maxNameLength = identifier ? 20 : 25;

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
                    padding={1}
                    marginBottom={1}
                  >
                    <text
                      fg={
                        isSelected
                          ? OneDarkPro.syntax.blue
                          : OneDarkPro.foreground.primary
                      }
                    >
                      {isSelected ? '▸ ' : '  '}
                      {identifier ? prefix : ''}
                      {name}
                    </text>
                  </box>
                );
              })
            )}
          </box>
        )}

        {/* Keyboard hints */}
        <box marginTop={4} flexDirection="column" alignItems="center">
          <text fg={OneDarkPro.foreground.muted}>
            Type to search  •  1-9/↑↓ Select  •  Enter Confirm  •  Esc {searchQuery ? 'Clear' : 'Back'}  •  q Quit
          </text>
        </box>
      </box>
    </box>
  );
}
