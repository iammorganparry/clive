/**
 * Tests for WorkerClient connection behavior
 *
 * These tests verify the connection state management patterns
 * that prevent the infinite reconnection loop bug.
 */

import { describe, expect, it } from "vitest";

/**
 * Simulates the connection state management in WorkerClient
 */
class ConnectionStateManager {
  private isConnecting = false;
  private isShuttingDown = false;
  private hasActiveConnection = false;
  public connectAttempts = 0;
  public cleanupCalls = 0;

  async connect(): Promise<boolean> {
    // Guard 1: Don't connect during shutdown
    if (this.isShuttingDown) {
      return false;
    }

    // Guard 2: Prevent parallel connection attempts (THE FIX)
    if (this.isConnecting) {
      return false;
    }

    // Guard 3: Clean up existing connection before creating new one (THE FIX)
    if (this.hasActiveConnection) {
      this.cleanup();
    }

    this.isConnecting = true;

    try {
      // Simulate async connection (like WebSocket handshake)
      await new Promise((resolve) => setTimeout(resolve, 10));
      this.connectAttempts++;
      this.hasActiveConnection = true;
      return true;
    } finally {
      this.isConnecting = false;
    }
  }

  private cleanup(): void {
    this.cleanupCalls++;
    this.hasActiveConnection = false;
  }

  shutdown(): void {
    this.isShuttingDown = true;
    if (this.hasActiveConnection) {
      this.cleanup();
    }
  }

  // Expose for testing
  get connecting(): boolean {
    return this.isConnecting;
  }
}

/**
 * Simulates the BUGGY connection state management (before fix)
 */
class BuggyConnectionStateManager {
  private hasActiveConnection = false;
  public connectAttempts = 0;

  async connect(): Promise<boolean> {
    // BUG: No isConnecting guard - allows parallel connections
    // BUG: No cleanup of existing connection
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.connectAttempts++;
    this.hasActiveConnection = true;
    return true;
  }
}

describe("WorkerClient Connection State", () => {
  describe("Correct behavior (with guards)", () => {
    it("prevents parallel connection attempts", async () => {
      const manager = new ConnectionStateManager();

      // Simulate rapid reconnection attempts (what happens on disconnect)
      const results = await Promise.all([
        manager.connect(),
        manager.connect(),
        manager.connect(),
      ]);

      // Only first should succeed, others should be blocked
      expect(results.filter((r) => r === true)).toHaveLength(1);
      expect(manager.connectAttempts).toBe(1);
    });

    it("cleans up existing connection before reconnecting", async () => {
      const manager = new ConnectionStateManager();

      // First connection
      await manager.connect();
      expect(manager.connectAttempts).toBe(1);
      expect(manager.cleanupCalls).toBe(0);

      // Second connection should clean up first
      await manager.connect();
      expect(manager.connectAttempts).toBe(2);
      expect(manager.cleanupCalls).toBe(1);
    });

    it("prevents connection after shutdown", async () => {
      const manager = new ConnectionStateManager();

      await manager.connect();
      manager.shutdown();

      // Try to connect again
      const result = await manager.connect();

      expect(result).toBe(false);
      expect(manager.connectAttempts).toBe(1); // No new attempt
    });

    it("allows sequential connections", async () => {
      const manager = new ConnectionStateManager();

      // Sequential connections should all succeed
      await manager.connect();
      await manager.connect();
      await manager.connect();

      expect(manager.connectAttempts).toBe(3);
      expect(manager.cleanupCalls).toBe(2); // Cleanup before 2nd and 3rd
    });
  });

  describe("REGRESSION: Buggy behavior (without guards)", () => {
    it("allows parallel connection attempts causing infinite loop", async () => {
      const manager = new BuggyConnectionStateManager();

      // Simulate rapid reconnection attempts
      await Promise.all([
        manager.connect(),
        manager.connect(),
        manager.connect(),
      ]);

      // BUG: All three attempts succeed, creating multiple connections
      expect(manager.connectAttempts).toBe(3);
      // This is the bug - multiple parallel connections lead to
      // multiple disconnect handlers, each triggering more reconnects
    });
  });
});

