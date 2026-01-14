import type { CommandContext, CommandHandler } from "../types.js";
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

// Track running process with interactive handle for bidirectional communication
let currentProcessHandle: InteractiveProcessHandle | null = null;

/**
 * Send a user guidance message to the active agent
 */
export function sendUserMessage(message: string): void {
  if (currentProcessHandle) {
    currentProcessHandle.sendUserMessage(message);
  }
}

/**
 * Send a question answer to the active agent
 */
export function sendQuestionAnswer(
  toolCallId: string,
  answers: Record<string, string>,
): void {
  if (currentProcessHandle) {
    const response = formatQuestionResponse(toolCallId, answers);
    currentProcessHandle.sendToolResult(toolCallId, response);
  }
}

/**
 * Send an approval response to the active agent
 */
export function sendApprovalResponse(
  toolCallId: string,
  approved: boolean,
): void {
  if (currentProcessHandle) {
    const response = formatApprovalResponse(toolCallId, approved);
    currentProcessHandle.sendToolResult(toolCallId, response);
  }
}

/**
 * Check if a process is currently running
 */
export function isProcessRunning(): boolean {
  return currentProcessHandle !== null;
}

export const commands: Record<string, CommandHandler> = {
  plan: async (args, ctx) => {
    const request = args.join(" ");
    if (!request) {
      ctx.appendOutput("Usage: /plan <request>", "system");
      ctx.appendOutput("Example: /plan add tests for auth module", "system");
      return;
    }

    if (currentProcessHandle) {
      ctx.appendOutput(
        "A process is already running. Use /cancel to stop it.",
        "system",
      );
      return;
    }

    ctx.appendOutput(`Creating plan: ${request}`, "system");
    ctx.setIsRunning(true);

    currentProcessHandle = runPlanInteractive(args);

    currentProcessHandle.onData((data: string) => {
      ctx.appendOutput(data, "stdout");
    });

    currentProcessHandle.onExit((code: number) => {
      ctx.setIsRunning(false);
      if (code === 0) {
        ctx.appendOutput("Plan created successfully", "system");
        ctx.refreshSessions();
      } else {
        ctx.appendOutput(`Plan failed with code ${code}`, "stderr");
      }
      currentProcessHandle = null;
    });
  },

  build: async (args, ctx) => {
    if (currentProcessHandle) {
      ctx.appendOutput(
        "A process is already running. Use /cancel to stop it.",
        "system",
      );
      return;
    }

    // Pass the active epic ID to filter tasks
    const epicId = ctx.activeSession?.epicId;
    if (epicId) {
      ctx.appendOutput(`Building for: ${ctx.activeSession?.name}`, "system");
    } else {
      ctx.appendOutput("Starting build...", "system");
    }

    ctx.setIsRunning(true);
    currentProcessHandle = runBuildInteractive(args, epicId);

    currentProcessHandle.onData((data: string) => {
      ctx.appendOutput(data, "stdout");
    });

    currentProcessHandle.onExit((code: number) => {
      ctx.setIsRunning(false);
      if (code === 0) {
        ctx.appendOutput("Build complete!", "system");
      } else {
        ctx.appendOutput(`Build exited with code ${code}`, "system");
      }
      currentProcessHandle = null;
      ctx.refreshTasks();
    });
  },

  cancel: async (_args, ctx) => {
    if (currentProcessHandle) {
      ctx.appendOutput("Cancelling...", "system");
      cancelBuild();
      currentProcessHandle.kill();
      currentProcessHandle = null;
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
