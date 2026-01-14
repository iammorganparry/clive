import type { CommandContext, CommandHandler } from "../types.js";
import type { ClaudeEvent } from "../utils/claude-events.js";
import {
  formatApprovalResponse,
  formatQuestionResponse,
} from "../utils/claude-events.js";
import {
  cancelBuild,
  type InteractiveProcessHandle,
  runBuildInteractive,
  runPlanInteractive,
} from "../utils/process.js";

// Track running process (interactive for both build and plan)
let currentBuildProcess: InteractiveProcessHandle | null = null;
let currentPlanProcess: InteractiveProcessHandle | null = null;

// Event handler for dispatching to output machine (only for events that need UI)
let eventHandler: ((event: ClaudeEvent) => void) | null = null;

// Refresh callback for beads command detection
let refreshCallback: (() => void) | null = null;

// Output callback for showing auto-approval messages
let outputCallback: ((message: string) => void) | null = null;

/**
 * Set the event handler for Claude events (questions only)
 */
export function setEventHandler(handler: (event: ClaudeEvent) => void): void {
  eventHandler = handler;
}

/**
 * Set the output callback for showing messages
 */
export function setOutputCallback(callback: (message: string) => void): void {
  outputCallback = callback;
}

/**
 * Handle Claude events
 * Note: Tool approvals are handled by Claude CLI via --permission-mode acceptEdits
 * We only need to handle AskUserQuestion which requires actual user input
 */
export function handleClaudeEvent(event: ClaudeEvent): void {
  // Only dispatch question events to UI - these require actual user input
  // Approval events are handled internally by Claude CLI with acceptEdits mode
  if (event.type === "question") {
    if (eventHandler) {
      eventHandler(event);
    }
  }
  // Ignore approval_requested events - CLI handles these automatically
}

/**
 * Set the refresh callback for beads command detection
 */
export function setRefreshCallback(callback: () => void): void {
  refreshCallback = callback;
}

/**
 * Send a user guidance message to the active agent
 */
export function sendUserMessage(message: string): void {
  if (currentBuildProcess) {
    currentBuildProcess.sendUserMessage(message);
  } else if (currentPlanProcess) {
    currentPlanProcess.sendUserMessage(message);
  }
}

/**
 * Send a question answer to the active agent
 */
export function sendQuestionAnswer(
  toolCallId: string,
  answers: Record<string, string>,
): void {
  const process = currentBuildProcess || currentPlanProcess;
  if (process) {
    const response = formatQuestionResponse(toolCallId, answers);
    // Parse the JSON and send via the proper method
    const parsed = JSON.parse(response);
    if (parsed.message?.content?.[0]?.content) {
      process.sendToolResult(toolCallId, parsed.message.content[0].content);
    }

    // For plan process, close stdin after answering to signal completion
    // This allows the build loop to proceed after plan approval
    if (currentPlanProcess) {
      // Give Claude a moment to process the answer before closing
      setTimeout(() => {
        currentPlanProcess?.close();
      }, 100);
    }
  }
}

/**
 * Send an approval response to the active agent
 */
export function sendApprovalResponse(
  toolCallId: string,
  approved: boolean,
): void {
  if (currentBuildProcess) {
    const response = formatApprovalResponse(toolCallId, approved);
    // Parse the JSON and send via the proper method
    const parsed = JSON.parse(response);
    if (parsed.message?.content?.[0]?.content) {
      currentBuildProcess.sendToolResult(
        toolCallId,
        parsed.message.content[0].content,
      );
    }
  }
}

/**
 * Check if a process is currently running
 */
export function isProcessRunning(): boolean {
  return currentBuildProcess !== null || currentPlanProcess !== null;
}

// Patterns to detect beads commands that modify state
const BEADS_MODIFY_PATTERNS = [
  /bd\s+(create|close|update|dep)/,
  /beads\s+(create|close|update|dep)/,
];

/**
 * Check if output contains beads modify commands and trigger refresh
 */
function checkForBeadsCommands(data: string): void {
  for (const pattern of BEADS_MODIFY_PATTERNS) {
    if (pattern.test(data)) {
      // Debounce refresh - wait a bit for command to complete
      setTimeout(() => {
        refreshCallback?.();
      }, 500);
      return;
    }
  }
}

