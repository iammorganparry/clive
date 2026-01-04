/**
 * MCP Bridge Server Tests
 * Tests for IPC socket server handling requests from the MCP server
 */

import type { Server, Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockBridgeHandlers,
  createMockNetServer,
  createMockSocket,
  toJsonLine,
  waitFor,
} from "../../__tests__/mock-factories/mcp-mocks.js";

// Mock the net and fs modules
vi.mock("node:net", () => ({
  createServer: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

// Import after mocks are set up
import * as fs from "node:fs";
import * as net from "node:net";
import { startMcpBridgeServer, stopMcpBridgeServer } from "../server.js";
import type { BridgeHandlers } from "../types.js";

describe("MCP Bridge Server", () => {
  let mockServer: ReturnType<typeof createMockNetServer>;
  let connectionHandler: (socket: Socket) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = createMockNetServer();

    // Capture the connection handler when createServer is called
    vi.mocked(net.createServer).mockImplementation((handler) => {
      connectionHandler = handler as (socket: Socket) => void;
      return mockServer as unknown as Server;
    });

    // Default fs mocks
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("startMcpBridgeServer", () => {
    it("creates Unix socket server at specified path", async () => {
      const handlers = createMockBridgeHandlers();
      const socketPath = "/tmp/test.sock";

      const serverPromise = startMcpBridgeServer(socketPath, handlers);

      expect(net.createServer).toHaveBeenCalled();
      expect(mockServer.listen).toHaveBeenCalledWith(
        socketPath,
        expect.any(Function),
      );

      // Resolve the promise
      const server = await serverPromise;
      expect(server).toBe(mockServer);
    });

    it("cleans up existing socket file on start", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const handlers = createMockBridgeHandlers();
      const socketPath = "/tmp/existing.sock";

      await startMcpBridgeServer(socketPath, handlers);

      expect(fs.existsSync).toHaveBeenCalledWith(socketPath);
      expect(fs.unlinkSync).toHaveBeenCalledWith(socketPath);
    });

    it("ignores errors when cleaning up socket file", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const handlers = createMockBridgeHandlers();
      const socketPath = "/tmp/locked.sock";

      // Should not throw
      await expect(
        startMcpBridgeServer(socketPath, handlers),
      ).resolves.toBeDefined();
    });

    it("rejects when server emits error", async () => {
      const handlers = createMockBridgeHandlers();
      const socketPath = "/tmp/error.sock";

      // Override listen to not auto-resolve
      mockServer.listen = vi.fn().mockReturnValue(mockServer);

      const serverPromise = startMcpBridgeServer(socketPath, handlers);

      // Emit error on server
      mockServer.emit("error", new Error("Address already in use"));

      await expect(serverPromise).rejects.toThrow("Address already in use");
    });
  });

  describe("request handling", () => {
    // Helper to create fresh socket for each test
    function createTestSocket() {
      const socket = createMockSocket();
      return socket;
    }

    it("parses line-delimited JSON requests", async () => {
      const testSocket = createTestSocket();
      const handlers = createMockBridgeHandlers();
      await startMcpBridgeServer("/tmp/parse.sock", handlers);
      connectionHandler(testSocket as unknown as Socket);

      const request = { id: "req-1", method: "proposeTestPlan", params: {} };
      testSocket.emit("data", Buffer.from(toJsonLine(request)));

      await waitFor(10);

      expect(testSocket.write).toHaveBeenCalled();
      const response = JSON.parse(
        testSocket.write.mock.calls[0][0].replace("\n", ""),
      );
      expect(response.id).toBe("req-1");
    });

    it("dispatches requests to correct handlers", async () => {
      const testSocket = createTestSocket();
      const proposeHandler = vi.fn().mockResolvedValue({ success: true });
      const approveHandler = vi.fn().mockResolvedValue({ mode: "act" });

      const handlers: BridgeHandlers = {
        proposeTestPlan: proposeHandler,
        approvePlan: approveHandler,
      };

      await startMcpBridgeServer("/tmp/dispatch.sock", handlers);
      connectionHandler(testSocket as unknown as Socket);

      // Send proposeTestPlan request
      const request1 = {
        id: "req-1",
        method: "proposeTestPlan",
        params: { name: "test" },
      };
      testSocket.emit("data", Buffer.from(toJsonLine(request1)));

      await waitFor(10);

      expect(proposeHandler).toHaveBeenCalledWith({ name: "test" });
      expect(approveHandler).not.toHaveBeenCalled();
    });

    it("returns JSON response with matching ID", async () => {
      const testSocket = createTestSocket();
      const handlers: BridgeHandlers = {
        testMethod: vi.fn().mockResolvedValue({ data: "result" }),
      };

      await startMcpBridgeServer("/tmp/id.sock", handlers);
      connectionHandler(testSocket as unknown as Socket);

      const request = {
        id: "unique-req-123",
        method: "testMethod",
        params: {},
      };
      testSocket.emit("data", Buffer.from(toJsonLine(request)));

      await waitFor(10);

      expect(testSocket.write).toHaveBeenCalled();
      const response = JSON.parse(
        testSocket.write.mock.calls[0][0].replace("\n", ""),
      );
      expect(response.id).toBe("unique-req-123");
      expect(response.result).toEqual({ data: "result" });
    });

    it("returns error for unknown methods", async () => {
      const testSocket = createTestSocket();
      const handlers = createMockBridgeHandlers();
      await startMcpBridgeServer("/tmp/unknown.sock", handlers);
      connectionHandler(testSocket as unknown as Socket);

      const request = {
        id: "req-unknown",
        method: "unknownMethod",
        params: {},
      };
      testSocket.emit("data", Buffer.from(toJsonLine(request)));

      await waitFor(10);

      const response = JSON.parse(
        testSocket.write.mock.calls[0][0].replace("\n", ""),
      );
      expect(response.id).toBe("req-unknown");
      expect(response.error).toBe("Unknown method: unknownMethod");
      expect(response.result).toBeUndefined();
    });

    it("handles handler errors gracefully", async () => {
      const testSocket = createTestSocket();
      const handlers: BridgeHandlers = {
        failingMethod: vi.fn().mockRejectedValue(new Error("Handler crashed")),
      };

      await startMcpBridgeServer("/tmp/error.sock", handlers);
      connectionHandler(testSocket as unknown as Socket);

      const request = { id: "req-fail", method: "failingMethod", params: {} };
      testSocket.emit("data", Buffer.from(toJsonLine(request)));

      await waitFor(10);

      const response = JSON.parse(
        testSocket.write.mock.calls[0][0].replace("\n", ""),
      );
      expect(response.id).toBe("req-fail");
      expect(response.error).toBe("Handler crashed");
    });

    it("handles non-Error handler exceptions", async () => {
      const testSocket = createTestSocket();
      const handlers: BridgeHandlers = {
        throwString: vi.fn().mockRejectedValue("string error"),
      };

      await startMcpBridgeServer("/tmp/string-error.sock", handlers);
      connectionHandler(testSocket as unknown as Socket);

      const request = { id: "req-str", method: "throwString", params: {} };
      testSocket.emit("data", Buffer.from(toJsonLine(request)));

      await waitFor(10);

      const response = JSON.parse(
        testSocket.write.mock.calls[0][0].replace("\n", ""),
      );
      expect(response.error).toBe("Handler failed");
    });

    it("handles invalid JSON in stream", async () => {
      const testSocket = createTestSocket();
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const handlers = createMockBridgeHandlers();

      await startMcpBridgeServer("/tmp/invalid.sock", handlers);
      connectionHandler(testSocket as unknown as Socket);

      // Send invalid JSON
      testSocket.emit("data", Buffer.from("not valid json\n"));

      await waitFor(10);

      expect(consoleSpy).toHaveBeenCalledWith(
        "[MCP Bridge] Invalid JSON:",
        expect.any(SyntaxError),
      );
      // Should not write any response
      expect(testSocket.write).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("handles partial messages with buffering", async () => {
      const testSocket = createTestSocket();
      const handlers: BridgeHandlers = {
        bufferedMethod: vi
          .fn()
          .mockResolvedValue({ buffered: true }),
      };

      await startMcpBridgeServer("/tmp/buffer.sock", handlers);
      connectionHandler(testSocket as unknown as Socket);

      // Send message in chunks
      const fullRequest = { id: "req-buf", method: "bufferedMethod", params: {} };
      const fullMessage = `${JSON.stringify(fullRequest)}\n`;

      // Split into multiple chunks
      testSocket.emit("data", Buffer.from(fullMessage.substring(0, 10)));
      await waitFor(5);
      expect(testSocket.write).not.toHaveBeenCalled();

      testSocket.emit("data", Buffer.from(fullMessage.substring(10, 20)));
      await waitFor(5);
      expect(testSocket.write).not.toHaveBeenCalled();

      testSocket.emit("data", Buffer.from(fullMessage.substring(20)));
      await waitFor(10);

      expect(handlers.bufferedMethod).toHaveBeenCalled();
      expect(testSocket.write).toHaveBeenCalled();
    });

    it("handles multiple messages in one chunk", async () => {
      const testSocket = createTestSocket();
      const handlers: BridgeHandlers = {
        method1: vi.fn().mockResolvedValue({ n: 1 }),
        method2: vi.fn().mockResolvedValue({ n: 2 }),
      };

      await startMcpBridgeServer("/tmp/multi.sock", handlers);
      connectionHandler(testSocket as unknown as Socket);

      // Send two requests in one chunk
      const req1 = { id: "req-1", method: "method1", params: {} };
      const req2 = { id: "req-2", method: "method2", params: {} };
      const combined = toJsonLine(req1) + toJsonLine(req2);

      testSocket.emit("data", Buffer.from(combined));

      await waitFor(20);

      expect(handlers.method1).toHaveBeenCalled();
      expect(handlers.method2).toHaveBeenCalled();
      expect(testSocket.write).toHaveBeenCalledTimes(2);
    });

    it("skips empty lines", async () => {
      const testSocket = createTestSocket();
      const handlers: BridgeHandlers = {
        testMethod: vi.fn().mockResolvedValue({}),
      };

      await startMcpBridgeServer("/tmp/empty.sock", handlers);
      connectionHandler(testSocket as unknown as Socket);

      // Send with empty lines
      const request = { id: "req-1", method: "testMethod", params: {} };
      const message = `\n\n${toJsonLine(request)}\n\n`;

      testSocket.emit("data", Buffer.from(message));

      await waitFor(10);

      expect(handlers.testMethod).toHaveBeenCalledTimes(1);
    });

    it("logs socket errors", async () => {
      const testSocket = createTestSocket();
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const handlers = createMockBridgeHandlers();

      await startMcpBridgeServer("/tmp/sockerr.sock", handlers);
      connectionHandler(testSocket as unknown as Socket);

      // Emit socket error
      const socketError = new Error("Connection reset");
      testSocket.emit("error", socketError);

      expect(consoleSpy).toHaveBeenCalledWith(
        "[MCP Bridge] Socket error:",
        socketError,
      );

      consoleSpy.mockRestore();
    });
  });

  describe("stopMcpBridgeServer", () => {
    it("stops server and removes socket file", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const handlers = createMockBridgeHandlers();
      const socketPath = "/tmp/stop.sock";

      const server = await startMcpBridgeServer(socketPath, handlers);

      await stopMcpBridgeServer(server as unknown as Server, socketPath);

      expect(mockServer.close).toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalledWith(socketPath);
    });

    it("handles missing socket file on stop", async () => {
      // First call for start cleanup, second for stop
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false);

      const handlers = createMockBridgeHandlers();
      const socketPath = "/tmp/missing.sock";

      const server = await startMcpBridgeServer(socketPath, handlers);

      // Should not throw even if file doesn't exist
      await expect(
        stopMcpBridgeServer(server as unknown as Server, socketPath),
      ).resolves.toBeUndefined();
    });

    it("ignores cleanup errors on stop", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw new Error("Busy resource");
      });

      const handlers = createMockBridgeHandlers();
      const socketPath = "/tmp/busy.sock";

      const server = await startMcpBridgeServer(socketPath, handlers);

      // Should not throw
      await expect(
        stopMcpBridgeServer(server as unknown as Server, socketPath),
      ).resolves.toBeUndefined();
    });
  });

  describe("concurrent connections", () => {
    it("handles multiple client connections", async () => {
      const handlers: BridgeHandlers = {
        clientMethod: vi.fn().mockResolvedValue({ handled: true }),
      };

      await startMcpBridgeServer("/tmp/concurrent.sock", handlers);

      // Create two separate mock sockets for two clients
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      // Simulate two clients connecting
      connectionHandler(socket1 as unknown as Socket);
      connectionHandler(socket2 as unknown as Socket);

      // Send requests from both clients
      const req1 = { id: "client1-req", method: "clientMethod", params: { client: 1 } };
      const req2 = { id: "client2-req", method: "clientMethod", params: { client: 2 } };

      socket1.emit("data", Buffer.from(toJsonLine(req1)));
      socket2.emit("data", Buffer.from(toJsonLine(req2)));

      await waitFor(20);

      // Both should be handled
      expect(handlers.clientMethod).toHaveBeenCalledTimes(2);
      expect(socket1.write).toHaveBeenCalled();
      expect(socket2.write).toHaveBeenCalled();

      // Verify correct responses went to correct sockets
      const response1 = JSON.parse(socket1.write.mock.calls[0][0].replace("\n", ""));
      const response2 = JSON.parse(socket2.write.mock.calls[0][0].replace("\n", ""));
      expect(response1.id).toBe("client1-req");
      expect(response2.id).toBe("client2-req");
    });
  });
});
