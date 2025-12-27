/**
 * Shared child process mock factory for unit tests
 * Provides reusable mocks for Node.js child_process.spawn operations
 */

import { vi, type Mock } from "vitest";
import type { ChildProcess } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import type { SpawnFn } from "../../services/ai-agent/tools/bash-execute.js";

export interface MockChildProcess {
  stdout: { on: (event: string, handler: (data: Buffer) => void) => void };
  stderr: { on: (event: string, handler: (data: Buffer) => void) => void };
  on: (event: string, handler: (code: number | Error) => void) => void;
  kill: () => void;
}

export interface ChildProcessHandlers {
  onStdoutData?: (handler: (data: Buffer) => void) => void;
  onStderrData?: (handler: (data: Buffer) => void) => void;
  onClose?: (handler: (code: number) => void) => void;
  onError?: (handler: (error: Error) => void) => void;
}

/**
 * Create a mock ChildProcess with configurable event handlers
 */
export function createMockChildProcess(
  handlers: ChildProcessHandlers = {},
): MockChildProcess {
  let stdoutHandler: ((data: Buffer) => void) | undefined;
  let stderrHandler: ((data: Buffer) => void) | undefined;
  let closeHandler: ((code: number) => void) | undefined;
  let errorHandler: ((error: Error) => void) | undefined;

  return {
    stdout: {
      on: vi.fn((event: string, handler: (data: Buffer) => void) => {
        if (event === "data") {
          stdoutHandler = handler;
          handlers.onStdoutData?.(handler);
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, handler: (data: Buffer) => void) => {
        if (event === "data") {
          stderrHandler = handler;
          handlers.onStderrData?.(handler);
        }
      }),
    },
    on: vi.fn((event: string, handler: (code: number | Error) => void) => {
      if (event === "close") {
        closeHandler = handler as (code: number) => void;
        handlers.onClose?.(handler as (code: number) => void);
      } else if (event === "error") {
        errorHandler = handler as (error: Error) => void;
        handlers.onError?.(handler as (error: Error) => void);
      }
    }),
    kill: vi.fn(),
  };
}

/**
 * Create a mock spawn function that returns a mock child process
 */
export function createMockSpawn(): SpawnFn {
  return vi.fn<SpawnFn>(
    (_command: string, _options: SpawnOptions): ChildProcess => {
      return createMockChildProcess() as unknown as ChildProcess;
    },
  );
}

/**
 * Helper to create a spawn mock with a pre-configured child process
 */
export function createMockSpawnWithChild(
  child: MockChildProcess,
): SpawnFn {
  return vi.fn<SpawnFn>(
    (_command: string, _options: SpawnOptions): ChildProcess => {
      return child as unknown as ChildProcess;
    },
  );
}