export const commands: Record<string, CommandHandler> = {
  plan: async (args, ctx) => {
    const request = args.join(" ");
    if (!request) {
      ctx.appendOutput("Usage: /plan <request>", "system");
      ctx.appendOutput("Example: /plan add tests for auth module", "system");
      return;
    }

    if (currentBuildProcess || currentPlanProcess) {
      ctx.appendOutput(
        "A process is already running. Use /cancel to stop it.",
        "system",
      );
      return;
    }

    // Clear welcome messages and start fresh
    ctx.clearOutput();
    ctx.appendOutput(`Creating plan: ${request}`, "system");
    ctx.setIsRunning(true);

    currentPlanProcess = runPlanInteractive(args);

    // Handle parsed Claude events (questions, approvals)
    currentPlanProcess.onEvent((event: ClaudeEvent) => {
      handleClaudeEvent(event);
    });

    currentPlanProcess.onData((data: string) => {
      ctx.appendOutput(data, "stdout");
      // Check for beads commands to trigger refresh
      checkForBeadsCommands(data);
    });

    currentPlanProcess.onExit((code: number) => {
      ctx.setIsRunning(false);
      if (code === 0) {
        ctx.appendOutput("Plan created successfully", "system");
        ctx.refreshSessions();
        ctx.refreshTasks();
      } else {
        ctx.appendOutput(`Plan failed with code ${code}`, "stderr");
      }
      currentPlanProcess = null;
    });
  },

  build: async (args, ctx) => {
    if (currentBuildProcess || currentPlanProcess) {
      ctx.appendOutput(
        "A process is already running. Use /cancel to stop it.",
        "system",
      );
      return;
    }

    // Clear welcome messages and start fresh
    ctx.clearOutput();

    // Pass the active epic ID to filter tasks
    const epicId = ctx.activeSession?.epicId;
    if (epicId) {
      ctx.appendOutput(`Building: ${ctx.activeSession?.name}`, "system");
    } else {
      ctx.appendOutput("Starting build...", "system");
    }

    ctx.setIsRunning(true);
    currentBuildProcess = runBuildInteractive(args, epicId);

    // Handle parsed Claude events (questions, approvals)
    // Auto-approves Write/Edit/Bash in build mode via handleClaudeEvent
    currentBuildProcess.onEvent((event: ClaudeEvent) => {
      handleClaudeEvent(event);
    });

    currentBuildProcess.onData((data: string) => {
      ctx.appendOutput(data, "stdout");
      // Check for beads commands to trigger refresh
      checkForBeadsCommands(data);
    });

    currentBuildProcess.onExit((code: number) => {
      ctx.setIsRunning(false);
      if (code === 0) {
        ctx.appendOutput("Build complete!", "system");
      } else {
        ctx.appendOutput(`Build exited with code ${code}`, "system");
      }
      currentBuildProcess = null;
      ctx.refreshTasks();
    });
  },

  cancel: async (_args, ctx) => {
    if (currentBuildProcess) {
      ctx.appendOutput("Cancelling build...", "system");
      cancelBuild();
      currentBuildProcess.kill();
      currentBuildProcess = null;
      ctx.setIsRunning(false);
      ctx.appendOutput("Cancelled", "system");
    } else if (currentPlanProcess) {
      ctx.appendOutput("Cancelling plan...", "system");
      currentPlanProcess.kill();
      currentPlanProcess = null;
      ctx.setIsRunning(false);
      ctx.appendOutput("Cancelled", "system");
    } else {
      ctx.appendOutput("Nothing running to cancel", "system");
    }
  },

  status: async (_args, ctx) => {
    ctx.appendOutput("Refreshing status...", "system");
    ctx.refreshSessions();
    ctx.refreshTasks();
    ctx.appendOutput("Status updated", "system");
  },

  clear: async (_args, ctx) => {
    ctx.appendOutput("Output cleared", "system");
  },

  help: async (_args, ctx) => {
    ctx.appendOutput("", "system");
    ctx.appendOutput("Available commands:", "system");
    ctx.appendOutput("  /plan <request>  - Create a new work plan", "system");
    ctx.appendOutput("  /build [--once]  - Start executing the plan", "system");
    ctx.appendOutput("  /cancel          - Cancel running build", "system");
    ctx.appendOutput("  /status          - Refresh status", "system");
    ctx.appendOutput("  /clear           - Clear output", "system");
    ctx.appendOutput("  /help            - Show this help", "system");
    ctx.appendOutput("", "system");
    ctx.appendOutput("Keyboard shortcuts:", "system");
    ctx.appendOutput("  [/]              - Switch session tabs", "system");
    ctx.appendOutput("  ↑/↓              - Command history", "system");
    ctx.appendOutput("  b                - Start build", "system");
    ctx.appendOutput("  c                - Cancel build", "system");
    ctx.appendOutput("  r                - Refresh status", "system");
    ctx.appendOutput("  ?                - Toggle help", "system");
    ctx.appendOutput("  Ctrl+C           - Quit", "system");
    ctx.appendOutput("", "system");
  },
};

export async function executeCommand(
  input: string,
  ctx: CommandContext,
): Promise<void> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    ctx.appendOutput(`Unknown input. Type /help for commands.`, "system");
    return;
  }

  const [cmd, ...args] = trimmed.slice(1).split(" ");
  const handler = commands[cmd.toLowerCase()];

  if (handler) {
    try {
      await handler(args, ctx);
    } catch (error) {
      ctx.appendOutput(`Error: ${error}`, "stderr");
    }
  } else {
    ctx.appendOutput(`Unknown command: /${cmd}`, "system");
    ctx.appendOutput(`Type /help for available commands.`, "system");
  }
}
