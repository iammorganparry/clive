import { useInput } from "ink";

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

export function useKeyboard(
  handlers: KeyboardHandlers,
  isInputFocused: boolean = false,
) {
  useInput((input, key) => {
    // Skip all shortcuts when input is focused (let input handle its own keys)
    if (isInputFocused) {
      return;
    }

    // Tab switching with Shift+Tab (previous) and Tab (next)
    // Only when not focused on input
    if (key.tab && key.shift) {
      handlers.prevTab?.();
      return;
    }

    if (key.tab) {
      handlers.nextTab?.();
      return;
    }

    // Help toggle
    if (input === "?") {
      handlers.toggleHelp?.();
      return;
    }

    // Action shortcuts
    if (input === "n") {
      handlers.newSession?.();
      return;
    }

    if (input === "b") {
      handlers.startBuild?.();
      return;
    }

    if (input === "c") {
      handlers.cancelBuild?.();
      return;
    }

    if (input === "r") {
      handlers.refresh?.();
      return;
    }

    // Focus command input
    if (input === "/") {
      handlers.focusInput?.();
      return;
    }
  });
}
