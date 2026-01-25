/**
 * usePaste Hook
 * Subscribe to clipboard paste events from OpenTUI's renderer.keyInput
 */

import type { PasteEvent } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useEffect } from "react";

export function usePaste(handler: (pasteEvent: PasteEvent) => void) {
  const renderer = useRenderer();

  useEffect(() => {
    if (!renderer?.keyInput) return;

    const pasteHandler = (event: PasteEvent) => {
      handler(event);
    };

    // Listen to paste events from renderer.keyInput (not keyHandler)
    // As documented: renderer.keyInput emits "keypress" and "paste" events
    renderer.keyInput.on("paste", pasteHandler);

    return () => {
      renderer.keyInput.off("paste", pasteHandler);
    };
  }, [renderer, handler]);
}
