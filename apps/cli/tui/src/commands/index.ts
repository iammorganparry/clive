import type { CommandHandler, CommandContext } from '../types.js';
import { cancelBuild, runBuildPty, runPlanPty, type PtyProcessHandle } from '../utils/process.js';

// Track running PTY process
let currentPtyProcess: PtyProcessHandle | null = null;

export const commands: Record<string, CommandHandler> = {
  plan: async (args, ctx) => {
    const request = args.join(' ');
    if (!request) {
      ctx.appendOutput('Usage: /plan <request>', 'system');
      ctx.appendOutput('Example: /plan add tests for auth module', 'system');
      return;
    }

    if (currentPtyProcess) {
      ctx.appendOutput('A process is already running. Use /cancel to stop it.', 'system');
      return;
    }

    ctx.appendOutput(`Creating plan: ${request}`, 'system');
    ctx.appendOutput('Focus on TERMINAL OUTPUT and type to interact with Claude.', 'system');

    // Use PTY for interactive mode
    const { cols, rows } = ctx.terminalSize;
    currentPtyProcess = runPlanPty(args, cols, rows);

    // Set up PTY handle for keyboard forwarding
    ctx.setPtyHandle(currentPtyProcess);

    // Stream PTY output to terminal
    currentPtyProcess.onData((data: string) => {
      ctx.appendOutput(data, 'stdout');
    });

    currentPtyProcess.onExit((code: number) => {
      ctx.appendOutput('─── End Claude Output ───', 'marker');
      if (code === 0) {
        ctx.appendOutput('Plan created successfully', 'system');
        ctx.refreshSessions();
      } else {
        ctx.appendOutput(`Plan failed with code ${code}`, 'stderr');
      }
      currentPtyProcess = null;
      ctx.setPtyHandle(null);
    });
  },

  build: async (args, ctx) => {
    if (currentPtyProcess) {
      ctx.appendOutput('A process is already running. Use /cancel to stop it.', 'system');
      return;
    }

    ctx.appendOutput('Starting interactive build...', 'system');
    ctx.appendOutput('Focus on TERMINAL OUTPUT and type to interact with Claude.', 'system');

    // Use PTY for interactive mode
    const { cols, rows } = ctx.terminalSize;
    currentPtyProcess = runBuildPty(args, cols, rows);

    // Set up PTY handle for keyboard forwarding
    ctx.setPtyHandle(currentPtyProcess);

    // Stream PTY output to terminal
    currentPtyProcess.onData((data: string) => {
      ctx.appendOutput(data, 'stdout');
    });

    currentPtyProcess.onExit((code: number) => {
      ctx.appendOutput('─── End Claude Build Output ───', 'marker');
      if (code === 0) {
        ctx.appendOutput('Build complete!', 'system');
      } else {
        ctx.appendOutput(`Build exited with code ${code}`, 'system');
      }
      currentPtyProcess = null;
      ctx.setPtyHandle(null);
      ctx.refreshTasks();
    });
  },

  cancel: async (_args, ctx) => {
    if (currentPtyProcess) {
      ctx.appendOutput('Cancelling...', 'system');
      cancelBuild();
      currentPtyProcess.kill();
      currentPtyProcess = null;
      ctx.setPtyHandle(null);
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
    ctx.appendOutput('  Tab              - Focus terminal output for interaction', 'system');
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
