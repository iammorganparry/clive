/**
 * Tunnel Manager
 *
 * Manages ngrok tunnel for worker-to-central communication.
 * Receives configuration from central service during registration.
 * Uses Effect-TS internally for error handling.
 */

import { EventEmitter } from "node:events";
import type { NgrokConfig } from "@clive/worker-protocol";
import { Data, Effect } from "effect";

/**
 * Dynamic import for ngrok (may not be available in all environments)
 */
let ngrok: typeof import("@ngrok/ngrok") | null = null;

async function loadNgrok(): Promise<typeof import("@ngrok/ngrok")> {
  if (!ngrok) {
    ngrok = await import("@ngrok/ngrok");
  }
  return ngrok;
}

/**
 * Error when TunnelManager operations fail
 */
export class TunnelManagerError extends Data.TaggedError("TunnelManagerError")<{
  message: string;
  reason: "no_config" | "connection_failed" | "disconnect_failed";
  cause?: unknown;
}> {}

/**
 * Tunnel manager events
 */
export interface TunnelManagerEvents {
  connected: (url: string) => void;
  disconnected: () => void;
  error: (error: Error) => void;
}

/**
 * Tunnel manager for worker ngrok tunnels
 */
export class TunnelManager extends EventEmitter {
  private listener: any | null = null;
  private tunnelUrl: string | null = null;
  private config: NgrokConfig | null = null;
  private port: number;

  constructor(port: number = 0) {
    super();
    this.port = port;
  }

  /**
   * Set ngrok configuration from central service
   */
  setConfig(config: NgrokConfig): void {
    this.config = config;
  }

  /**
   * Connect the tunnel using the configured settings
   */
  async connect(): Promise<string | null> {
    return Effect.runPromise(this.connectEffect());
  }

  /**
   * Connect effect for internal use
   */
  private connectEffect(): Effect.Effect<string | null, TunnelManagerError> {
    return Effect.gen(this, function* () {
      if (!this.config) {
        console.log("[TunnelManager] No ngrok config provided - skipping tunnel");
        return null;
      }

      const ngrokModule = yield* Effect.tryPromise({
        try: () => loadNgrok(),
        catch: (error) =>
          new TunnelManagerError({
            message: `Failed to load ngrok: ${String(error)}`,
            reason: "connection_failed",
            cause: error,
          }),
      });

      console.log("[TunnelManager] Connecting ngrok tunnel...");

      const options: any = {
        authtoken: this.config.authtoken,
      };

      // If port is specified, forward to it
      if (this.port > 0) {
        options.addr = this.port;
      }

      // If domain is specified, use it
      if (this.config.domain) {
        options.domain = this.config.domain;
      }

      // If region is specified, use it
      if (this.config.region) {
        options.region = this.config.region;
      }

      this.listener = yield* Effect.tryPromise({
        try: () => ngrokModule.forward(options),
        catch: (error) =>
          new TunnelManagerError({
            message: `Failed to connect ngrok: ${String(error)}`,
            reason: "connection_failed",
            cause: error,
          }),
      });

      this.tunnelUrl = this.listener.url();

      if (this.tunnelUrl) {
        console.log(`[TunnelManager] Tunnel established: ${this.tunnelUrl}`);
        this.emit("connected", this.tunnelUrl);
      }

      return this.tunnelUrl;
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.error("[TunnelManager] Failed to connect:", error);
          this.emit(
            "error",
            error instanceof Error ? error : new Error(String(error)),
          );
          return null;
        }),
      ),
    );
  }

  /**
   * Disconnect the tunnel
   */
  async disconnect(): Promise<void> {
    if (this.listener) {
      try {
        await this.listener.close();
        console.log("[TunnelManager] Tunnel disconnected");
      } catch (error) {
        console.error("[TunnelManager] Error disconnecting:", error);
      }
      this.listener = null;
    }
    this.tunnelUrl = null;
    this.emit("disconnected");
  }

  /**
   * Get the current tunnel URL
   */
  getUrl(): string | null {
    return this.tunnelUrl;
  }

  /**
   * Check if tunnel is connected
   */
  isConnected(): boolean {
    return this.tunnelUrl !== null;
  }
}
