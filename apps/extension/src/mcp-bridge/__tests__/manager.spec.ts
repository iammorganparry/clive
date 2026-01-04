/**
 * MCP Bridge Manager Tests
 * Tests for the Effect-based lifecycle manager
 */

import * as fsPromises from "node:fs/promises";
import { describe, it } from "@effect/vitest";
import { Effect, Exit, Queue } from "effect";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { createMockBridgeHandlers } from "../../__tests__/mock-factories/mcp-mocks.js";
import { McpBridgeManager, McpBridgeManagerLive } from "../manager.js";
import { startMcpBridgeServer, stopMcpBridgeServer } from "../server.js";

// Mock the server module
vi.mock("../server.js", () => ({
  startMcpBridgeServer: vi.fn(),
  stopMcpBridgeServer: vi.fn(),
}));

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  unlink: vi.fn(),
}));

describe("MCP Bridge Manager", () => {
  let mockServer: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = { close: vi.fn() };

    // Default mock implementations
    vi.mocked(startMcpBridgeServer).mockResolvedValue(mockServer as never);
    vi.mocked(stopMcpBridgeServer).mockResolvedValue(undefined);
    vi.mocked(fsPromises.unlink).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initial state", () => {
    it.effect("initial status has correct defaults", () =>
      Effect.gen(function* () {
        const manager = yield* McpBridgeManager;
        const status = yield* manager.getStatus;

        expect(status).toEqual({
          bridgeReady: false,
          starting: false,
          error: null,
          socketPath: null,
        });
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );

    it.effect("isRunning returns false initially", () =>
      Effect.gen(function* () {
        const manager = yield* McpBridgeManager;
        const isRunning = yield* manager.isRunning;

        expect(isRunning).toBe(false);
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );

    it.effect("getSocketPath returns null initially", () =>
      Effect.gen(function* () {
        const manager = yield* McpBridgeManager;
        const socketPath = yield* manager.getSocketPath;

        expect(socketPath).toBeNull();
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );
  });

  describe("setHandlers", () => {
    it.effect("stores handlers and allows start", () =>
      Effect.gen(function* () {
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        const result = yield* manager.start;

        expect(result).toContain("clive-mcp-");
        expect(startMcpBridgeServer).toHaveBeenCalledWith(
          expect.stringContaining("clive-mcp-"),
          handlers,
        );
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );
  });

  describe("start", () => {
    it.effect("fails if handlers not set", () =>
      Effect.gen(function* () {
        const manager = yield* McpBridgeManager;
        const result = yield* Effect.exit(manager.start);

        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          expect(String(result.cause)).toContain(
            "Handlers must be set before starting the bridge",
          );
        }
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );

    it.effect("generates unique socket path", () =>
      Effect.gen(function* () {
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        const socketPath = yield* manager.start;

        expect(socketPath).toMatch(/clive-mcp-\d+-\d+\.sock$/);
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );

    it.effect("starts server successfully", () =>
      Effect.gen(function* () {
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        yield* manager.start;

        expect(startMcpBridgeServer).toHaveBeenCalled();
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );

    it.effect("updates status to bridgeReady on success", () =>
      Effect.gen(function* () {
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        yield* manager.start;
        const status = yield* manager.getStatus;

        expect(status.bridgeReady).toBe(true);
        expect(status.starting).toBe(false);
        expect(status.socketPath).toContain("clive-mcp-");
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );

    it.effect("returns existing path if already running", () =>
      Effect.gen(function* () {
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        const path1 = yield* manager.start;
        const path2 = yield* manager.start;

        expect(path1).toBe(path2);
        expect(startMcpBridgeServer).toHaveBeenCalledTimes(1);
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );

    it.effect("sets error status on failure", () =>
      Effect.gen(function* () {
        vi.mocked(startMcpBridgeServer).mockRejectedValueOnce(
          new Error("Socket in use"),
        );
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        const result = yield* Effect.exit(manager.start);

        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );

    it.effect("updates status.error on server start failure", () =>
      Effect.gen(function* () {
        vi.mocked(startMcpBridgeServer).mockRejectedValueOnce(
          new Error("Address already in use"),
        );
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        yield* Effect.either(manager.start);
        const status = yield* manager.getStatus;

        expect(status.error).toBe("Address already in use");
        expect(status.bridgeReady).toBe(false);
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );
  });

  describe("stop", () => {
    it.effect("stops server and cleans socket", () =>
      Effect.gen(function* () {
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        yield* manager.start;
        yield* manager.stop;

        expect(stopMcpBridgeServer).toHaveBeenCalled();
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );

    it.effect("is no-op if not running", () =>
      Effect.gen(function* () {
        const manager = yield* McpBridgeManager;
        yield* manager.stop;

        expect(stopMcpBridgeServer).not.toHaveBeenCalled();
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );

    it.effect("resets state after stop", () =>
      Effect.gen(function* () {
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        yield* manager.start;
        const statusBefore = yield* manager.getStatus;
        yield* manager.stop;
        const statusAfter = yield* manager.getStatus;

        expect(statusBefore.bridgeReady).toBe(true);
        expect(statusAfter.bridgeReady).toBe(false);
        expect(statusAfter.socketPath).toBeNull();
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );

    it.effect("cleans up socket file", () =>
      Effect.gen(function* () {
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        yield* manager.start;
        const capturedSocketPath = yield* manager.getSocketPath;
        yield* manager.stop;

        expect(fsPromises.unlink).toHaveBeenCalledWith(capturedSocketPath);
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );

    it.effect("ignores errors during cleanup", () =>
      Effect.gen(function* () {
        vi.mocked(fsPromises.unlink).mockRejectedValueOnce(
          new Error("File not found"),
        );
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        yield* manager.start;
        // Should not throw
        yield* manager.stop;
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );
  });

  describe("restart", () => {
    it.effect("stops then starts the bridge", () =>
      Effect.gen(function* () {
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        yield* manager.start;
        yield* manager.restart;

        // Verify stop was called before second start
        expect(stopMcpBridgeServer).toHaveBeenCalled();
        expect(startMcpBridgeServer).toHaveBeenCalledTimes(2);
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );

    it.effect("returns new socket path", () =>
      Effect.gen(function* () {
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        yield* manager.start;
        const newPath = yield* manager.restart;

        expect(newPath).toContain("clive-mcp-");
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );
  });

  describe("subscribe", () => {
    it.effect("returns dequeue for status updates", () =>
      Effect.gen(function* () {
        const manager = yield* McpBridgeManager;
        const dequeue = yield* manager.subscribe;

        expect(dequeue).toBeDefined();
      }).pipe(Effect.scoped, Effect.provide(McpBridgeManagerLive)),
    );

    it.effect("publishes current status to new subscriber", () =>
      Effect.gen(function* () {
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        yield* manager.start;

        const dequeue = yield* manager.subscribe;
        // First message should be current status
        const status = yield* Queue.take(dequeue);

        expect(status.bridgeReady).toBe(true);
      }).pipe(Effect.scoped, Effect.provide(McpBridgeManagerLive)),
    );

    it.effect("publishes on status changes", () =>
      Effect.gen(function* () {
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);

        // Subscribe before starting
        const dequeue = yield* manager.subscribe;

        // Take initial status
        const initial = yield* Queue.take(dequeue);

        // Start the bridge (triggers status updates)
        yield* manager.start;

        // Should get the "starting" status
        const starting = yield* Queue.take(dequeue);

        // Should get the "ready" status
        const ready = yield* Queue.take(dequeue);

        expect(initial.bridgeReady).toBe(false);
        expect(starting.starting).toBe(true);
        expect(ready.bridgeReady).toBe(true);
      }).pipe(Effect.scoped, Effect.provide(McpBridgeManagerLive)),
    );
  });

  describe("isRunning", () => {
    it.effect("returns true when bridge is ready", () =>
      Effect.gen(function* () {
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        yield* manager.start;
        const isRunning = yield* manager.isRunning;

        expect(isRunning).toBe(true);
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );

    it.effect("returns false after stop", () =>
      Effect.gen(function* () {
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        yield* manager.start;
        yield* manager.stop;
        const isRunning = yield* manager.isRunning;

        expect(isRunning).toBe(false);
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );
  });

  describe("getSocketPath", () => {
    it.effect("returns socket path when running", () =>
      Effect.gen(function* () {
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        yield* manager.start;
        const socketPath = yield* manager.getSocketPath;

        expect(socketPath).toContain("clive-mcp-");
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );

    it.effect("returns null after stop", () =>
      Effect.gen(function* () {
        const handlers = createMockBridgeHandlers();
        const manager = yield* McpBridgeManager;

        yield* manager.setHandlers(handlers);
        yield* manager.start;
        yield* manager.stop;
        const socketPath = yield* manager.getSocketPath;

        expect(socketPath).toBeNull();
      }).pipe(Effect.provide(McpBridgeManagerLive)),
    );
  });
});
