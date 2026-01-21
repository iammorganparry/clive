import { useEffect } from 'react';
import { useKeyboard } from '@opentui/react';
import type { CommandSuggestion } from '../components/SuggestionsPanel';

interface UseInputKeyboardParams {
  inputRef: React.RefObject<any>;
  value: string;
  setValue: (v: string) => void;
  showSuggestions: boolean;
  setShowSuggestions: (v: boolean) => void;
  selectedSuggestion: number;
  setSelectedSuggestion: (v: number) => void;
  filteredSuggestions: CommandSuggestion[];
  getPreviousCommand: () => string | null;
  getNextCommand: () => string | null;
  resetHistoryIndex: () => void;
  onSubmit: (cmd: string) => void;
  inputFocused: boolean;
  setInputFocused: (v: boolean) => void;
  isRunning: boolean;
}

export function useInputKeyboard(params: UseInputKeyboardParams) {
  useKeyboard((event) => {
    // Only handle events when input is focused
    if (!params.inputFocused) return;

    // Handle suggestions navigation
    if (params.showSuggestions && params.filteredSuggestions.length > 0) {
      // Arrow up - previous suggestion
      if (event.name === 'up') {
        params.setSelectedSuggestion(
          Math.max(0, params.selectedSuggestion - 1)
        );
        return;
      }

      // Arrow down - next suggestion
      if (event.name === 'down') {
        params.setSelectedSuggestion(
          Math.min(params.filteredSuggestions.length - 1, params.selectedSuggestion + 1)
        );
        return;
      }

      // Tab or Enter to accept suggestion
      if (event.name === 'tab' || event.name === 'return') {
        const suggestion = params.filteredSuggestions[params.selectedSuggestion];
        if (suggestion) {
          params.setValue(suggestion.cmd + ' ');
          params.setShowSuggestions(false);
          params.setSelectedSuggestion(0);
          params.resetHistoryIndex();
        }
        return;
      }
    }

    // Handle command history when not showing suggestions
    if (!params.showSuggestions) {
      // Arrow up - previous command in history
      if (event.name === 'up') {
        const prev = params.getPreviousCommand();
        if (prev !== null) {
          params.setValue(prev);
        }
        return;
      }

      // Arrow down - next command in history
      if (event.name === 'down') {
        const next = params.getNextCommand();
        if (next !== null) {
          params.setValue(next);
        }
        return;
      }
    }

    // Escape - close suggestions or unfocus
    if (event.name === 'escape') {
      if (params.showSuggestions) {
        params.setShowSuggestions(false);
        params.setSelectedSuggestion(0);
      } else {
        params.setInputFocused(false);
        params.resetHistoryIndex();
      }
      return;
    }

    // Ctrl+C - cancel running process or quit
    if ((event.ctrl || event.meta) && event.name === 'c') {
      if (params.isRunning) {
        params.onSubmit('/cancel');
      } else {
        process.exit(0);
      }
      return;
    }

    // Ctrl+A / Cmd+A - select all (handled by input component)
    if ((event.ctrl || event.meta) && event.name === 'a') {
      // InputRenderable should handle this natively
      return;
    }
  });

  // Reset suggestions when value changes
  useEffect(() => {
    if (!params.value.startsWith('/') || params.value.includes(' ')) {
      if (params.showSuggestions) {
        params.setShowSuggestions(false);
        params.setSelectedSuggestion(0);
      }
    }
  }, [params.value]);
}
