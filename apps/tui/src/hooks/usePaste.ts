/**
 * usePaste Hook
 * Subscribe to clipboard paste events from OpenTUI's KeyHandler
 */

import { useEffect } from 'react';
import { useRenderer } from '@opentui/react';
import type { PasteEvent } from '@opentui/core';

export function usePaste(handler: (pasteEvent: PasteEvent) => void) {
  const renderer = useRenderer();

  useEffect(() => {
    if (!renderer?.keyHandler) return;

    const pasteHandler = (event: PasteEvent) => {
      handler(event);
    };

    // Listen to paste events from the key handler
    renderer.keyHandler.on('paste', pasteHandler);

    return () => {
      renderer.keyHandler.off('paste', pasteHandler);
    };
  }, [renderer, handler]);
}
