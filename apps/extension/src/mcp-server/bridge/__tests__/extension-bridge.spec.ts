/**
 * Extension Bridge Tests
 * Tests for IPC client connecting MCP server to VSCode extension
 */

import type { Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockSocket,
  toJsonLine,
  waitFor,
} from "../../../__tests__/mock-factories/mcp-mocks.js";

// Mock the net module
vi.mock("node:net", () => ({
  connect: vi.fn(),
}));

// Import after mock
import * as net from "node:net";
import { ExtensionBridge } from "../extension-bridge.js";

describe("ExtensionBridge", () => {
  let mockSocket: ReturnType<typeof createMockSocket>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module to clear singleton
    vi.resetModules();
    mockSocket = createMockSocket();
    vi.mocked(net.connect).mockReturnValue(mockSocket as unknown as Socket);

    // Reset environment
    delete process.env.CLIVE_SOCKET;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("creates bridge with socket path", () => {
      const bridge = new ExtensionBridge("/tmp/test.sock");

      expect(bridge).toBeDefined();
      expect(bridge.isConnected()).toBe(false);
    });
  });

  describe("connect", () => {
    it("connects to socket path from constructor", async () => {
      const bridge = new ExtensionBridge("/tmp/test.sock");

      const connectPromise = bridge.connect();
      mockSocket.emit("connect");

      await connectPromise;

      expect(net.connect).toHaveBeenCalledWith("/tmp/test.sock");
      expect(bridge.isConnected()).toBe(true);
    });

    it("is idempotent when already connected", async () => {
      const bridge = new ExtensionBridge("/tmp/test.sock");

      const connectPromise1 = bridge.connect();
      mockSocket.emit("connect");
      await connectPromise1;

      // Second connect should return immediately
      await bridge.connect();

      expect(net.connect).toHaveBeenCalledTimes(1);
    });

    it("rejects on connection error", async () => {
      const bridge = new ExtensionBridge("/tmp/test.sock");

      const connectPromise = bridge.connect();
      mockSocket.emit("error", new Error("Connection refused"));

      await expect(connectPromise).rejects.toThrow("Connection refused");
    });
  });

  describe("call", () => {
    let bridge: ExtensionBridge;

    beforeEach(async () => {
      bridge = new ExtensionBridge("/tmp/test.sock");
      const connectPromise = bridge.connect();
      mockSocket.emit("connect");
      await connectPromise;
    });

    it("generates unique request IDs", async () => {
      const callPromise1 = bridge.call("method1", {});
      const callPromise2 = bridge.call("method2", {});

      // Check that two different requests were written
      expect(mockSocket.write).toHaveBeenCalledTimes(2);

      const call1 = JSON.parse(
        mockSocket.write.mock.calls[0][0].replace("\n", ""),
      );
      const call2 = JSON.parse(
        mockSocket.write.mock.calls[1][0].replace("\n", ""),
      );

      expect(call1.id).not.toBe(call2.id);

      // Clean up
      mockSocket.emit(
        "data",
        Buffer.from(toJsonLine({ id: call1.id, result: {} })),
      );
      mockSocket.emit(
        "data",
        Buffer.from(toJsonLine({ id: call2.id, result: {} })),
      );
      await Promise.all([callPromise1, callPromise2]);
    });

    it("sends newline-delimited JSON", async () => {
      const callPromise = bridge.call("testMethod", { foo: "bar" });

      expect(mockSocket.write).toHaveBeenCalled();
      const written = mockSocket.write.mock.calls[0][0] as string;
      expect(written.endsWith("\n")).toBe(true);

      const parsed = JSON.parse(written.replace("\n", ""));
      expect(parsed.method).toBe("testMethod");
      expect(parsed.params).toEqual({ foo: "bar" });

      // Resolve the call
      mockSocket.emit(
        "data",
        Buffer.from(toJsonLine({ id: parsed.id, result: "ok" })),
      );
      await callPromise;
    });

    it("resolves promise on success response", async () => {
      const callPromise = bridge.call("successMethod", {});

      const written = JSON.parse(
        mockSocket.write.mock.calls[0][0].replace("\n", ""),
      );
      mockSocket.emit(
        "data",
        Buffer.from(toJsonLine({ id: written.id, result: { data: "result" } })),
      );

      const result = await callPromise;
      expect(result).toEqual({ data: "result" });
    });

    it("rejects promise on error response", async () => {
      const callPromise = bridge.call("failMethod", {});

      const written = JSON.parse(
        mockSocket.write.mock.calls[0][0].replace("\n", ""),
      );
      mockSocket.emit(
        "data",
        Buffer.from(
          toJsonLine({ id: written.id, error: "Something went wrong" }),
        ),
      );

      await expect(callPromise).rejects.toThrow("Something went wrong");
    });

    it("throws if not connected", async () => {
      const disconnectedBridge = new ExtensionBridge("/tmp/test.sock");

      await expect(disconnectedBridge.call("method", {})).rejects.toThrow(
        "Not connected to extension",
      );
    });

    it("correlates responses by ID", async () => {
      const call1Promise = bridge.call("method1", {});
      const call2Promise = bridge.call("method2", {});

      const call1 = JSON.parse(
        mockSocket.write.mock.calls[0][0].replace("\n", ""),
      );
      const call2 = JSON.parse(
        mockSocket.write.mock.calls[1][0].replace("\n", ""),
      );

      // Respond in reverse order
      mockSocket.emit(
        "data",
        Buffer.from(toJsonLine({ id: call2.id, result: "result2" })),
      );
      mockSocket.emit(
        "data",
        Buffer.from(toJsonLine({ id: call1.id, result: "result1" })),
      );

      const [result1, result2] = await Promise.all([
        call1Promise,
        call2Promise,
      ]);
      expect(result1).toBe("result1");
      expect(result2).toBe("result2");
    });
  });

  describe("data handling", () => {
    let bridge: ExtensionBridge;

    beforeEach(async () => {
      bridge = new ExtensionBridge("/tmp/test.sock");
      const connectPromise = bridge.connect();
      mockSocket.emit("connect");
      await connectPromise;
    });

    it("buffers partial messages", async () => {
      const callPromise = bridge.call("bufferTest", {});

      const written = JSON.parse(
        mockSocket.write.mock.calls[0][0].replace("\n", ""),
      );
      const fullResponse = JSON.stringify({
        id: written.id,
        result: "buffered",
      });

      // Send in chunks
      mockSocket.emit("data", Buffer.from(fullResponse.substring(0, 10)));
      await waitFor(5);

      mockSocket.emit("data", Buffer.from(`${fullResponse.substring(10)}\n`));

      const result = await callPromise;
      expect(result).toBe("buffered");
    });

    it("handles multiple messages in one chunk", async () => {
      const call1Promise = bridge.call("multi1", {});
      const call2Promise = bridge.call("multi2", {});

      const call1 = JSON.parse(
        mockSocket.write.mock.calls[0][0].replace("\n", ""),
      );
      const call2 = JSON.parse(
        mockSocket.write.mock.calls[1][0].replace("\n", ""),
      );

      // Send both responses in one chunk
      const combined = `${toJsonLine({ id: call1.id, result: "r1" })}${toJsonLine({ id: call2.id, result: "r2" })}`;

      mockSocket.emit("data", Buffer.from(combined));

      const [r1, r2] = await Promise.all([call1Promise, call2Promise]);
      expect(r1).toBe("r1");
      expect(r2).toBe("r2");
    });

    it("handles JSON parse errors gracefully", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Send invalid JSON
      mockSocket.emit("data", Buffer.from("not valid json\n"));

      expect(consoleSpy).toHaveBeenCalledWith(
        "[ExtensionBridge] Failed to parse response:",
        expect.any(SyntaxError),
      );

      consoleSpy.mockRestore();
    });

    it("ignores unmatched response IDs", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Send response with unknown ID
      mockSocket.emit(
        "data",
        Buffer.from(toJsonLine({ id: "unknown-id", result: "ignored" })),
      );

      // Should not throw or log error for unmatched IDs
      await waitFor(10);

      consoleSpy.mockRestore();
    });
  });

  describe("timeout", () => {
    it("rejects after 30 second timeout", async () => {
      vi.useFakeTimers();

      const bridge = new ExtensionBridge("/tmp/test.sock");
      const connectPromise = bridge.connect();
      mockSocket.emit("connect");
      await connectPromise;

      const callPromise = bridge.call("slowMethod", {});

      // Advance time by 30 seconds
      vi.advanceTimersByTime(30000);

      await expect(callPromise).rejects.toThrow("Request slowMethod timed out");

      vi.useRealTimers();
    });

    it("cleans up pending request on timeout", async () => {
      vi.useFakeTimers();

      const bridge = new ExtensionBridge("/tmp/test.sock");
      const connectPromise = bridge.connect();
      mockSocket.emit("connect");
      await connectPromise;

      const callPromise = bridge.call("timeoutMethod", {});

      const written = JSON.parse(
        mockSocket.write.mock.calls[0][0].replace("\n", ""),
      );

      // Advance time by 30 seconds
      vi.advanceTimersByTime(30000);

      await expect(callPromise).rejects.toThrow();

      // Late response should be ignored (not cause errors)
      mockSocket.emit(
        "data",
        Buffer.from(toJsonLine({ id: written.id, result: "late" })),
      );

      vi.useRealTimers();
    });
  });

  describe("error handling", () => {
    it("rejects all pending requests on socket close", async () => {
      const bridge = new ExtensionBridge("/tmp/test.sock");
      const connectPromise = bridge.connect();
      mockSocket.emit("connect");
      await connectPromise;

      const call1Promise = bridge.call("method1", {});
      const call2Promise = bridge.call("method2", {});

      // Close the socket
      mockSocket.emit("close");

      await expect(call1Promise).rejects.toThrow("Connection closed");
      await expect(call2Promise).rejects.toThrow("Connection closed");
    });

    it("logs socket errors after connected", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const bridge = new ExtensionBridge("/tmp/test.sock");
      const connectPromise = bridge.connect();
      mockSocket.emit("connect");
      await connectPromise;

      const socketError = new Error("Connection reset");
      mockSocket.emit("error", socketError);

      expect(consoleSpy).toHaveBeenCalledWith(
        "[ExtensionBridge] Socket error:",
        socketError,
      );

      consoleSpy.mockRestore();
    });
  });

  describe("disconnect", () => {
    it("destroys socket on disconnect", async () => {
      const bridge = new ExtensionBridge("/tmp/test.sock");
      const connectPromise = bridge.connect();
      mockSocket.emit("connect");
      await connectPromise;

      bridge.disconnect();

      expect(mockSocket.destroy).toHaveBeenCalled();
    });

    it("sets connected to false", async () => {
      const bridge = new ExtensionBridge("/tmp/test.sock");
      const connectPromise = bridge.connect();
      mockSocket.emit("connect");
      await connectPromise;

      expect(bridge.isConnected()).toBe(true);

      bridge.disconnect();

      expect(bridge.isConnected()).toBe(false);
    });
  });

  describe("getExtensionBridge", () => {
    it("returns singleton instance", async () => {
      process.env.CLIVE_SOCKET = "/tmp/singleton.sock";

      // Use dynamic import after resetting modules
      vi.resetModules();
      const { getExtensionBridge: getBridge } = await import(
        "../extension-bridge.js"
      );

      const bridge1 = getBridge();
      const bridge2 = getBridge();

      expect(bridge1).toBe(bridge2);
    });

    it("throws if CLIVE_SOCKET not set", async () => {
      delete process.env.CLIVE_SOCKET;

      // Use dynamic import after resetting modules
      vi.resetModules();
      const { getExtensionBridge: getBridge } = await import(
        "../extension-bridge.js"
      );

      expect(() => getBridge()).toThrow(
        "CLIVE_SOCKET environment variable not set",
      );
    });
  });

  describe("ensureBridgeConnected", () => {
    it("connects if not already connected", async () => {
      process.env.CLIVE_SOCKET = "/tmp/ensure.sock";

      // Use dynamic import after resetting modules
      vi.resetModules();
      const { ensureBridgeConnected: ensureConnected } = await import(
        "../extension-bridge.js"
      );

      const bridgePromise = ensureConnected();
      mockSocket.emit("connect");

      const bridge = await bridgePromise;

      expect(bridge.isConnected()).toBe(true);
      expect(net.connect).toHaveBeenCalledWith("/tmp/ensure.sock");
    });

    it("returns existing bridge if connected", async () => {
      process.env.CLIVE_SOCKET = "/tmp/existing.sock";

      // Use dynamic import after resetting modules
      vi.resetModules();
      const { ensureBridgeConnected: ensureConnected } = await import(
        "../extension-bridge.js"
      );

      const promise1 = ensureConnected();
      mockSocket.emit("connect");
      const bridge1 = await promise1;

      const bridge2 = await ensureConnected();

      expect(bridge1).toBe(bridge2);
      expect(net.connect).toHaveBeenCalledTimes(1);
    });
  });
});
