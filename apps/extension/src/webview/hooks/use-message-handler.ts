import { useEffect } from "react";

/**
 * Custom hook for handling messages from the VS Code extension
 * Sets up and tears down the message event listener automatically
 *
 * @param handler - Callback function that receives the MessageEvent.
 *                  Should be memoized with useCallback if it has dependencies.
 */
export function useMessageHandler(
  handler: (event: MessageEvent) => void,
): void {
  useEffect(() => {
    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
    };
  }, [handler]);
}
