import type * as vscode from "vscode";

// Build-time constant injected by esbuild
declare const __DEV__: boolean;

// Global output channel reference
let globalOutputChannel: vscode.OutputChannel | undefined;

/**
 * Set the global output channel (called during extension activation)
 */
export function setGlobalOutputChannel(channel: vscode.OutputChannel): void {
  globalOutputChannel = channel;
}

/**
 * Log to VS Code Output Channel (always visible, even in installed mode)
 * Falls back to console.log if output channel not set
 */
export function logToOutput(
  message: string,
  level: "DEBUG" | "INFO" | "WARN" | "ERROR" = "DEBUG",
): void {
  const formatted = `[Clive:${level}] ${message}`;
  if (globalOutputChannel) {
    globalOutputChannel.appendLine(formatted);
  }
  // Always log to console in non-production builds
  if (__DEV__) {
    console.log(formatted);
  }
}
