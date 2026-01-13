import type { CommandHandler, CommandContext } from '../types.js';
import { runPlan, runBuild, cancelBuild, runPlanInteractive, runPlanInTmux, runBuildInTmux, isInTmux, runBuildPty, runPlanPty, type ProcessHandle, type PtyProcessHandle } from '../utils/process.js';
import { suspendTUI, resumeTUI } from '../index.js';

// Track running processes
let currentProcess: ProcessHandle | null = null;
let currentPtyProcess: PtyProcessHandle | null = null;

export const commands: Record<string, CommandHandler> = {
  plan: async (args, ctx) => {
    const request = args.join(' ');
    if (!request) {
      ctx.appendOutput('Usage: /plan <request>', 'system');
      ctx.appendOutput('Example: /plan add tests for auth module', 'system');
      return;
    }

    ctx.appendOutput(`Creating plan: ${request}`, 'system');
    ctx.appendOutput(`[DEBUG] isInTmux: ${isInTmux()}`, 'system');

    // Try tmux background window (if in tmux)
    if (isInTmux()) {
      ctx.appendOutput('Starting Claude in background...', 'system');

      const result = runPlanInTmux(
        args,
        // Stream Claude's output to our terminal (only new lines)
        (content) => {
          ctx.appendOutput(`[DEBUG] onOutput received ${content.length} chars`, 'system');
          const lines = content.split('\n');
          lines.forEach(line => {
            if (line.trim()) {
              ctx.appendOutput(line, 'stdout');
            }
          });
        },
        (code) => {
          ctx.appendOutput('─── End Claude Output ───', 'marker');
          if (code === 0) {
            ctx.appendOutput('Plan created successfully', 'system');
            ctx.refreshSessions();
          } else {
            ctx.appendOutput(`Plan failed with code ${code}`, 'stderr');
          }
        },
        (error) => {
          ctx.appendOutput(`Tmux error: ${error}`, 'stderr');
        }
      );

      ctx.appendOutput(`[DEBUG] runPlanInTmux returned: ${result ? 'success' : 'null'}`, 'system');
      if (result) {
        ctx.appendOutput(`Claude running (pane: ${result.paneId})`, 'system');
        ctx.appendOutput('Output will stream below. Press Ctrl+B, n to view Claude directly.', 'system');
        return;
      } else {
        ctx.appendOutput('Tmux background failed, falling back...', 'stderr');
      }
    } else {
      ctx.appendOutput('[DEBUG] Not in tmux, using fallback', 'system');
    }

    // Fall back to suspend/resume approach
    ctx.appendOutput('Launching Claude (TUI will suspend)...', 'system');

    suspendTUI();
    const code = runPlanInteractive(args);
    resumeTUI();

    if (code === 0) {
      ctx.appendOutput('Plan created successfully', 'system');
      ctx.refreshSessions();
    } else {
      ctx.appendOutput(`Plan failed with code ${code}`, 'stderr');
    }
  },

  build: async (args, ctx) => {
    if (currentProcess || currentPtyProcess) {
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
      ctx.appendOutput('Cancelling PTY process...', 'system');
      cancelBuild();
      currentPtyProcess.kill();
      currentPtyProcess = null;
      ctx.setPtyHandle(null);
      ctx.appendOutput('Cancelled', 'system');
    } else if (currentProcess) {
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
