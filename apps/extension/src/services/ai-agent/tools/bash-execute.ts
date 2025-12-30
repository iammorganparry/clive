import { tool } from "ai";
import { z } from "zod";
import { spawn as nodeSpawn, type SpawnOptions, type ChildProcess } from "node:child_process";
import { Effect, Runtime, Data } from "effect";
import type { BashExecuteInput, BashExecuteOutput } from "../types.js";
import { countTokensInText } from "../../../utils/token-utils.js";
import type { TokenBudgetService } from "../token-budget.js";
import { getWorkspaceRoot } from "../../../lib/vscode-effects.js";
import { Bash, OverlayFs } from "just-bash";

/**
 * Type for spawn function - allows dependency injection for testing
 */
export type SpawnFn = (
  command: string,
  options: SpawnOptions,
) => ChildProcess;

/**
 * Commands that require the real shell (Node.js runtimes, package managers, etc.)
 * These commands need access to real node_modules and the actual runtime environment
 */
const REAL_SHELL_COMMANDS = [
  // Package managers and script runners (framework-agnostic)
  /^(npx|npm|pnpm|yarn|bun)\s/,
  
  // Direct runtime execution
  /^(node|deno|bun)\s/,
  
  // Any command run via package.json scripts (npm run, yarn test, etc.)
  /^(npm|pnpm|yarn|bun)\s+(run|exec|test|build|start|dev)\b/,
] as const;

/**
 * Blocked patterns for real shell commands only
 * Simplified since just-bash handles most commands safely
 */
const BLOCKED_PATTERNS = [
  // Privilege escalation
  /\bsudo\b/,
  /\bsu\b/,
  /\bdoas\b/,

  // Network operations (not needed for dev tooling)
  /\bcurl\b/,
  /\bwget\b/,
  /\bssh\b/,
  /\bscp\b/,
  /\brsync\b/,

  // System modification
  /\bkill\b/,
  /\bpkill\b/,
  /\bkillall\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bsystemctl\b/,

  // System package managers
  /\bapt\b/,
  /\bapt-get\b/,
  /\byum\b/,
  /\bbrew\b/,
  /\bpip install\b/,
] as const;

/**
 * Maximum execution time in milliseconds
 */
const EXECUTION_TIMEOUT_MS = 30_000; // 30 seconds

class BashCommandError extends Data.TaggedError("BashCommandError")<{
  message: string;
  command: string;
  cause?: unknown;
}> {}

class CommandNotAllowedError extends Data.TaggedError(
  "CommandNotAllowedError",
)<{
  command: string;
  reason: string;
}> {}

/**
 * Execute command using just-bash with OverlayFs (sandboxed)
 */
function executeJustBash(
  command: string,
  workspaceRoot: string,
  onStreamingOutput?: StreamingOutputCallback,
): Effect.Effect<
  { stdout: string; stderr: string; exitCode: number },
  BashCommandError
> {
  return Effect.tryPromise({
    try: async () => {
      // Create overlay filesystem over workspace root
      const overlay = new OverlayFs({ root: workspaceRoot });
      const bash = new Bash({ 
        fs: overlay, 
        cwd: overlay.getMountPoint(),
      });

      // Execute command
      const result = await bash.exec(command);

      // Emit full output at once for just-bash (no streaming chunks)
      if (onStreamingOutput && (result.stdout || result.stderr)) {
        const output = result.stderr
          ? `${result.stdout}\n--- stderr ---\n${result.stderr}`
          : result.stdout;
        onStreamingOutput({
          command,
          output,
        });
      }

      return {
        stdout: result.stdout,
        stderr: result.stderr || "",
        exitCode: result.exitCode,
      };
    },
    catch: (error) =>
      new BashCommandError({
        message: error instanceof Error ? error.message : "Unknown error",
        command,
        cause: error,
      }),
  });
}

/**
 * Execute command using real shell (node:child_process)
 */
function executeRealShell(
  command: string,
  workspaceRoot: string,
  spawnFn: SpawnFn,
  onStreamingOutput?: StreamingOutputCallback,
): Effect.Effect<
  { stdout: string; stderr: string; exitCode: number },
  BashCommandError
