/**
 * ModeSelectionView Component
 * Mode selection screen for Plan vs Build
 * Shows after selecting an issue/conversation, before launching Claude Code PTY
 */

import { OneDarkPro } from '../styles/theme';
import type { Session } from '../types';
import type { CliveMode } from '../types/views';

interface ModeSelectionViewProps {
  width: number;
  height: number;
  selectedIndex: number; // 0 = Plan, 1 = Build
  sessionContext?: Session | null;
  onSelectMode: (mode: CliveMode) => void;
  onBack: () => void;
}

interface ModeOption {
  id: CliveMode;
  icon: string;
  title: string;
  description: string;
  shortcut: string;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    id: 'plan',
    icon: '📋',
    title: 'Plan Mode',
    description: 'Research and create a plan',
    shortcut: '1',
  },
  {
    id: 'build',
    icon: '🔨',
    title: 'Build Mode',
    description: 'Execute tasks and implement',
    shortcut: '2',
  },
  {
    id: 'review',
    icon: '🔍',
    title: 'Review Mode',
    description: 'Verify work and test in browser',
    shortcut: '3',
  },
];

export function ModeSelectionView({
  width,
  height,
  selectedIndex,
  sessionContext,
  onSelectMode,
  onBack,
}: ModeSelectionViewProps) {
  // Get session identifier for display
  const sessionIdentifier = sessionContext?.linearData?.identifier
    || sessionContext?.name?.substring(0, 20)
    || null;

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
            {' · Select Mode'}
          </text>
          {sessionIdentifier && (
            <>
              <text fg={OneDarkPro.foreground.muted}>{' · '}</text>
              <text fg={OneDarkPro.syntax.magenta}>[{sessionIdentifier}]</text>
            </>
          )}
        </box>

        {/* Mode options */}
        <box marginTop={3} flexDirection="column" width={45}>
          {MODE_OPTIONS.map((option, i) => {
            const isSelected = i === selectedIndex;

            return (
              <box
                key={option.id}
                backgroundColor={
                  isSelected
                    ? OneDarkPro.background.highlight
                    : OneDarkPro.background.secondary
                }
                borderStyle="rounded"
                borderColor={
                  isSelected
                    ? option.id === 'plan'
                      ? OneDarkPro.syntax.blue
                      : option.id === 'build'
                        ? OneDarkPro.syntax.yellow
                        : OneDarkPro.syntax.green
                    : OneDarkPro.ui.border
                }
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
                paddingBottom={1}
                marginBottom={1}
                flexDirection="column"
              >
                <box flexDirection="row">
                  <text
                    fg={
                      isSelected
                        ? option.id === 'plan'
                          ? OneDarkPro.syntax.blue
                          : option.id === 'build'
                            ? OneDarkPro.syntax.yellow
                            : OneDarkPro.syntax.green
                        : OneDarkPro.foreground.primary
                    }
                    bold
                  >
                    {isSelected ? '▸ ' : '  '}
                    {option.icon} {option.title}
                  </text>
                  <text fg={OneDarkPro.foreground.comment}>
                    {' '}[{option.shortcut}]
                  </text>
                </box>
                <text
                  fg={OneDarkPro.foreground.muted}
                  marginLeft={4}
                >
                  {option.description}
                </text>
              </box>
            );
          })}
        </box>

        {/* Keyboard hints */}
        <box marginTop={4} flexDirection="column" alignItems="center">
          <text fg={OneDarkPro.foreground.muted}>
            ↑↓ Navigate  •  1/2/3 Quick Select  •  Enter Select  •  Esc Back
          </text>
        </box>
      </box>
    </box>
  );
}
