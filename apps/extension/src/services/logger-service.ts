import { Effect, Layer, Logger, LogLevel } from "effect";
import type * as vscode from "vscode";

/**
 * Logger service for Effect-based logging
 * Provides centralized logging that outputs to both VS Code OutputChannel and console
 */
export class LoggerService extends Effect.Service<LoggerService>()(
  "LoggerService",
  {
    effect: Effect.succeed({
      outputChannel: undefined as vscode.OutputChannel | undefined,
    }),
    dependencies: [],
  },
) {}

/**
 * Create a logger layer that outputs to VS Code OutputChannel and optionally console
 * @param outputChannel - VS Code OutputChannel for logging
 * @param isDev - Whether to enable debug logging and console output
 * @returns Layer with custom logger configured
 */
export const createLoggerLayer = (
  outputChannel: vscode.OutputChannel,
  isDev: boolean,
): Layer.Layer<never> => {
  const cliveLogger = Logger.make(({ logLevel, message }) => {
    const formatted = `[Clive:${logLevel.label}] ${message}`;
    outputChannel.appendLine(formatted);
    if (isDev) {
      console.log(formatted);
    }
  });

  return Layer.merge(
    Logger.replace(Logger.defaultLogger, cliveLogger),
    Logger.minimumLogLevel(isDev ? LogLevel.Debug : LogLevel.Info),
  );
};
