/**
 * MCP Mock Factories
 * Shared test utilities for MCP bridge and server testing
 */

import { vi } from "vitest";
import { EventEmitter } from "node:events";
import type {
  BridgeHandlers,
  BridgeRequest,
  BridgeResponse,
  McpBridgeStatus,
} from "../../mcp-bridge/types.js";

/**
 * Mock Socket for IPC testing
 */
export interface MockSocket extends EventEmitter {
  write: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
}

export function createMockSocket(): MockSocket {
  const emitter = new EventEmitter() as MockSocket;
  emitter.write = vi.fn().mockReturnValue(true);
  emitter.destroy = vi.fn();
  emitter.connect = vi.fn();
  return emitter;
}

/**
 * Socket Event Simulator for testing data flow
 */
export interface SocketEventSimulator {
  socket: MockSocket;
  simulateData(data: string): void;
  simulateConnect(): void;
  simulateClose(): void;
  simulateError(error: Error): void;
}

export function createSocketEventSimulator(): SocketEventSimulator {
  const socket = createMockSocket();

  return {
    socket,
    simulateData(data: string) {
      socket.emit("data", Buffer.from(data));
    },
    simulateConnect() {
      socket.emit("connect");
    },
    simulateClose() {
      socket.emit("close");
    },
    simulateError(error: Error) {
      socket.emit("error", error);
    },
  };
}

/**
 * Mock net.Server for bridge server testing
 */
export interface MockNetServer extends EventEmitter {
  listen: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  address: ReturnType<typeof vi.fn>;
}

export function createMockNetServer(): MockNetServer {
  const server = new EventEmitter() as MockNetServer;
  server.listen = vi.fn().mockImplementation((_path: string, callback?: () => void) => {
    if (callback) {
      setImmediate(callback);
    }
    return server;
  });
  server.close = vi.fn().mockImplementation((callback?: () => void) => {
    if (callback) {
      setImmediate(callback);
    }
  });
  server.address = vi.fn().mockReturnValue({ port: 0 });
  return server;
}

/**
 * Mock BridgeHandlers for testing handler dispatch
 */
export function createMockBridgeHandlers(
  overrides?: Partial<BridgeHandlers>,
): BridgeHandlers {
  return {
    proposeTestPlan:
      overrides?.proposeTestPlan ??
      vi.fn().mockResolvedValue({
        success: true,
        planId: "test-plan-123",
        filePath: ".clive/plans/test-plan.md",
        message: "Test plan created",
      }),
    approvePlan:
      overrides?.approvePlan ??
      vi.fn().mockResolvedValue({
        success: true,
        mode: "act" as const,
        message: "Plan approved",
      }),
    summarizeContext:
      overrides?.summarizeContext ??
      vi.fn().mockResolvedValue({
        success: true,
        tokensBefore: 10000,
        tokensAfter: 2000,
        message: "Context summarized",
      }),
  };
}

/**
 * Bridge Response Builders for testing
 */
export function buildBridgeResponse(
  id: string,
  result?: unknown,
  error?: string,
): BridgeResponse {
  if (error) {
    return { id, error };
  }
  return { id, result };
}

export function buildProposeTestPlanResponse(planId: string, filePath: string) {
  return {
    success: true,
    planId,
    filePath,
    message: `Test plan created: ${planId}`,
  };
}

export function buildApprovePlanResponse(mode: "plan" | "act") {
  return {
    success: true,
    mode,
    message: mode === "act" ? "Plan approved" : "Plan rejected",
  };
}

export function buildSummarizeContextResponse(
  tokensBefore: number,
  tokensAfter: number,
) {
  return {
    success: true,
    tokensBefore,
    tokensAfter,
    message: `Context summarized. Reduced from ~${tokensBefore} to ~${tokensAfter} tokens.`,
  };
}

/**
 * Bridge Request Builder for testing
 */
export function buildBridgeRequest(
  method: string,
  params: unknown,
  id?: string,
): BridgeRequest {
  return {
    id: id ?? `req-${Date.now()}`,
    method,
    params,
  };
}

/**
 * Mock McpBridgeStatus for testing
 */
export function createMockBridgeStatus(
  overrides?: Partial<McpBridgeStatus>,
): McpBridgeStatus {
  return {
    bridgeReady: false,
    starting: false,
    error: null,
    socketPath: null,
    ...overrides,
  };
}

/**
 * Mock file system for knowledge search testing
 */
export interface MockFileSystem {
  files: Map<string, string>;
  readFile: ReturnType<typeof vi.fn>;
  stat: ReturnType<typeof vi.fn>;
  readdir: ReturnType<typeof vi.fn>;
  access: ReturnType<typeof vi.fn>;
}

export function createMockFileSystem(
  files: Record<string, string>,
): MockFileSystem {
  const fileMap = new Map(Object.entries(files));

  return {
    files: fileMap,
    readFile: vi.fn().mockImplementation(async (path: string) => {
      const content = fileMap.get(path);
      if (content === undefined) {
        const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
        (error as NodeJS.ErrnoException).code = "ENOENT";
        throw error;
      }
      return content;
    }),
    stat: vi.fn().mockImplementation(async (path: string) => {
      if (fileMap.has(path)) {
        return { isFile: () => true, isDirectory: () => false };
      }
      // Check if it's a directory prefix
      const isDir = Array.from(fileMap.keys()).some((key) =>
        key.startsWith(`${path}/`),
      );
      if (isDir) {
        return { isFile: () => false, isDirectory: () => true };
      }
      const error = new Error(`ENOENT: no such file or directory, stat '${path}'`);
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    }),
    readdir: vi.fn().mockImplementation(async (path: string) => {
      const entries = new Set<string>();
      const prefix = path.endsWith("/") ? path : `${path}/`;
      for (const key of fileMap.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const nextSlash = rest.indexOf("/");
          entries.add(nextSlash === -1 ? rest : rest.slice(0, nextSlash));
        }
      }
      return Array.from(entries);
    }),
    access: vi.fn().mockImplementation(async (path: string) => {
      if (!fileMap.has(path)) {
        const isDir = Array.from(fileMap.keys()).some((key) =>
          key.startsWith(`${path}/`),
        );
        if (!isDir) {
          const error = new Error(`ENOENT: no such file or directory, access '${path}'`);
          (error as NodeJS.ErrnoException).code = "ENOENT";
          throw error;
        }
      }
    }),
  };
}

/**
 * Mock glob for file discovery testing
 */
export function createMockGlob(files: string[]) {
  return vi.fn().mockResolvedValue(files);
}

/**
 * Mock environment variables for testing
 */
export function setupMockEnv(env: Record<string, string | undefined>) {
  const originalEnv = { ...process.env };

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    // Restore original environment
    for (const key of Object.keys(env)) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  };
}

/**
 * JSON-LD message helpers for testing line-delimited protocol
 */
export function toJsonLine(data: unknown): string {
  return `${JSON.stringify(data)}\n`;
}

export function parseJsonLines(data: string): unknown[] {
  return data
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/**
 * Timeout helper for async testing
 */
export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mock net module factory
 */
export function createMockNetModule() {
  const mockServer = createMockNetServer();
  const mockSocket = createMockSocket();

  return {
    mockServer,
    mockSocket,
    createServer: vi.fn().mockReturnValue(mockServer),
    connect: vi.fn().mockReturnValue(mockSocket),
  };
}
