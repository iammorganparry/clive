import { tool } from "ai";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Effect, Runtime, Data } from "effect";
import type { BashExecuteInput, BashExecuteOutput } from "../types.js";
import { countTokensInText } from "../../../utils/token-utils.js";
import type { TokenBudgetService } from "../token-budget.js";
import { getWorkspaceRoot } from "../../../lib/vscode-effects.js";

const execAsync = promisify(exec);

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
  /\bservice\b/,

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
 * Factory function to create bashExecuteTool with token budget awareness
 * Uses MEDIUM priority - up to 25% of remaining budget
 */
export const createBashExecuteTool = (budget: TokenBudgetService) =>
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
    execute: async ({
      command,
    }: BashExecuteInput): Promise<BashExecuteOutput> => {
      return Runtime.runPromise(Runtime.defaultRuntime)(
        Effect.gen(function* () {
          // Get workspace root
          const workspaceRootUri = yield* getWorkspaceRoot();
          const workspaceRoot = workspaceRootUri.fsPath;

          // Validate command safety
          yield* validateCommand(command);

          yield* Effect.logDebug(
            `[BashExecute] Executing command: ${command.substring(0, 100)}...`,
          );

          // Execute command with timeout
          const result = yield* Effect.tryPromise({
            try: () =>
              execAsync(command, {
                cwd: workspaceRoot,
                timeout: EXECUTION_TIMEOUT_MS,
                maxBuffer: 10 * 1024 * 1024, // 10MB max output
              }),
            catch: (error) =>
              new BashCommandError({
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
            exitCode: 0, // execAsync only resolves on success (exit code 0)
            wasTruncated,
            command,
          };
        }).pipe(
          Effect.catchTag("CommandNotAllowedError", (error) =>
            Effect.fail(
              new Error(
                `Command not allowed: ${error.command}. ${error.reason}`,
              ),
            ),
          ),
          Effect.catchTag("BashCommandError", (error) =>
            Effect.fail(
              new Error(
                `Command execution failed: ${error.message}. Command: ${error.command}`,
              ),
            ),
          ),
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
