/**
 * MCP Bridge Runtime Tests
 * Tests for the Promise-based adapter to the Effect-based manager
 */

import * as fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockBridgeHandlers } from "../../__tests__/mock-factories/mcp-mocks.js";
import {
  getMcpBridgeRuntime,
  McpBridgeRuntime,
  resetMcpBridgeRuntime,
} from "../runtime.js";
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

describe("MCP Bridge Runtime", () => {
  let mockServer: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = { close: vi.fn() };

    // Default mock implementations
    vi.mocked(startMcpBridgeServer).mockResolvedValue(mockServer as never);
    vi.mocked(stopMcpBridgeServer).mockResolvedValue(undefined);
    vi.mocked(fsPromises.unlink).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    // Reset singleton between tests
    await resetMcpBridgeRuntime();
    vi.restoreAllMocks();
  });

  describe("McpBridgeRuntime.create", () => {
    it("creates a new runtime instance", async () => {
      const runtime = await McpBridgeRuntime.create();

      expect(runtime).toBeInstanceOf(McpBridgeRuntime);
    });
  });

  describe("getStatus", () => {
    it("returns initial status", async () => {
      const runtime = await McpBridgeRuntime.create();
      const status = await runtime.getStatus();

      expect(status).toEqual({
        bridgeReady: false,
        starting: false,
        error: null,
        socketPath: null,
      });
    });

    it("returns updated status after start", async () => {
      const runtime = await McpBridgeRuntime.create();
      const handlers = createMockBridgeHandlers();

      await runtime.setHandlers(handlers);
      await runtime.start();

      const status = await runtime.getStatus();

      expect(status.bridgeReady).toBe(true);
      expect(status.socketPath).toContain("clive-mcp-");
    });
  });

  describe("isRunning", () => {
    it("returns false initially", async () => {
      const runtime = await McpBridgeRuntime.create();
      const isRunning = await runtime.isRunning();

      expect(isRunning).toBe(false);
    });

    it("returns true after start", async () => {
      const runtime = await McpBridgeRuntime.create();
      const handlers = createMockBridgeHandlers();

      await runtime.setHandlers(handlers);
      await runtime.start();

      const isRunning = await runtime.isRunning();

      expect(isRunning).toBe(true);
    });
  });

  describe("getSocketPath", () => {
    it("returns null initially", async () => {
      const runtime = await McpBridgeRuntime.create();
      const socketPath = await runtime.getSocketPath();

      expect(socketPath).toBeNull();
    });

    it("returns path after start", async () => {
      const runtime = await McpBridgeRuntime.create();
      const handlers = createMockBridgeHandlers();

      await runtime.setHandlers(handlers);
      await runtime.start();

      const socketPath = await runtime.getSocketPath();

      expect(socketPath).toContain("clive-mcp-");
    });
  });

  describe("setHandlers", () => {
    it("stores handlers for bridge", async () => {
      const runtime = await McpBridgeRuntime.create();
      const handlers = createMockBridgeHandlers();

      await runtime.setHandlers(handlers);

      // Verify by starting successfully
      await runtime.start();
      expect(startMcpBridgeServer).toHaveBeenCalledWith(
        expect.any(String),
        handlers,
      );
    });
  });

  describe("start", () => {
    it("starts the bridge and returns socket path", async () => {
      const runtime = await McpBridgeRuntime.create();
      const handlers = createMockBridgeHandlers();

      await runtime.setHandlers(handlers);
      const socketPath = await runtime.start();

      expect(socketPath).toContain("clive-mcp-");
      expect(startMcpBridgeServer).toHaveBeenCalled();
    });

    it("throws if handlers not set", async () => {
      const runtime = await McpBridgeRuntime.create();

      await expect(runtime.start()).rejects.toThrow(
        "Handlers must be set before starting the bridge",
      );
    });
  });

  describe("stop", () => {
    it("stops the bridge", async () => {
      const runtime = await McpBridgeRuntime.create();
      const handlers = createMockBridgeHandlers();

      await runtime.setHandlers(handlers);
      await runtime.start();
      await runtime.stop();

      const isRunning = await runtime.isRunning();
      expect(isRunning).toBe(false);
      expect(stopMcpBridgeServer).toHaveBeenCalled();
    });

    it("is safe to call when not running", async () => {
      const runtime = await McpBridgeRuntime.create();

      // Should not throw
      await expect(runtime.stop()).resolves.toBeUndefined();
    });
  });

  describe("restart", () => {
    it("restarts the bridge and returns new socket path", async () => {
      const runtime = await McpBridgeRuntime.create();
      const handlers = createMockBridgeHandlers();

      await runtime.setHandlers(handlers);
      await runtime.start();
      const newPath = await runtime.restart();

      expect(newPath).toContain("clive-mcp-");
      expect(stopMcpBridgeServer).toHaveBeenCalled();
      expect(startMcpBridgeServer).toHaveBeenCalledTimes(2);
    });
  });

  describe("onStatusChange", () => {
    it("calls callback with status updates", async () => {
      const runtime = await McpBridgeRuntime.create();
      const handlers = createMockBridgeHandlers();
      const statuses: Array<{ bridgeReady: boolean }> = [];

      const unsubscribe = runtime.onStatusChange((status) => {
        statuses.push({ bridgeReady: status.bridgeReady });
      });

      await runtime.setHandlers(handlers);
      await runtime.start();

      // Give time for async callbacks
      await new Promise((resolve) => setTimeout(resolve, 50));

      unsubscribe();

      // Should have received at least the ready status
      expect(statuses.some((s) => s.bridgeReady === true)).toBe(true);
    });

    it("returns unsubscribe function", async () => {
      const runtime = await McpBridgeRuntime.create();
      const callback = vi.fn();

      const unsubscribe = runtime.onStatusChange(callback);

      expect(typeof unsubscribe).toBe("function");

      // Calling unsubscribe should stop callbacks
      unsubscribe();
    });
  });

  describe("dispose", () => {
    it("cleans up resources", async () => {
      const runtime = await McpBridgeRuntime.create();
      const handlers = createMockBridgeHandlers();

      await runtime.setHandlers(handlers);
      await runtime.start();

      await runtime.dispose();

      // Should be cleaned up - scope closed
    });

    it("is idempotent", async () => {
      const runtime = await McpBridgeRuntime.create();

      // Multiple dispose calls should not throw
      await runtime.dispose();
      await runtime.dispose();
    });
  });

  describe("singleton getMcpBridgeRuntime", () => {
    it("returns singleton instance", async () => {
      const runtime1 = await getMcpBridgeRuntime();
      const runtime2 = await getMcpBridgeRuntime();

      expect(runtime1).toBe(runtime2);
    });
  });

  describe("resetMcpBridgeRuntime", () => {
    it("clears singleton and cleans up", async () => {
      const runtime1 = await getMcpBridgeRuntime();
      const handlers = createMockBridgeHandlers();

      await runtime1.setHandlers(handlers);
      await runtime1.start();

      await resetMcpBridgeRuntime();

      const runtime2 = await getMcpBridgeRuntime();

      // Should be a new instance
      expect(runtime2).not.toBe(runtime1);
    });

    it("is safe to call when no singleton exists", async () => {
      // Should not throw
      await expect(resetMcpBridgeRuntime()).resolves.toBeUndefined();
    });
  });
});
