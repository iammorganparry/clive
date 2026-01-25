/**
 * Entry point for Clive TUI
 * Initializes OpenTUI/React renderer and mounts the App component
 */

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import App from "./App";
import { debugLog, getLogFilePath } from "./utils/debug-logger";

// Parse command line arguments
const args = process.argv.slice(2);
const hasDebugFlag = args.includes("--debug") || args.includes("-d");

// Parse workspace directory argument (for development)
const workspaceArgIndex = args.findIndex(
  (arg) => arg.startsWith("--workspace=") || arg.startsWith("--cwd="),
);
let userWorkspace: string | undefined;
if (workspaceArgIndex !== -1) {
  const argValue = args[workspaceArgIndex];
  userWorkspace = argValue.split("=")[1];
  debugLog("main", "User workspace specified via argument", { userWorkspace });
}

// Set the workspace as environment variable so App.tsx can access it
if (userWorkspace) {
  process.env.CLIVE_WORKSPACE = userWorkspace;
}

// Enable debug mode if --debug flag is present
if (hasDebugFlag) {
  process.env.DEBUG = "true";
  process.env.NODE_ENV = "development";
}

// Log startup
debugLog("main", "Clive TUI starting up", {
  args: args,
  workspace: userWorkspace || process.cwd(),
  debugEnabled:
    hasDebugFlag ||
    !!process.env.DEBUG ||
    process.env.NODE_ENV === "development",
});

if (process.env.DEBUG || process.env.NODE_ENV === "development") {
  console.log(`\nDebug logging enabled. Log file: ${getLogFilePath()}\n`);
  console.log(
    "Tail logs in another terminal: tail -f ~/.clive/tui-debug.log\n",
  );
}

// Emergency exit handler - register BEFORE OpenTUI takes control
let sigintCount = 0;
let exitInProgress = false;

const emergencyExit = (signal: string) => {
  sigintCount++;

  debugLog(
    "main",
    `Emergency exit triggered (signal: ${signal}, count: ${sigintCount})`,
  );

  if (sigintCount >= 2 || exitInProgress) {
    // Second Ctrl+C or already exiting - force kill immediately
    debugLog("main", "Force killing process NOW");
    console.log("\nForce exit...\n");
    process.exit(1);
  } else {
    // First Ctrl+C - give 300ms for cleanup, then force kill
    exitInProgress = true;
    debugLog("main", "First signal - starting cleanup with 300ms timeout");
    console.log("\nExiting... (press Ctrl+C again to force quit)\n");

    // Use unref() so this doesn't keep process alive
    const exitTimeout = setTimeout(() => {
      debugLog("main", "Cleanup timeout - force killing process");
      console.log("Force exit (timeout)...\n");
      process.exit(1);
    }, 300);
    exitTimeout.unref();
  }
};

// Register emergency handlers that can fire multiple times
const sigintHandler = () => emergencyExit("SIGINT");
const sigtermHandler = () => emergencyExit("SIGTERM");

process.on("SIGINT", sigintHandler);
process.on("SIGTERM", sigtermHandler);

// Uncaught exception handler
process.on("uncaughtException", (error) => {
  debugLog("main", "Uncaught exception", {
    error: String(error),
    stack: error.stack,
  });
  console.error("\nUncaught exception:", error);
  process.exit(1);
});

// Unhandled rejection handler
process.on("unhandledRejection", (reason) => {
  debugLog("main", "Unhandled rejection", { reason: String(reason) });
  console.error("\nUnhandled rejection:", reason);
  process.exit(1);
});

// createCliRenderer is async - must await it
// Set fullscreen: true to remove margins
const renderer = await createCliRenderer({ fullscreen: true });
const root = createRoot(renderer);
root.render(<App />);
