/**
 * Tunnel Service
 *
 * Manages ngrok tunnel for local Slack webhook receiving.
 * Each user runs their own Clive instance with ngrok providing the public URL.
 */

import * as ngrok from "@ngrok/ngrok";
import { Data, Effect } from "effect";

/**
 * Error when tunnel operations fail
 */
export class TunnelServiceError extends Data.TaggedError("TunnelServiceError")<{
  message: string;
  cause?: unknown;
}> {}

// Track active tunnel for cleanup
let activeListener: ngrok.Listener | null = null;
let activeTunnelUrl: string | null = null;

/**
 * Tunnel Service for ngrok management
 */
export const TunnelService = {
  /**
   * Connect to ngrok and establish a tunnel
   *
   * @param port - Local port to tunnel to
   * @returns The public ngrok URL
   */
  connect: (port: number): Effect.Effect<string, TunnelServiceError> =>
    Effect.gen(function* () {
      yield* Effect.logDebug(
        `[TunnelService] Connecting ngrok tunnel to port ${port}`,
      );

      // Get auth token from environment
      const authToken = process.env.NGROK_AUTH_TOKEN;
      if (!authToken) {
        return yield* Effect.fail(
          new TunnelServiceError({
            message: "NGROK_AUTH_TOKEN environment variable is required",
          }),
        );
      }

      // Connect ngrok using the new API
      const listener = yield* Effect.tryPromise({
        try: async () => {
          return await ngrok.forward({
            addr: port,
            authtoken: authToken,
          });
        },
        catch: (error) =>
          new TunnelServiceError({
            message: `Failed to connect ngrok: ${String(error)}`,
            cause: error,
          }),
      });

      activeListener = listener;
      const url = listener.url();

      if (!url) {
        return yield* Effect.fail(
          new TunnelServiceError({
            message: "ngrok connected but did not return a URL",
          }),
        );
      }

      activeTunnelUrl = url;
      yield* Effect.logInfo(`[TunnelService] Tunnel established: ${url}`);

      return url;
    }),

  /**
   * Disconnect the ngrok tunnel
   */
  disconnect: (): Effect.Effect<void, TunnelServiceError> =>
    Effect.gen(function* () {
      yield* Effect.logDebug("[TunnelService] Disconnecting ngrok tunnel");

      if (activeListener) {
        yield* Effect.tryPromise({
          try: async () => {
            await activeListener?.close();
          },
          catch: (error) =>
            new TunnelServiceError({
              message: `Failed to disconnect ngrok: ${String(error)}`,
              cause: error,
            }),
        });

        activeListener = null;
      }

      activeTunnelUrl = null;
      yield* Effect.logInfo("[TunnelService] Tunnel disconnected");
    }),

  /**
   * Get the current tunnel URL if connected
   */
  getUrl: (): Effect.Effect<string | null, never> =>
    Effect.succeed(activeTunnelUrl),

  /**
   * Check if tunnel is connected
   */
  isConnected: (): Effect.Effect<boolean, never> =>
    Effect.succeed(activeTunnelUrl !== null),
};