> {
  return Effect.tryPromise({
    try: () =>
      new Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
      }>((resolve, reject) => {
        const child = spawnFn(command, {
          shell: true,
          cwd: workspaceRoot,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        let stdoutBuffer = "";
        let stderrBuffer = "";

        // Set timeout
        const timeout = setTimeout(() => {
          child.kill();
          reject(
            new BashCommandError({
              message: `Command timed out after ${EXECUTION_TIMEOUT_MS}ms`,
              command,
            }),
          );
        }, EXECUTION_TIMEOUT_MS);

        // Stream stdout
        child.stdout?.on("data", (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          stdoutBuffer += chunk;

          // Emit streaming output when we have a complete line or buffer gets large
          if (
            onStreamingOutput &&
            (chunk.includes("\n") || stdoutBuffer.length > 1000)
          ) {
            onStreamingOutput({
              command,
              output: stdoutBuffer,
            });
            stdoutBuffer = ""; // Reset buffer after emitting
          }
        });

        // Stream stderr
        child.stderr?.on("data", (data: Buffer) => {
          const chunk = data.toString();
          stderr += chunk;
          stderrBuffer += chunk;

          // Emit streaming output for stderr as well
          if (
            onStreamingOutput &&
            (chunk.includes("\n") || stderrBuffer.length > 1000)
          ) {
            const combinedOutput = `${stdout}\n--- stderr ---\n${stderrBuffer}`;
            onStreamingOutput({
              command,
              output: combinedOutput,
            });
            stderrBuffer = ""; // Reset buffer after emitting
          }
        });

        // Handle process completion
        child.on("close", (code) => {
          clearTimeout(timeout);

          // Emit any remaining buffered output
          if (onStreamingOutput) {
            const remainingOutput =
              stdoutBuffer || stderrBuffer
                ? stdout + (stderr ? `\n--- stderr ---\n${stderr}` : "")
                : stdout +
                  (stderr ? `\n--- stderr ---\n${stderr}` : "");
            if (remainingOutput) {
              onStreamingOutput({
                command,
                output: remainingOutput,
              });
            }
          }

          resolve({
            stdout,
            stderr,
            exitCode: code ?? 0,
          });
        });

        // Handle process errors
        child.on("error", (error) => {
          clearTimeout(timeout);
          reject(
            new BashCommandError({
              message:
                error instanceof Error
                  ? error.message
                  : "Unknown error",
              command,
              cause: error,
            }),
          );
        });
      }),
    catch: (error) =>
      error instanceof BashCommandError
        ? error
        : new BashCommandError({
            message:
              error instanceof Error ? error.message : "Unknown error",
            command,
            cause: error,
          }),
  });
}

/**
 * Check if a command requires the real shell (Node.js tooling)
 */
function requiresRealShell(command: string): boolean {
  const trimmed = command.trim();
  return REAL_SHELL_COMMANDS.some((pattern) => pattern.test(trimmed));
}

/**
 * Validate that a command is safe to execute
 * Uses blocklist approach - all commands allowed except dangerous ones
 * Only applies to real shell commands
 */
function validateCommand(
  command: string,
): Effect.Effect<void, CommandNotAllowedError> {
  const trimmed = command.trim();

  // Check for blocked patterns (destructive/unsafe commands)
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return Effect.fail(
        new CommandNotAllowedError({
          command: trimmed,
          reason: `Command contains blocked pattern: ${pattern}`,
        }),
      );
    }
  }
  
  return Effect.void;
}

/**
 * Streaming output callback type
 * Receives command and output, should look up toolCallId internally
 */
export type StreamingOutputCallback = (chunk: {
  command: string;
  output: string;
}) => void;

/**
 * Options for creating the bash execute tool
 */
export interface BashExecuteToolOptions {
  /** Token budget service for output truncation */
  budget: TokenBudgetService;
  /** Optional callback for streaming output */
  onStreamingOutput?: StreamingOutputCallback;
  /** Optional spawn function for dependency injection (defaults to node:child_process spawn) */
  spawnFn?: SpawnFn;
}

