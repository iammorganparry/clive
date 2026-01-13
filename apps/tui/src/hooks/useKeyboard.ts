import { useInput, useFocusManager } from 'ink';

export interface KeyboardHandlers {
  toggleHelp?: () => void;
  newSession?: () => void;
  startBuild?: () => void;
  cancelBuild?: () => void;
  refresh?: () => void;
  focusInput?: () => void;
  prevTab?: () => void;
  nextTab?: () => void;
}

export function useKeyboard(handlers: KeyboardHandlers, isInputFocused: boolean = false) {
  const { focusNext, focusPrevious } = useFocusManager();

  useInput((input, key) => {
    // Tab navigation works globally (even when input focused)
    if (key.leftArrow) {
      handlers.prevTab?.();
      return;
    }

    if (key.rightArrow) {
      handlers.nextTab?.();
      return;
    }

    // Skip other global shortcuts when input is focused (let input handle its own keys)
    if (isInputFocused) {
      return;
    }

    // Help toggle
    if (input === '?') {
      handlers.toggleHelp?.();
      return;
    }

    // Action shortcuts
    if (input === 'n') {
      handlers.newSession?.();
      return;
    }

    if (input === 'b') {
      handlers.startBuild?.();
      return;
    }

    if (input === 'c') {
      handlers.cancelBuild?.();
      return;
    }

    if (input === 'r') {
      handlers.refresh?.();
      return;
    }

    // Focus command input
    if (input === '/') {
      handlers.focusInput?.();
      return;
    }

    // Focus cycling
    if (key.tab && key.shift) {
      focusPrevious();
      return;
    }

    if (key.tab) {
      focusNext();
      return;
    }
  });
}
