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
  onCreateNew: () => void;
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
  onCreateNew,
  onBack,
}: SelectionViewProps) {
  // Filter sessions by search query (search both identifier and title)
  const filteredSessions = searchQuery
    ? sessions.filter(s => {
        const query = searchQuery.toLowerCase();
        const identifier = s.linearData?.identifier?.toLowerCase() || '';
        const title = s.name.toLowerCase();
        return identifier.includes(query) || title.includes(query);
      })
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
              Use ↑↓ to select "Create New Epic" and press Enter.
            </text>
          </box>
        )}

        {/* Session list */}
        {!sessionsLoading && sessions.length > 0 && (
          <box marginTop={2} flexDirection="column" width={60}>
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
              {displaySessions.length} of {filteredSessions.length}
              {searchQuery ? ` (${sessions.length} total)` : ' epics'}
            </text>

            {/* Session items */}
            {displaySessions.length === 0 && searchQuery ? (
              <text fg={OneDarkPro.foreground.muted}>
                No matching epics. Try a different search.
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
                      ✨ Create New Epic
                    </text>
                  </box>
                )}

                {/* Existing sessions */}
                {displaySessions.map((session, i) => {
                  const isSelected = i === selectedIndex;

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
                      {identifier ? prefix : ''}
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
            Type to search  •  1-9/↑↓ Select  •  Enter Confirm  •  Esc {searchQuery ? 'Clear' : 'Back'}  •  q Quit
          </text>
        </box>
      </box>
    </box>
  );
}
