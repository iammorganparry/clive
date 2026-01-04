/**
 * MCP Bridge Runtime Adapter
 * Provides a Promise-based interface to the Effect-based McpBridgeManager
 * for use in non-Effect code (e.g., RPC handlers)
 */

import { Effect, Exit, Layer, Runtime, Scope, Stream } from "effect";
import {
  McpBridgeManager,
  McpBridgeManagerLive,
} from "./manager.js";
import type { BridgeHandlers, McpBridgeStatus } from "./types.js";

/**
 * Runtime adapter for McpBridgeManager
 * Exposes Promise-based methods for use in imperative code
 */
export class McpBridgeRuntime {
  private runtime: Runtime.Runtime<McpBridgeManager>;
  private scope: Scope.CloseableScope | null = null;

  private constructor(runtime: Runtime.Runtime<McpBridgeManager>) {
    this.runtime = runtime;
  }

  /**
   * Create a new McpBridgeRuntime instance
   */
  static async create(): Promise<McpBridgeRuntime> {
    const scope = Effect.runSync(Scope.make());
    const runtime = await Effect.runPromise(
      Layer.toRuntime(McpBridgeManagerLive).pipe(Scope.extend(scope)),
    );
    const instance = new McpBridgeRuntime(runtime);
    instance.scope = scope;
    return instance;
  }

  /**
   * Get current bridge status
   */
  async getStatus(): Promise<McpBridgeStatus> {
    return Runtime.runPromise(this.runtime)(
      Effect.gen(function* () {
        const manager = yield* McpBridgeManager;
        return yield* manager.getStatus;
      }),
    );
  }

  /**
   * Check if bridge is running
   */
  async isRunning(): Promise<boolean> {
    return Runtime.runPromise(this.runtime)(
      Effect.gen(function* () {
        const manager = yield* McpBridgeManager;
        return yield* manager.isRunning;
      }),
    );
  }

  /**
   * Get the socket path
   */
  async getSocketPath(): Promise<string | null> {
    return Runtime.runPromise(this.runtime)(
      Effect.gen(function* () {
        const manager = yield* McpBridgeManager;
        return yield* manager.getSocketPath;
      }),
    );
  }

  /**
   * Set bridge handlers
   */
  async setHandlers(handlers: BridgeHandlers): Promise<void> {
    return Runtime.runPromise(this.runtime)(
      Effect.gen(function* () {
        const manager = yield* McpBridgeManager;
        yield* manager.setHandlers(handlers);
      }),
    );
  }

  /**
   * Start the bridge
   */
  async start(): Promise<string> {
    return Runtime.runPromise(this.runtime)(
      Effect.gen(function* () {
        const manager = yield* McpBridgeManager;
        return yield* manager.start;
      }),
    );
  }

  /**
   * Stop the bridge
   */
  async stop(): Promise<void> {
    return Runtime.runPromise(this.runtime)(
      Effect.gen(function* () {
        const manager = yield* McpBridgeManager;
        yield* manager.stop;
      }),
    );
  }

  /**
   * Restart the bridge
   */
  async restart(): Promise<string> {
    return Runtime.runPromise(this.runtime)(
      Effect.gen(function* () {
        const manager = yield* McpBridgeManager;
        return yield* manager.restart;
      }),
    );
  }

  /**
   * Subscribe to status changes
   * @param callback - Called whenever status changes
   * @returns Unsubscribe function
   */
  onStatusChange(callback: (status: McpBridgeStatus) => void): () => void {
    let cancelled = false;

    // Run the subscription in the background
    Runtime.runPromise(this.runtime)(
      Effect.gen(function* () {
        const manager = yield* McpBridgeManager;
        const dequeue = yield* manager.subscribe;

        // Process status updates until cancelled
        yield* Stream.fromQueue(dequeue).pipe(
          Stream.takeWhile(() => !cancelled),
          Stream.runForEach((status) =>
            Effect.sync(() => {
              if (!cancelled) {
                callback(status);
              }
            }),
          ),
        );
      }).pipe(Effect.scoped),
    ).catch(() => {
      // Ignore errors when subscription is cancelled
    });

    return () => {
      cancelled = true;
    };
  }

  /**
   * Dispose the runtime and clean up resources
   */
  async dispose(): Promise<void> {
    if (this.scope) {
      await Effect.runPromise(Scope.close(this.scope, Exit.void));
      this.scope = null;
    }
  }
}

/**
 * Singleton instance
 */
let _runtime: McpBridgeRuntime | null = null;

/**
 * Get or create the singleton MCP bridge runtime
 */
export async function getMcpBridgeRuntime(): Promise<McpBridgeRuntime> {
  if (!_runtime) {
    _runtime = await McpBridgeRuntime.create();
  }
  return _runtime;
}

/**
 * Reset the singleton (for testing or cleanup)
 */
export async function resetMcpBridgeRuntime(): Promise<void> {
  if (_runtime) {
    await _runtime.stop().catch(() => {
      // Ignore errors during cleanup
    });
    await _runtime.dispose();
    _runtime = null;
  }
}
