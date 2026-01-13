import type { CommandHandler, CommandContext } from '../types.js';
import { runPlan, runBuild, cancelBuild, runPlanInteractive, type ProcessHandle } from '../utils/process.js';
import { suspendTUI, resumeTUI } from '../index.js';

// Track running processes
let currentProcess: ProcessHandle | null = null;

export const commands: Record<string, CommandHandler> = {
  plan: async (args, ctx) => {
    const request = args.join(' ');
    if (!request) {
      ctx.appendOutput('Usage: /plan <request>', 'system');
      ctx.appendOutput('Example: /plan add tests for auth module', 'system');
      return;
    }

    ctx.appendOutput(`Creating plan: ${request}`, 'system');
    ctx.appendOutput('Launching Claude interactive session...', 'system');

    // Suspend TUI and run Claude interactively
    suspendTUI();

    const code = runPlanInteractive(args);

    // Resume TUI after Claude exits
    resumeTUI();

    if (code === 0) {
      ctx.appendOutput('Plan created successfully', 'system');
      ctx.refreshSessions();
    } else {
      ctx.appendOutput(`Plan failed with code ${code}`, 'stderr');
    }
  },

  build: async (args, ctx) => {
    if (currentProcess) {
      ctx.appendOutput('A process is already running. Use /cancel to stop it.', 'system');
      return;
    }

    ctx.appendOutput('Starting build...', 'system');

    currentProcess = runBuild(args, (data, type) => {
      ctx.appendOutput(data, type);
    });

    currentProcess.onExit((code: number) => {
      currentProcess = null;
      if (code === 0) {
        ctx.appendOutput('Build complete!', 'system');
      } else {
        ctx.appendOutput(`Build exited with code ${code}`, 'system');
      }
      ctx.refreshTasks();
    });
  },

  cancel: async (_args, ctx) => {
    if (currentProcess) {
      ctx.appendOutput('Cancelling...', 'system');
      cancelBuild();
      currentProcess.kill();
      currentProcess = null;
      ctx.appendOutput('Cancelled', 'system');
    } else {
      ctx.appendOutput('Nothing running to cancel', 'system');
    }
  },

  status: async (_args, ctx) => {
    ctx.appendOutput('Refreshing status...', 'system');
    ctx.refreshSessions();
    ctx.refreshTasks();
    ctx.appendOutput('Status updated', 'system');
  },

  clear: async (_args, ctx) => {
    // Note: This would need to be connected to the clear function
    ctx.appendOutput('Output cleared', 'system');
  },

  help: async (_args, ctx) => {
    ctx.appendOutput('', 'system');
    ctx.appendOutput('Available commands:', 'system');
    ctx.appendOutput('  /plan <request>  - Create a new work plan', 'system');
    ctx.appendOutput('  /build [--once]  - Start executing the plan', 'system');
    ctx.appendOutput('  /cancel          - Cancel running build', 'system');
    ctx.appendOutput('  /status          - Refresh status', 'system');
    ctx.appendOutput('  /clear           - Clear output', 'system');
    ctx.appendOutput('  /help            - Show this help', 'system');
    ctx.appendOutput('', 'system');
    ctx.appendOutput('Keyboard shortcuts:', 'system');
    ctx.appendOutput('  ←/→              - Switch session tabs', 'system');
    ctx.appendOutput('  ↑/↓              - Command history', 'system');
    ctx.appendOutput('  Ctrl+C           - Quit', 'system');
    ctx.appendOutput('', 'system');
  },
};

export async function executeCommand(input: string, ctx: CommandContext): Promise<void> {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    ctx.appendOutput(`Unknown input. Type /help for commands.`, 'system');
    return;
  }

  const [cmd, ...args] = trimmed.slice(1).split(' ');
  const handler = commands[cmd.toLowerCase()];

  if (handler) {
    try {
      await handler(args, ctx);
    } catch (error) {
      ctx.appendOutput(`Error: ${error}`, 'stderr');
    }
  } else {
    ctx.appendOutput(`Unknown command: /${cmd}`, 'system');
    ctx.appendOutput(`Type /help for available commands.`, 'system');
  }
}
