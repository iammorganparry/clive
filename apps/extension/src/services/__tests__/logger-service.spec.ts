import { Effect, Runtime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { createLoggerLayer } from "../logger-service.js";

describe("LoggerService", () => {
  let mockOutputChannel: vscode.OutputChannel;
  let loggedMessages: string[];
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: string | undefined;

  beforeEach(() => {
    loggedMessages = [];
    mockOutputChannel = {
      appendLine: vi.fn((message: string) => {
        loggedMessages.push(message);
      }),
    } as unknown as vscode.OutputChannel;

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    originalEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    process.env.NODE_ENV = originalEnv;
  });

  describe("createLoggerLayer - Production Mode (isDev = false)", () => {
    it("should filter out debug logs in production mode", async () => {
      const loggerLayer = createLoggerLayer(mockOutputChannel, false);
      const runtime = Runtime.defaultRuntime;

      await Effect.gen(function* () {
        yield* Effect.logDebug("This debug message should be filtered");
        yield* Effect.logInfo("This info message should be logged");
        yield* Effect.logWarning("This warning should be logged");
        yield* Effect.logError("This error should be logged");
      })
        .pipe(Effect.provide(loggerLayer))
        .pipe(Runtime.runPromise(runtime));

      // Debug message should not be logged
      expect(loggedMessages).not.toContainEqual(
        expect.stringContaining("This debug message should be filtered"),
      );

      // Info, Warning, and Error should be logged
      expect(
        loggedMessages.some((msg) => msg.includes("This info message")),
      ).toBe(true);
      expect(loggedMessages.some((msg) => msg.includes("This warning"))).toBe(
        true,
      );
      expect(loggedMessages.some((msg) => msg.includes("This error"))).toBe(
        true,
      );
    });

    it("should not log to console in production mode", async () => {
      const loggerLayer = createLoggerLayer(mockOutputChannel, false);
      const runtime = Runtime.defaultRuntime;

      await Effect.gen(function* () {
        yield* Effect.logInfo("This should only go to OutputChannel");
        yield* Effect.logWarning("This should only go to OutputChannel");
      })
        .pipe(Effect.provide(loggerLayer))
        .pipe(Runtime.runPromise(runtime));

      // Console.log should not be called in production mode
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("should format log messages with correct prefix", async () => {
      const loggerLayer = createLoggerLayer(mockOutputChannel, false);
      const runtime = Runtime.defaultRuntime;

      await Effect.gen(function* () {
        yield* Effect.logInfo("Test message");
      })
        .pipe(Effect.provide(loggerLayer))
        .pipe(Runtime.runPromise(runtime));

      expect(loggedMessages.length).toBeGreaterThan(0);
      const infoMessage = loggedMessages.find((msg) =>
        msg.includes("Test message"),
      );
      expect(infoMessage).toBeDefined();
      expect(infoMessage).toMatch(/\[Clive:INFO\]/);
    });

    it("should log different log levels with correct labels", async () => {
      const loggerLayer = createLoggerLayer(mockOutputChannel, false);
      const runtime = Runtime.defaultRuntime;

      await Effect.gen(function* () {
        yield* Effect.logInfo("Info message");
        yield* Effect.logWarning("Warning message");
        yield* Effect.logError("Error message");
      })
        .pipe(Effect.provide(loggerLayer))
        .pipe(Runtime.runPromise(runtime));

      const infoMsg = loggedMessages.find((msg) =>
        msg.includes("Info message"),
      );
      const warningMsg = loggedMessages.find((msg) =>
        msg.includes("Warning message"),
      );
      const errorMsg = loggedMessages.find((msg) =>
        msg.includes("Error message"),
      );

      expect(infoMsg).toMatch(/\[Clive:INFO\]/);
      expect(warningMsg).toMatch(/\[Clive:WARN\]/);
      expect(errorMsg).toMatch(/\[Clive:ERROR\]/);
    });
  });

  describe("createLoggerLayer - Dev Mode (isDev = true)", () => {
    it("should include debug logs in dev mode", async () => {
      const loggerLayer = createLoggerLayer(mockOutputChannel, true);
      const runtime = Runtime.defaultRuntime;

      await Effect.gen(function* () {
        yield* Effect.logDebug("This debug message should be logged");
        yield* Effect.logInfo("This info message should be logged");
      })
        .pipe(Effect.provide(loggerLayer))
        .pipe(Runtime.runPromise(runtime));

      // Both debug and info should be logged
      expect(
        loggedMessages.some((msg) => msg.includes("This debug message")),
      ).toBe(true);
      expect(
        loggedMessages.some((msg) => msg.includes("This info message")),
      ).toBe(true);
    });

    it("should log to console in dev mode", async () => {
      const loggerLayer = createLoggerLayer(mockOutputChannel, true);
      const runtime = Runtime.defaultRuntime;

      await Effect.gen(function* () {
        yield* Effect.logInfo(
          "This should go to both OutputChannel and console",
        );
        yield* Effect.logDebug("This debug should also go to console");
      })
        .pipe(Effect.provide(loggerLayer))
        .pipe(Runtime.runPromise(runtime));

      // Console.log should be called in dev mode
      expect(consoleLogSpy).toHaveBeenCalled();
      expect(consoleLogSpy.mock.calls.length).toBeGreaterThan(0);
    });

    it("should format debug messages correctly in dev mode", async () => {
      const loggerLayer = createLoggerLayer(mockOutputChannel, true);
      const runtime = Runtime.defaultRuntime;

      await Effect.gen(function* () {
        yield* Effect.logDebug("Debug test message");
      })
        .pipe(Effect.provide(loggerLayer))
        .pipe(Runtime.runPromise(runtime));

      const debugMessage = loggedMessages.find((msg) =>
        msg.includes("Debug test message"),
      );
      expect(debugMessage).toBeDefined();
      expect(debugMessage).toMatch(/\[Clive:DEBUG\]/);
    });
  });

  describe("Log Level Filtering", () => {
    it("should respect minimum log level in production (Info)", async () => {
      const loggerLayer = createLoggerLayer(mockOutputChannel, false);
      const runtime = Runtime.defaultRuntime;

      await Effect.gen(function* () {
        yield* Effect.logDebug("Debug - should be filtered");
        yield* Effect.logInfo("Info - should be logged");
        yield* Effect.logWarning("Warning - should be logged");
        yield* Effect.logError("Error - should be logged");
        yield* Effect.logFatal("Fatal - should be logged");
      })
        .pipe(Effect.provide(loggerLayer))
        .pipe(Runtime.runPromise(runtime));

      // Debug should be filtered
      expect(
        loggedMessages.some((msg) =>
          msg.includes("Debug - should be filtered"),
        ),
      ).toBe(false);

      // All other levels should be logged
      expect(loggedMessages.some((msg) => msg.includes("Info -"))).toBe(true);
      expect(loggedMessages.some((msg) => msg.includes("Warning -"))).toBe(
        true,
      );
      expect(loggedMessages.some((msg) => msg.includes("Error -"))).toBe(true);
      expect(loggedMessages.some((msg) => msg.includes("Fatal -"))).toBe(true);
    });

    it("should respect minimum log level in dev mode (Debug)", async () => {
      const loggerLayer = createLoggerLayer(mockOutputChannel, true);
      const runtime = Runtime.defaultRuntime;

      await Effect.gen(function* () {
        yield* Effect.logDebug("Debug - should be logged");
        yield* Effect.logInfo("Info - should be logged");
        yield* Effect.logWarning("Warning - should be logged");
        yield* Effect.logError("Error - should be logged");
        yield* Effect.logFatal("Fatal - should be logged");
      })
        .pipe(Effect.provide(loggerLayer))
        .pipe(Runtime.runPromise(runtime));

      // All levels should be logged in dev mode
      expect(loggedMessages.some((msg) => msg.includes("Debug -"))).toBe(true);
      expect(loggedMessages.some((msg) => msg.includes("Info -"))).toBe(true);
      expect(loggedMessages.some((msg) => msg.includes("Warning -"))).toBe(
        true,
      );
      expect(loggedMessages.some((msg) => msg.includes("Error -"))).toBe(true);
      expect(loggedMessages.some((msg) => msg.includes("Fatal -"))).toBe(true);
    });
  });

  describe("OutputChannel Integration", () => {
    it("should always write to OutputChannel regardless of mode", async () => {
      const loggerLayerProd = createLoggerLayer(mockOutputChannel, false);
      const loggerLayerDev = createLoggerLayer(mockOutputChannel, true);
      const runtime = Runtime.defaultRuntime;

      // Test production mode
      loggedMessages = [];
      await Effect.gen(function* () {
        yield* Effect.logInfo("Production message");
      })
        .pipe(Effect.provide(loggerLayerProd))
        .pipe(Runtime.runPromise(runtime));

      expect(mockOutputChannel.appendLine).toHaveBeenCalled();

      // Test dev mode
      loggedMessages = [];
      await Effect.gen(function* () {
        yield* Effect.logInfo("Dev message");
      })
        .pipe(Effect.provide(loggerLayerDev))
        .pipe(Runtime.runPromise(runtime));

      expect(mockOutputChannel.appendLine).toHaveBeenCalled();
    });

    it("should append all log messages to OutputChannel", async () => {
      const loggerLayer = createLoggerLayer(mockOutputChannel, true);
      const runtime = Runtime.defaultRuntime;

      await Effect.gen(function* () {
        yield* Effect.logDebug("Message 1");
        yield* Effect.logInfo("Message 2");
        yield* Effect.logWarning("Message 3");
      })
        .pipe(Effect.provide(loggerLayer))
        .pipe(Runtime.runPromise(runtime));

      expect(mockOutputChannel.appendLine).toHaveBeenCalledTimes(3);
      expect(loggedMessages.length).toBe(3);
    });
  });

  describe("Message Formatting", () => {
    it("should format messages with Clive prefix and log level", async () => {
      const loggerLayer = createLoggerLayer(mockOutputChannel, false);
      const runtime = Runtime.defaultRuntime;

      await Effect.gen(function* () {
        yield* Effect.logInfo("Test message");
      })
        .pipe(Effect.provide(loggerLayer))
        .pipe(Runtime.runPromise(runtime));

      const message = loggedMessages[0];
      expect(message).toContain("[Clive:");
      expect(message).toContain("]");
      expect(message).toContain("Test message");
    });

    it("should handle messages with special characters", async () => {
      const loggerLayer = createLoggerLayer(mockOutputChannel, false);
      const runtime = Runtime.defaultRuntime;

      const specialMessage = "Test with special chars: !@#$%^&*()";

      await Effect.gen(function* () {
        yield* Effect.logInfo(specialMessage);
      })
        .pipe(Effect.provide(loggerLayer))
        .pipe(Runtime.runPromise(runtime));

      const message = loggedMessages[0];
      expect(message).toContain(specialMessage);
    });

    it("should handle empty messages", async () => {
      const loggerLayer = createLoggerLayer(mockOutputChannel, false);
      const runtime = Runtime.defaultRuntime;

      await Effect.gen(function* () {
        yield* Effect.logInfo("");
      })
        .pipe(Effect.provide(loggerLayer))
        .pipe(Runtime.runPromise(runtime));

      expect(loggedMessages.length).toBeGreaterThan(0);
      const message = loggedMessages[0];
      expect(message).toMatch(/\[Clive:INFO\]/);
    });
  });
});
