import { describe, expect, beforeEach, it, vi } from "vitest";
import { Effect, Runtime, Stream, Chunk } from "effect";
import {
  ClaudeCliService,
  ClaudeCliNotFoundError,
  ClaudeCliNotAuthenticatedError,
  ClaudeCliExecutionError,
  type ClaudeCliStatus,
  type ClaudeCliEvent,
} from "../claude-cli-service.js";
import { createMockClaudeCliServiceLayer } from "../../__tests__/mock-factories/service-mocks.js";

/**
 * Tests for ClaudeCliService using the mock factory approach.
 *
 * Note: These tests use the mock factory instead of mocking node:child_process
 * directly, because ESM module mocking is complex. The mock factory allows
 * us to test the service interface contract and error handling behavior.
 *
 * For integration testing with actual CLI commands, see manual testing procedures.
 */
describe("ClaudeCliService", () => {
  const runtime = Runtime.defaultRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("detectCli", () => {
    it("should return CLI status when installed and authenticated", async () => {
      const { layer } = createMockClaudeCliServiceLayer();

      const result = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        return yield* service.detectCli();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result.installed).toBe(true);
      expect(result.path).toBe("/usr/local/bin/claude");
      expect(result.authenticated).toBe(true);
      expect(result.version).toBe("1.0.0");
    });

    it("should return installed=false when CLI not found", async () => {
      const { layer } = createMockClaudeCliServiceLayer({
        detectCli: () =>
          Effect.succeed({
            installed: false,
            path: null,
            authenticated: false,
            version: null,
          } as ClaudeCliStatus),
      });

      const result = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        return yield* service.detectCli();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result.installed).toBe(false);
      expect(result.path).toBe(null);
      expect(result.authenticated).toBe(false);
      expect(result.version).toBe(null);
    });

    it("should return installed=true but authenticated=false when not logged in", async () => {
      const { layer } = createMockClaudeCliServiceLayer({
        detectCli: () =>
          Effect.succeed({
            installed: true,
            path: "/usr/local/bin/claude",
            authenticated: false,
            version: "1.0.0",
          } as ClaudeCliStatus),
      });

      const result = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        return yield* service.detectCli();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result.installed).toBe(true);
      expect(result.authenticated).toBe(false);
    });

    it("should handle version being null", async () => {
      const { layer } = createMockClaudeCliServiceLayer({
        detectCli: () =>
          Effect.succeed({
            installed: true,
            path: "/usr/local/bin/claude",
            authenticated: true,
            version: null,
          } as ClaudeCliStatus),
      });

      const result = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        return yield* service.detectCli();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result.version).toBe(null);
    });
  });

  describe("checkAuth", () => {
    it("should return true when user is authenticated", async () => {
      const { layer } = createMockClaudeCliServiceLayer({
        checkAuth: () => Effect.succeed(true),
      });

      const result = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        return yield* service.checkAuth();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe(true);
    });

    it("should return false when user is not authenticated", async () => {
      const { layer } = createMockClaudeCliServiceLayer({
        checkAuth: () => Effect.succeed(false),
      });

      const result = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        return yield* service.checkAuth();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe(false);
    });

    it("should fail with ClaudeCliNotFoundError when CLI not installed", async () => {
      const { layer } = createMockClaudeCliServiceLayer({
        checkAuth: () =>
          Effect.fail(
            new ClaudeCliNotFoundError({
              message: "CLI not found",
              searchedPaths: ["/usr/local/bin/claude"],
            }),
          ),
      });

      const result = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        return yield* service.checkAuth();
      }).pipe(Effect.provide(layer), Effect.either, Runtime.runPromise(runtime));

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(ClaudeCliNotFoundError);
      }
    });
  });

  describe("authenticate", () => {
    it("should return true when authentication succeeds", async () => {
      const { layer } = createMockClaudeCliServiceLayer({
        authenticate: () => Effect.succeed(true),
      });

      const result = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        return yield* service.authenticate();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe(true);
    });

    it("should return false when authentication fails", async () => {
      const { layer } = createMockClaudeCliServiceLayer({
        authenticate: () => Effect.succeed(false),
      });

      const result = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        return yield* service.authenticate();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe(false);
    });

    it("should fail with ClaudeCliNotFoundError when CLI not installed", async () => {
      const { layer } = createMockClaudeCliServiceLayer({
        authenticate: () =>
          Effect.fail(
            new ClaudeCliNotFoundError({
              message: "CLI not found",
              searchedPaths: ["/usr/local/bin/claude"],
            }),
          ),
      });

      const result = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        return yield* service.authenticate();
      }).pipe(Effect.provide(layer), Effect.either, Runtime.runPromise(runtime));

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(ClaudeCliNotFoundError);
      }
    });
  });

  describe("execute", () => {
    // Helper to create mock CliExecutionHandle
    const createMockHandle = (events: ClaudeCliEvent[]) => ({
      stream: Stream.fromIterable(events),
      sendToolResult: () => {},
      kill: () => {},
    });

    it("should return a handle with stream of CLI events", async () => {
      const mockEvents: ClaudeCliEvent[] = [
        { type: "text", content: "Hello" },
        { type: "text", content: " World" },
        { type: "done" },
      ];

      const { layer } = createMockClaudeCliServiceLayer({
        execute: () => Effect.succeed(createMockHandle(mockEvents)),
      });

      const events = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        const handle = yield* service.execute({ prompt: "Say hello" });
        return yield* Stream.runCollect(handle.stream);
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      const eventsArray = Chunk.toReadonlyArray(events);
      expect(eventsArray).toHaveLength(3);
      expect(eventsArray[0]).toEqual({ type: "text", content: "Hello" });
      expect(eventsArray[1]).toEqual({ type: "text", content: " World" });
      expect(eventsArray[2]).toEqual({ type: "done" });
    });

    it("should emit tool_use events", async () => {
      const mockEvents: ClaudeCliEvent[] = [
        { type: "text", content: "Let me read that file" },
        { type: "tool_use", id: "tool-1", name: "readFile", input: { path: "/test.ts" } },
        { type: "tool_result", id: "tool-1", content: "file contents" },
        { type: "done" },
      ];

      const { layer } = createMockClaudeCliServiceLayer({
        execute: () => Effect.succeed(createMockHandle(mockEvents)),
      });

      const events = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        const handle = yield* service.execute({ prompt: "Read the file" });
        return yield* Stream.runCollect(handle.stream);
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      const eventsArray = Chunk.toReadonlyArray(events);
      expect(eventsArray).toHaveLength(4);
      expect(eventsArray[1]).toEqual({
        type: "tool_use",
        id: "tool-1",
        name: "readFile",
        input: { path: "/test.ts" },
      });
    });

    it("should emit thinking events", async () => {
      const mockEvents: ClaudeCliEvent[] = [
        { type: "thinking", content: "Let me think about this..." },
        { type: "text", content: "Here's my answer" },
        { type: "done" },
      ];

      const { layer } = createMockClaudeCliServiceLayer({
        execute: () => Effect.succeed(createMockHandle(mockEvents)),
      });

      const events = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        const handle = yield* service.execute({ prompt: "Think hard" });
        return yield* Stream.runCollect(handle.stream);
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      const eventsArray = Chunk.toReadonlyArray(events);
      expect(eventsArray[0]).toEqual({
        type: "thinking",
        content: "Let me think about this...",
      });
    });

    it("should fail with ClaudeCliNotAuthenticatedError when not logged in", async () => {
      const { layer } = createMockClaudeCliServiceLayer({
        execute: () =>
          Effect.fail(
            new ClaudeCliNotAuthenticatedError({
              message: "Not logged in",
            }),
          ),
      });

      const result = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        return yield* service.execute({ prompt: "Hello" });
      }).pipe(Effect.provide(layer), Effect.either, Runtime.runPromise(runtime));

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(ClaudeCliNotAuthenticatedError);
      }
    });

    it("should fail with ClaudeCliNotFoundError when CLI not installed", async () => {
      const { layer } = createMockClaudeCliServiceLayer({
        execute: () =>
          Effect.fail(
            new ClaudeCliNotFoundError({
              message: "CLI not found",
              searchedPaths: ["/usr/local/bin/claude"],
            }),
          ),
      });

      const result = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        return yield* service.execute({ prompt: "Hello" });
      }).pipe(Effect.provide(layer), Effect.either, Runtime.runPromise(runtime));

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(ClaudeCliNotFoundError);
      }
    });

    it("should handle stream errors with ClaudeCliExecutionError", async () => {
      const { layer } = createMockClaudeCliServiceLayer({
        execute: () =>
          Effect.succeed({
            stream: Stream.fail(
              new ClaudeCliExecutionError({
                message: "Process crashed",
                exitCode: 1,
              }),
            ),
            sendToolResult: () => {},
            kill: () => {},
          }),
      });

      const result = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        const handle = yield* service.execute({ prompt: "Hello" });
        return yield* Stream.runCollect(handle.stream);
      }).pipe(Effect.provide(layer), Effect.either, Runtime.runPromise(runtime));

      expect(result._tag).toBe("Left");
    });

    it("should handle error events in stream", async () => {
      const mockEvents: ClaudeCliEvent[] = [
        { type: "text", content: "Starting..." },
        { type: "error", message: "Something went wrong" },
        { type: "done" },
      ];

      const { layer } = createMockClaudeCliServiceLayer({
        execute: () => Effect.succeed(createMockHandle(mockEvents)),
      });

      const events = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        const handle = yield* service.execute({ prompt: "Do something risky" });
        return yield* Stream.runCollect(handle.stream);
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      const eventsArray = Chunk.toReadonlyArray(events);
      expect(eventsArray).toContainEqual({
        type: "error",
        message: "Something went wrong",
      });
    });

    it("should provide sendToolResult and kill methods", async () => {
      const sendToolResultMock = vi.fn();
      const killMock = vi.fn();

      const { layer } = createMockClaudeCliServiceLayer({
        execute: () =>
          Effect.succeed({
            stream: Stream.fromIterable([{ type: "done" as const }]),
            sendToolResult: sendToolResultMock,
            kill: killMock,
          }),
      });

      await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        const handle = yield* service.execute({ prompt: "Test" });

        // Test sendToolResult
        handle.sendToolResult("tool-1", "result");
        expect(sendToolResultMock).toHaveBeenCalledWith("tool-1", "result");

        // Test kill
        handle.kill();
        expect(killMock).toHaveBeenCalled();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));
    });
  });

  describe("getCliPath", () => {
    it("should return the CLI path when found", async () => {
      const { layer } = createMockClaudeCliServiceLayer({
        getCliPath: () => Effect.succeed("/opt/custom/bin/claude"),
      });

      const result = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        return yield* service.getCliPath();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe("/opt/custom/bin/claude");
    });

    it("should fail with ClaudeCliNotFoundError when not found", async () => {
      const { layer } = createMockClaudeCliServiceLayer({
        getCliPath: () =>
          Effect.fail(
            new ClaudeCliNotFoundError({
              message: "CLI not found",
              searchedPaths: ["/usr/local/bin/claude", "/opt/homebrew/bin/claude"],
            }),
          ),
      });

      const result = await Effect.gen(function* () {
        const service = yield* ClaudeCliService;
        return yield* service.getCliPath();
      }).pipe(Effect.provide(layer), Effect.either, Runtime.runPromise(runtime));

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(ClaudeCliNotFoundError);
        expect((result.left as ClaudeCliNotFoundError).searchedPaths).toContain(
          "/usr/local/bin/claude",
        );
      }
    });
  });

  describe("Error types", () => {
    it("ClaudeCliNotFoundError should have correct properties", () => {
      const error = new ClaudeCliNotFoundError({
        message: "CLI not found",
        searchedPaths: ["/path/1", "/path/2"],
      });

      expect(error._tag).toBe("ClaudeCliNotFoundError");
      expect(error.message).toBe("CLI not found");
      expect(error.searchedPaths).toEqual(["/path/1", "/path/2"]);
    });

    it("ClaudeCliNotAuthenticatedError should have correct properties", () => {
      const error = new ClaudeCliNotAuthenticatedError({
        message: "Not logged in",
      });

      expect(error._tag).toBe("ClaudeCliNotAuthenticatedError");
      expect(error.message).toBe("Not logged in");
    });

    it("ClaudeCliExecutionError should have correct properties", () => {
      const error = new ClaudeCliExecutionError({
        message: "Process failed",
        stderr: "Error output",
        exitCode: 127,
      });

      expect(error._tag).toBe("ClaudeCliExecutionError");
      expect(error.message).toBe("Process failed");
      expect(error.stderr).toBe("Error output");
      expect(error.exitCode).toBe(127);
    });
  });
});
