/**
 * Handler Utilities
 *
 * Shared utilities for Effect-based handler logic.
 */

import { Effect } from "effect";

/**
 * Helper to run handler effects with error logging
 */
export function runHandlerEffect<A, E>(
  effect: Effect.Effect<A, E>,
  context: string,
): Promise<A | undefined> {
  return Effect.runPromise(
    effect.pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.error(`[${context}] error:`, error);
          return undefined;
        }),
      ),
    ),
  );
}
