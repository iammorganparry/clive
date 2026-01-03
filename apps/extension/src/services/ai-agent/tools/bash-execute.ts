import { tool } from "ai";
import { z } from "zod";
import {
  spawn as nodeSpawn,
  type SpawnOptions,
  type ChildProcess,
} from "node:child_process";
import { Effect, Runtime, Data } from "effect";
import type { BashExecuteInput, BashExecuteOutput } from "../types.js";
import { countTokensInText } from "../../../utils/token-utils.js";
import type { TokenBudgetService } from "../token-budget.js";
import { VSCodeService } from "../../vs-code.js";
import { APPROVAL } from "../hitl-utils.js";
import { ToolCallAbortRegistry } from "../tool-call-abort-registry.js";

/**
 * Type for spawn function - allows dependency injection for testing
 */
export type SpawnFn = (command: string, options: SpawnOptions) => ChildProcess;

/**
 * Blocked patterns that indicate destructive or unsafe operations
 * All commands are allowed except those matching these patterns
 */
const BLOCKED_PATTERNS = [
  // Destructive file operations
  /\brm\b/, // Remove files
  /\bmv\b/, // Move files (could overwrite)
  /\brmdir\b/, // Remove directories

  // Permission/ownership changes
  /\bchmod\b/,
  /\bchown\b/,
  /\bchgrp\b/,

  // Privilege escalation
  /\bsudo\b/,
  /\bsu\b/,
  /\bdoas\b/,

  // Network operations
  /\bcurl\b/,
  /\bwget\b/,
  /\bssh\b/,
  /\bscp\b/,
  /\brsync\b/,
  /\bnc\b/,
  /\bnetcat\b/,
  /\btelnet\b/,

  // System modification
  /\bkill\b/,
  /\bpkill\b/,
  /\bkillall\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bsystemctl\b/,

  // Package installation (use existing packages only)
  /\bapt\b/,
  /\bapt-get\b/,
  /\byum\b/,
  /\bbrew\b/,
  /\bpip install\b/,
  /\bnpm install\b/,
  /\bpnpm install\b/,
  /\byarn add\b/,

  // Disk operations
  /\bmkfs\b/,
  /\bdd\b/,
  /\bfdisk\b/,
  /\bmount\b/,
  /\bumount\b/,
] as const;

/**
 * Maximum execution time in milliseconds
 */
const EXECUTION_TIMEOUT_MS = 10_000; // 10 seconds

/**
 * Patterns that indicate read-only operations
 * Commands matching these patterns don't modify the filesystem or system state
 */
const READ_ONLY_PATTERNS = [
  /^cat\s/, // Read file
  /^head\s/, // Read first lines
  /^tail\s/, // Read last lines
  /^less\s/, // View file
  /^more\s/, // View file
  /^grep\s/, // Search
  /^find\s/, // Find files
  /^ls\b/, // List directory
  /^pwd$/, // Print working directory
  /^echo\s/, // Print (no redirection)
  /^tree\b/, // Directory tree
  /^wc\s/, // Word count
  /^diff\s/, // Compare files
  /^file\s/, // File type
  /^which\s/, // Find command
  /^whereis\s/, // Find binary
  /^type\s/, // Command type
  /^stat\s/, // File stats
  /^du\s/, // Disk usage
  /^df\b/, // Disk free
  /^git\s+(status|log|diff|show|branch|remote|config\s+--get)/, // Git read operations
  /^npm\s+(list|ls|outdated|view|info)/, // npm read operations
  /^yarn\s+(list|info|why)/, // yarn read operations
  /^pnpm\s+(list|ls)/, // pnpm read operations
] as const;

/**
 * Patterns that indicate write/modify operations
 */
const WRITE_PATTERNS = [
  /^touch\s/, // Create file
  /^mkdir\s/, // Create directory
  /^rm\s/, // Remove file (though blocked)
  /^mv\s/, // Move file (though blocked)
  /^cp\s/, // Copy file
  /^git\s+(commit|push|add|merge|rebase|reset|checkout\s+[^-])/, // Git write operations
  /^npm\s+(install|run|exec|publish)/, // npm write operations
  /^yarn\s+(add|install|run|exec|publish)/, // yarn write operations
  /^pnpm\s+(add|install|run|exec|publish)/, // pnpm write operations
  /^npx\s/, // Execute packages (often modifies state)
] as const;

/**
 * Check if a command is read-only (doesn't modify filesystem or system state)
 * @param command - The bash command to check
 * @returns true if the command is read-only, false otherwise
 */
export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();

  // Check for output redirection (>, >>) - these indicate write operations
  // Exception: "cat file > output" is still a write operation, so we check for >
  if (/>/.test(trimmed)) {
    return false;
  }

  // Check for write command patterns
  if (WRITE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return false;
  }

  // Check for read-only patterns
  return READ_ONLY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

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

class CommandDeniedError extends Data.TaggedError("CommandDeniedError")<{
  command: string;
  reason: string;
}> {}

/**
 * Validate that a command is safe to execute
 * Uses blocklist approach - all commands allowed except dangerous ones
 */
function validateCommand(
  command: string,
): Effect.Effect<void, CommandNotAllowedError> {
  return Effect.gen(function* () {
    const trimmed = command.trim();

    // Check for blocked patterns (destructive/unsafe commands)
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(trimmed)) {
        return yield* Effect.fail(
          new CommandNotAllowedError({
            command: trimmed,
            reason: `Command contains blocked pattern: ${pattern}`,
          }),
        );
      }
    }
  });
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
 * Supports approval flow via waitForApproval callback
 */