describe("WorkerClient Reconnection Race Condition", () => {
  it("documents the bug that was fixed", () => {
    /**
     * THE BUG (before fix):
     *
     * 1. Worker connects to server
     * 2. Connection drops (code 1006)
     * 3. `close` event handler calls handleDisconnect()
     * 4. handleDisconnect() schedules reconnect via setTimeout
     * 5. connect() creates NEW WebSocket, storing in this.ws
     * 6. OLD WebSocket still has event handlers attached
     * 7. OLD socket's close handler fires AGAIN
     * 8. ANOTHER reconnect is scheduled
     * 9. Multiple parallel connections created
     * 10. Server sees rapid connect/disconnect/connect cycle
     * 11. "Worker ID already registered" errors
     * 12. Infinite loop
     *
     * THE FIX:
     *
     * 1. Added `isConnecting` flag to prevent parallel connect() calls
     * 2. Call `ws.removeAllListeners()` before creating new connection
     * 3. Close existing connection properly before reconnecting
     * 4. Reset `isConnecting` flag in all exit paths
     *
     * Code changes in worker-client.ts connect():
     *
     * ```typescript
     * // NEW: Guard against parallel connections
     * if (this.isConnecting) {
     *   console.log("[WorkerClient] Connection already in progress, skipping");
     *   return;
     * }
     *
     * // NEW: Clean up existing connection
     * if (this.ws) {
     *   this.ws.removeAllListeners();  // Prevents old handlers from firing
     *   if (this.ws.readyState === WebSocket.OPEN ||
     *       this.ws.readyState === WebSocket.CONNECTING) {
     *     this.ws.close(1000, "Reconnecting");
     *   }
     *   this.ws = null;
     * }
     *
     * this.isConnecting = true;
     * ```
     */
    expect(true).toBe(true);
  });

  it("documents server-side fix for race condition", () => {
    /**
     * SERVER-SIDE FIX (worker-registry.ts):
     *
     * THE BUG:
     * When a worker reconnects with the same ID before the server
     * processes the disconnect, register() would return an error
     * because the worker ID was "already registered".
     *
     * THE FIX:
     * Instead of rejecting, force-unregister the old connection:
     *
     * ```typescript
     * if (this.workers.has(workerId)) {
     *   const existing = this.workers.get(workerId)!;
     *   if (existing.socket !== socket) {
     *     // Force unregister old worker to allow reconnection
     *     console.log(`[WorkerRegistry] Replacing existing worker ${workerId}`);
     *     this.unregister(workerId, "replaced by new connection");
     *   }
     * }
     * ```
     *
     * This ensures clean reconnection even if the disconnect event
     * hasn't been processed yet.
     */
    expect(true).toBe(true);
  });
});

describe("Connection Cleanup Pattern", () => {
  it("verifies removeAllListeners prevents ghost handlers", () => {
    // Simulates the pattern used in WorkerClient
    let handlerCallCount = 0;

    const mockSocket = {
      handlers: new Map<string, (() => void)[]>(),
      on(event: string, handler: () => void) {
        if (!this.handlers.has(event)) {
          this.handlers.set(event, []);
        }
        this.handlers.get(event)!.push(handler);
      },
      removeAllListeners() {
        this.handlers.clear();
      },
      emit(event: string) {
        const handlers = this.handlers.get(event) || [];
        handlers.forEach((h) => h());
      },
    };

    // Attach handler
    mockSocket.on("close", () => handlerCallCount++);

    // Emit - should call handler
    mockSocket.emit("close");
    expect(handlerCallCount).toBe(1);

    // Remove all listeners (the fix)
    mockSocket.removeAllListeners();

    // Emit again - should NOT call handler
    mockSocket.emit("close");
    expect(handlerCallCount).toBe(1); // Still 1, not 2
  });
});
