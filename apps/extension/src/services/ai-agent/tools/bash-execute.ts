import { tool } from "ai";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Effect, Runtime, Data } from "effect";
import type { BashExecuteInput, BashExecuteOutput } from "../types.js";
import { countTokensInText } from "../../../utils/token-utils.js";
import type { TokenBudgetService } from "../token-budget.js";
import { getWorkspaceRoot } from "../../../lib/vscode-effects.js";
import * as path from "node:path";

const execAsync = promisify(exec);

/**
 * Allowed commands for sandboxed execution
 * Only read-only commands that don't modify the filesystem
 */
const ALLOWED_COMMANDS = [
  "cat",
  "head",
  "tail",
  "grep",
  "find",
  "ls",
  "wc",
  "git",
] as const;

/**
 * Blocked patterns that indicate destructive or unsafe operations
 */
const BLOCKED_PATTERNS = [
  /rm\s/, // Remove files
  /mv\s/, // Move files
  /cp\s/, // Copy files (could be used maliciously)
  /chmod/, // Change permissions
  /chown/, // Change ownership
  /sudo/, // Elevate privileges
  />\s/, // Output redirection (could overwrite files)
  />>/, // Append redirection
  /\|.*rm/, // Piped remove
  /;.*rm/, // Chained remove
  /curl/, // Network requests
  /wget/, // Network requests
  /ssh/, // Remote access
  /nc\b/, // Netcat
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

class PathOutsideWorkspaceError extends Data.TaggedError(
  "PathOutsideWorkspaceError",
)<{
  path: string;
  workspaceRoot: string;
}> {}

/**
 * Validate that a command is safe to execute
 */
function validateCommand(
  command: string,
): Effect.Effect<void, CommandNotAllowedError> {
  return Effect.gen(function* () {
    const trimmed = command.trim();

    // Check for blocked patterns
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

    // Extract the first command (before any pipes or semicolons)
    const firstPart = trimmed.split(/[|;]/)[0]?.trim() || "";
    const firstWord = firstPart.split(/\s+/)[0] || "";

    // Check if first command is in allowlist
    if (
      !ALLOWED_COMMANDS.includes(firstWord as (typeof ALLOWED_COMMANDS)[number])
    ) {
      return yield* Effect.fail(
        new CommandNotAllowedError({
          command: trimmed,
          reason: `Command '${firstWord}' is not in the allowlist. Allowed commands: ${ALLOWED_COMMANDS.join(", ")}`,
        }),
      );
    }
  });
}

/**
 * Validate that all file paths in the command are within the workspace
 */
function validatePathsInWorkspace(
  command: string,
  workspaceRoot: string,
): Effect.Effect<void, PathOutsideWorkspaceError> {
  return Effect.gen(function* () {
    // Extract potential file paths from the command
    // This is a simple heuristic - look for paths that start with / or contain ..
    const pathPattern = /([\/][^\s|;]+|\.\.[\/])/g;
    const matches = command.match(pathPattern);

    if (matches) {
      for (const match of matches) {
        const resolvedPath = path.resolve(workspaceRoot, match);
        const workspacePath = path.resolve(workspaceRoot);

        // Check if resolved path is within workspace
        if (!resolvedPath.startsWith(workspacePath)) {
          return yield* Effect.fail(
            new PathOutsideWorkspaceError({
              path: match,
              workspaceRoot: workspacePath,
            }),
          );
        }
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
    description: `Execute read-only bash commands in the workspace. 
Allowed commands: ${ALLOWED_COMMANDS.join(", ")}. 
Use for: reading files (cat, head, tail), searching (grep, find), listing directories (ls), git operations (git diff, git log, git show), counting (wc).
All commands are sandboxed to the workspace directory and have a 30-second timeout.`,
    inputSchema: z.object({
      command: z
        .string()
        .describe(
          "The bash command to execute. Must use only allowed commands and operate within the workspace.",
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

          // Validate paths are within workspace
          yield* validatePathsInWorkspace(command, workspaceRoot);

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
          Effect.catchTag("PathOutsideWorkspaceError", (error) =>
            Effect.fail(
              new Error(
                `Path outside workspace: ${error.path}. Workspace root: ${error.workspaceRoot}`,
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
