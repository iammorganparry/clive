/**
 * MCP Bridge Manager
 * Manages the lifecycle of the MCP bridge server based on AI provider selection
 * Uses Effect's PubSub for status updates and Ref for state management
 */

import * as fs from "node:fs/promises";
import type * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import {
  Context,
  Effect,
  Layer,
  PubSub,
  pipe,
  type Queue,
  Ref,
  type Scope,
} from "effect";
import { startMcpBridgeServer, stopMcpBridgeServer } from "./server.js";
import type { BridgeHandlers, McpBridgeStatus } from "./types.js";

/**
 * Internal state for the bridge manager
 */
interface BridgeState {
  server: net.Server | null;
  socketPath: string | null;
  handlers: BridgeHandlers | null;
  status: McpBridgeStatus;
}

const initialState: BridgeState = {
  server: null,
  socketPath: null,
  handlers: null,
  status: {
    bridgeReady: false,
    starting: false,
    error: null,
    socketPath: null,
  },
};

/**
 * MCP Bridge Manager Service
 */
export class McpBridgeManager extends Context.Tag("McpBridgeManager")<
  McpBridgeManager,
  {
    readonly getStatus: Effect.Effect<McpBridgeStatus>;
    readonly isRunning: Effect.Effect<boolean>;
    readonly getSocketPath: Effect.Effect<string | null>;
    readonly setHandlers: (handlers: BridgeHandlers) => Effect.Effect<void>;
    readonly start: Effect.Effect<string, Error>;
    readonly stop: Effect.Effect<void>;
    readonly restart: Effect.Effect<string, Error>;
    readonly subscribe: Effect.Effect<
      Queue.Dequeue<McpBridgeStatus>,
      never,
      Scope.Scope
    >;
  }
>() {}

/**
 * Create the MCP Bridge Manager service implementation
 */
const makeMcpBridgeManager = Effect.gen(function* () {
  // State management using Ref
  const stateRef = yield* Ref.make<BridgeState>(initialState);

  // PubSub for status updates
  const statusPubSub = yield* PubSub.unbounded<McpBridgeStatus>();

  /**
   * Update status and publish to subscribers
   */
  const updateStatus = (updates: Partial<McpBridgeStatus>) =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      const newStatus = { ...state.status, ...updates };

      yield* Ref.update(stateRef, (s) => ({
        ...s,
        status: newStatus,
      }));

      yield* PubSub.publish(statusPubSub, newStatus);
    });

  /**
   * Get current status
   */
  const getStatus = pipe(
    Ref.get(stateRef),
    Effect.map((state) => state.status),
  );

  /**
   * Check if bridge is running
   */
  const isRunning = pipe(
    Ref.get(stateRef),
    Effect.map((state) => state.server !== null && state.status.bridgeReady),
  );

  /**
   * Get the socket path for CLI configuration
   */
  const getSocketPath = pipe(
    Ref.get(stateRef),
    Effect.map((state) => state.socketPath),
  );

  /**
   * Set handlers for bridge methods
   */
  const setHandlers = (handlers: BridgeHandlers) =>
    Ref.update(stateRef, (state) => ({
      ...state,
      handlers,
    }));

  /**
   * Start the MCP bridge server
   */
  const start = Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);

    // Already running, return existing socket path
    if (state.server && state.socketPath) {
      return state.socketPath;
    }

    const handlers = state.handlers;
    if (!handlers) {
      return yield* Effect.fail(
        new Error("Handlers must be set before starting the bridge"),
      );
    }

    yield* updateStatus({ starting: true, error: null });

    // Generate unique socket path
    const socketPath = path.join(
      os.tmpdir(),
      `clive-mcp-${process.pid}-${Date.now()}.sock`,
    );

    const serverResult = yield* Effect.tryPromise({
      try: () => startMcpBridgeServer(socketPath, handlers),
      catch: (error) =>
        new Error(
          error instanceof Error ? error.message : "Failed to start bridge",
        ),
    }).pipe(
      Effect.tapError((error) =>
        Effect.gen(function* () {
          yield* updateStatus({
            bridgeReady: false,
            starting: false,
            error: error.message,
          });
          yield* Ref.update(stateRef, (s) => ({
            ...s,
            server: null,
            socketPath: null,
          }));
        }),
      ),
    );

    yield* Ref.update(stateRef, (s) => ({
      ...s,
      server: serverResult,
      socketPath,
    }));

    yield* updateStatus({
      bridgeReady: true,
      starting: false,
      socketPath,
    });

    return socketPath;
  });

  /**
   * Stop the MCP bridge server
   */
  const stop = Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    const server = state.server;
    const currentSocketPath = state.socketPath;

    if (!server || !currentSocketPath) {
      return;
    }

    yield* Effect.tryPromise({
      try: () => stopMcpBridgeServer(server, currentSocketPath),
      catch: () => new Error("Failed to stop bridge"),
    }).pipe(Effect.ignore);

    // Clean up socket file
    yield* Effect.tryPromise({
      try: () => fs.unlink(currentSocketPath),
      catch: () => new Error("Failed to unlink socket"),
    }).pipe(Effect.ignore);

    yield* Ref.update(stateRef, (s) => ({
      ...s,
      server: null,
      socketPath: null,
    }));

    yield* updateStatus({
      bridgeReady: false,
      starting: false,
      socketPath: null,
    });
  });

  /**
   * Restart the bridge
   */
  const restart = Effect.gen(function* () {
    yield* stop;
    return yield* start;
  });

  /**
   * Subscribe to status updates
   */
  const subscribe = Effect.gen(function* () {
    const dequeue = yield* PubSub.subscribe(statusPubSub);
    // Immediately publish current status to new subscriber
    const currentStatus = yield* getStatus;
    yield* PubSub.publish(statusPubSub, currentStatus);
    return dequeue;
  });

  return {
    getStatus,
    isRunning,
    getSocketPath,
    setHandlers,
    start,
    stop,
    restart,
    subscribe,
  };
});

/**
 * Live layer for the MCP Bridge Manager service
 */
export const McpBridgeManagerLive = Layer.effect(
  McpBridgeManager,
  makeMcpBridgeManager,
);