/**
 * Factory function to create bashExecuteTool with token budget awareness
 * Uses MEDIUM priority - up to 25% of remaining budget
 * Supports streaming output via onStreamingOutput callback
 * 
 * Uses hybrid approach:
 * - Safe commands (ls, cat, grep, etc.) use just-bash with OverlayFs (sandboxed)
 * - Real shell commands (npm, vitest, etc.) use node:child_process
 */
export const createBashExecuteTool = (
  budget: TokenBudgetService,
  onStreamingOutput?: StreamingOutputCallback,
  spawnFn: SpawnFn = nodeSpawn,
) =>
  tool({
    description: `Execute bash commands in the workspace.

**PATH RESOLUTION:**
- Commands execute from workspace root automatically
- ALWAYS use relative paths: \`apps/nextjs/src/...\`
- NEVER use \`cd\` - cwd is already set
- NEVER use absolute paths starting with \`/\` or \`~\`

**For tests:** \`npx vitest run path/to/test.tsx\`
**For files:** \`printf 'content' > file.md\` (no heredoc)

**For multi-line files:**
- printf 'line1\\nline2\\nline3' > file.md
- (echo "line1"; echo "line2") > file.md
- echo -e "line1\\nline2" > file.md

**Security:**
- File exploration commands (ls, cat, grep, etc.) are sandboxed - writes stay in memory
- Node.js tooling (npm, vitest, npx) runs in real shell with access to node_modules
- Blocked: sudo, curl, wget, ssh, kill, apt, brew, pip install
- 30-second timeout`,
    inputSchema: z.object({
      command: z
        .string()
        .describe(
          "The bash command to execute. Use relative paths only. Commands execute from workspace root automatically.",
        ),
    }),
    execute: async ({
      command,
    }: BashExecuteInput): Promise<BashExecuteOutput> => {
      return Runtime.runPromise(Runtime.defaultRuntime)(
        Effect.gen(function* () {
          // Get workspace root
          const workspaceRootUri = yield* getWorkspaceRoot();
          const workspaceRoot = workspaceRootUri.fsPath;

          // Validate command safety (applies to real shell commands only)
          const needsRealShell = requiresRealShell(command);
          if (needsRealShell) {
            yield* validateCommand(command);
          }

          yield* Effect.logDebug(
            `[BashExecute] Executing command via ${needsRealShell ? "real shell" : "just-bash"}: ${command.substring(0, 100)}...`,
          );

          // Route to appropriate execution method
          const result = needsRealShell
            ? yield* executeRealShell(command, workspaceRoot, spawnFn, onStreamingOutput)
            : yield* executeJustBash(command, workspaceRoot, onStreamingOutput);

          const stdout = result.stdout || "";
          const stderr = result.stderr || "";

          // Combine stdout and stderr for token counting
          const output = stderr
            ? `${stdout}\n--- stderr ---\n${stderr}`
            : stdout;

          // Apply budget-aware truncation (MEDIUM priority)
          const { content: truncated, wasTruncated } =
            yield* budget.truncateToFit(output, "medium");

          // Consume tokens for the truncated content
          const tokens = countTokensInText(truncated);
          yield* budget.consume(tokens);

          yield* Effect.logDebug(
            `[BashExecute] Command completed. Output length: ${truncated.length} chars (${tokens} tokens, truncated: ${wasTruncated})`,
          );

          return {
            stdout: truncated,
            stderr: stderr || undefined,
            exitCode: result.exitCode,
            wasTruncated,
            command,
          };
        }).pipe(
          Effect.catchTags({
            CommandNotAllowedError: (error) =>
              Effect.fail(
                new Error(
                  `Command not allowed: ${error.command}. ${error.reason}`,
                ),
              ),
            BashCommandError: (error) =>
              Effect.fail(
                new Error(
                  `Command execution failed: ${error.message}. Command: ${error.command}`,
                ),
              ),
          }),
          Effect.catchAll((error) =>
            Effect.fail(
              new Error(
                `Unexpected error: ${error instanceof Error ? error.message : "Unknown error"}`,
              ),
            ),
          ),
        ),
      );
    },
    providerOptions: {
      anthropic: {
        allowedCallers: ["code_execution_20250825"],
      },
    },
  });