export const createBashExecuteTool = (
  budget: TokenBudgetService,
  onStreamingOutput?: StreamingOutputCallback,
  spawnFn: SpawnFn = nodeSpawn,
  waitForApproval?: (toolCallId: string) => Promise<unknown>,
  getApprovalSetting?: () => Effect.Effect<"always" | "auto">,
  signal?: AbortSignal,
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

Blocked: rm, mv, sudo, curl, wget, ssh, kill, apt, brew, npm/pnpm/yarn install.
30-second timeout.`,
    inputSchema: z.object({
      command: z
        .string()
        .describe(
          "The bash command to execute. Use relative paths only. Commands execute from workspace root automatically.",
        ),
    }),
    execute: async (
      { command }: BashExecuteInput,
      options?: { toolCallId?: string },
    ): Promise<BashExecuteOutput> => {
      console.log("[BashExecute] execute called with options:", options);
      // Get toolCallId from options (provided by AI SDK) or generate one
      const toolCallId =
        options?.toolCallId ??
        `bash-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      console.log("[BashExecute] Using toolCallId:", toolCallId);

      // Register this tool call with the abort registry
      const toolAbortController = ToolCallAbortRegistry.register(toolCallId);
      const toolSignal = toolAbortController.signal;

      return Runtime.runPromise(Runtime.defaultRuntime)(
        Effect.gen(function* () {
          // Check approval setting if available
          if (getApprovalSetting && waitForApproval) {
            const approval = yield* getApprovalSetting();
            // Only require approval for non-read commands when setting is "always"
            if (approval === "always" && !isReadOnlyCommand(command)) {
              // Emit approval request event via onStreamingOutput callback
              if (onStreamingOutput) {
                onStreamingOutput({
                  command: `APPROVAL_REQUESTED:${toolCallId}:${command}`,
                  output: "",
                });
              }
              // Wait for approval
              const approvalResult = yield* Effect.promise(() =>
                waitForApproval(toolCallId),
              );
              // Check if approved (APPROVAL.YES means approved)
              if (approvalResult !== APPROVAL.YES) {
                ToolCallAbortRegistry.cleanup(toolCallId);
                yield* Effect.fail(
                  new CommandDeniedError({
                    command,
                    reason: "Command execution denied by user",
                  }),
                );
              }
            }
            // If approval is "auto" or command is read-only or approval was granted, continue execution
          }

          // Get workspace root
          const vsCodeService = yield* VSCodeService;
          const workspaceRootUri = yield* vsCodeService.getWorkspaceRoot();
          const workspaceRoot = workspaceRootUri.fsPath;

          // Validate command safety
          yield* validateCommand(command);

          yield* Effect.logDebug(
            `[BashExecute] Executing command: ${command.substring(0, 100)}... (toolCallId: ${toolCallId})`,
          );

          // Execute command with spawn for streaming support
          const result = yield* Effect.tryPromise({
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
                  ToolCallAbortRegistry.cleanup(toolCallId);
                  child.kill();
                  reject(
                    new BashCommandError({
                      message: `Command timed out after ${EXECUTION_TIMEOUT_MS}ms`,
                      command,
                    }),
                  );
                }, EXECUTION_TIMEOUT_MS);

                // Handle abort signals - listen to both tool-level and stream-level signals
                let abortHandler: (() => void) | undefined;
                let streamAbortHandler: (() => void) | undefined;

                const handleAbort = () => {
                  ToolCallAbortRegistry.cleanup(toolCallId);
                  clearTimeout(timeout);
                  if (abortHandler) {
                    toolSignal.removeEventListener("abort", abortHandler);
                  }
                  if (streamAbortHandler && signal) {
                    signal.removeEventListener("abort", streamAbortHandler);
                  }
                  child.kill();
                  reject(
                    new BashCommandError({
                      message: "Command cancelled",
                      command,
                    }),
                  );
                };

                // Check if already aborted
                if (toolSignal.aborted || signal?.aborted) {
                  ToolCallAbortRegistry.cleanup(toolCallId);
                  clearTimeout(timeout);
                  child.kill();
                  reject(
                    new BashCommandError({
                      message: "Command cancelled",
                      command,
                    }),
                  );
                  return;
                }

                // Listen to tool-level abort signal
                abortHandler = handleAbort;
                toolSignal.addEventListener("abort", abortHandler, {
                  once: true,
                });

                // Also listen to stream-level abort signal if provided
                if (signal) {
                  streamAbortHandler = handleAbort;
                  signal.addEventListener("abort", streamAbortHandler, {
                    once: true,
                  });
                }

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
                  ToolCallAbortRegistry.cleanup(toolCallId);
                  clearTimeout(timeout);

                  // Clean up abort listeners if they exist
                  if (abortHandler) {
                    toolSignal.removeEventListener("abort", abortHandler);
                  }
                  if (streamAbortHandler && signal) {
                    signal.removeEventListener("abort", streamAbortHandler);
                  }

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
                  ToolCallAbortRegistry.cleanup(toolCallId);
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
        })
          .pipe(
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
              CommandDeniedError: (error) =>
                Effect.fail(
                  new Error(
                    `Command denied: ${error.command}. ${error.reason}`,
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
          )
          .pipe(Effect.provide(VSCodeService.Default)),
      );
    },
    providerOptions: {
      anthropic: {
        allowedCallers: ["code_execution_20250825"],
      },
    },
  });
