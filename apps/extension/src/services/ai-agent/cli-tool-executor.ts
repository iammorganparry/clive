/**
 * CLI Tool Executor
 * Bridges Claude CLI tool requests to existing tool implementations
 * Executes tools and returns serialized results for sending back to CLI
 *
 * Handles Claude CLI's built-in tools (Read, Write, Edit, Bash, Glob, Grep)
 * as well as custom tools from the tool factory.
 *
 * Includes mode-aware permission checks:
 * - "plan" mode: Read-only operations allowed
 * - "act" mode: Write operations allowed
 */

import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import type { Tool, ToolSet } from "ai";
import { Effect } from "effect";
import { glob } from "glob";
import { logToOutput } from "../../utils/logger.js";
import { ToolCallAbortRegistry } from "./tool-call-abort-registry.js";

const execAsync = promisify(exec);

/**
 * Execution mode for the tool executor
 * - "plan": Read-only mode for investigation and planning
 * - "act": Full execution mode for writing files and running commands
 */
export type ToolExecutorMode = "plan" | "act";

/**
 * Built-in CLI tool handlers
 * These handle the standard Claude CLI tools (Read, Write, Edit, Bash, Glob, Grep)
 */
type BuiltinToolHandler = (args: unknown) => Promise<CliToolResult>;

/**
 * Blocked command patterns that are never allowed regardless of mode
 * These are destructive or potentially dangerous operations
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
 * Read-only command patterns that are always allowed
 */
const READ_ONLY_PATTERNS = [
  /^cd(\s|$)/, // Change directory (read-only - doesn't modify files)
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
 * Check if a command is read-only (doesn't modify filesystem or system state)
 */
function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();

  // Check for stdout redirection (>, >>) but allow stderr (2>, 2>>) and fd dup (>&)
  // Negative lookbehind: don't match if preceded by 2 or &
  // Negative lookahead: don't match if followed by &
  if (/(?<![2&])>(?!&)/.test(trimmed)) {
    return false;
  }

  // Split compound commands (&&, ;, ||) and check each part
  const subCommands = trimmed.split(/\s*(?:&&|;|\|\|)\s*/);

  // All sub-commands must be read-only
  return subCommands.every((subCmd) => {
    const trimmedSub = subCmd.trim();
    if (!trimmedSub) return true; // Empty part is OK
    return READ_ONLY_PATTERNS.some((pattern) => pattern.test(trimmedSub));
  });
}

/**
 * Check if a bash command is allowed in the given mode
 */
function checkBashPermission(
  command: string,
  mode: ToolExecutorMode,
): { allowed: boolean; reason?: string } {
  const trimmed = command.trim();

  // Always block dangerous patterns regardless of mode
  if (BLOCKED_PATTERNS.some((p) => p.test(trimmed))) {
    return { allowed: false, reason: "This command is blocked for safety" };
  }

  // In plan mode, only allow read-only commands
  if (mode === "plan" && !isReadOnlyCommand(trimmed)) {
    return {
      allowed: false,
      reason: "Write commands are not allowed in plan mode",
    };
  }

  return { allowed: true };
}

/**
 * Check if a write operation is allowed in the given mode
 */
function checkWritePermission(mode: ToolExecutorMode): {
  allowed: boolean;
  reason?: string;
} {
  if (mode === "plan") {
    return {
      allowed: false,
      reason: "Write operations are not allowed in plan mode",
    };
  }
  return { allowed: true };
}

/**
 * Create built-in tool handlers with mode-aware permission checks
 * @param mode - Execution mode ("plan" for read-only, "act" for write operations)
 * @param workspaceRoot - Workspace root directory for command execution
 */
function createBuiltinToolHandlers(
  mode: ToolExecutorMode,
  workspaceRoot?: string,
): Record<string, BuiltinToolHandler> {
  // Helper to resolve relative paths against workspace root
  const resolvePath = (filePath: string): string => {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return workspaceRoot ? path.join(workspaceRoot, filePath) : filePath;
  };

  return {
    /**
     * Read file contents
     * Returns structured output matching ReadFileOutput interface for UI display
     * Always allowed in both modes
     */
    Read: async (args: unknown): Promise<CliToolResult> => {
      logToOutput(
        `[CliToolExecutor:Read] Args received: ${JSON.stringify(args)}`,
      );

      const { file_path, offset, limit } = args as {
        file_path: string;
        offset?: number;
        limit?: number;
      };

      const resolvedPath = resolvePath(file_path);
      logToOutput(
        `[CliToolExecutor:Read] Resolved path: ${resolvedPath} (from ${file_path})`,
      );

      try {
        const content = await fs.readFile(resolvedPath, "utf-8");
        const lines = content.split("\n");

        // Apply offset and limit if specified
        const startLine = offset ?? 0;
        const endLine = limit ? startLine + limit : lines.length;
        const selectedLines = lines.slice(startLine, endLine);

        // Format with line numbers like cat -n
        const numberedContent = selectedLines
          .map(
            (line, idx) => `${String(startLine + idx + 1).padStart(6)}→${line}`,
          )
          .join("\n");

        // Return structured output for UI display
        return {
          success: true,
          result: JSON.stringify({
            content: numberedContent,
            filePath: file_path,
            startLine: startLine + 1, // 1-indexed for display
            endLine: endLine,
          }),
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logToOutput(`[CliToolExecutor:Read] Error reading file: ${msg}`);
        return {
          success: false,
          result: "",
          error: `Failed to read file: ${msg}`,
        };
      }
    },

    /**
     * Write file contents
     * Only allowed in "act" mode
     */
    Write: async (args: unknown): Promise<CliToolResult> => {
      logToOutput(
        `[CliToolExecutor:Write] Args received: ${JSON.stringify(args)}`,
      );

      // Check write permission based on mode
      const permission = checkWritePermission(mode);
      if (!permission.allowed) {
        logToOutput(`[CliToolExecutor] Write blocked: ${permission.reason}`);
        return { success: false, result: "", error: permission.reason };
      }

      const { file_path, content } = args as {
        file_path: string;
        content: string;
      };

      const resolvedPath = resolvePath(file_path);

      try {
        await fs.writeFile(resolvedPath, content, "utf-8");
        return { success: true, result: `Successfully wrote to ${file_path}` };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          result: "",
          error: `Failed to write file: ${msg}`,
        };
      }
    },

    /**
     * Edit file with string replacement
     * Only allowed in "act" mode
     */
    Edit: async (args: unknown): Promise<CliToolResult> => {
      logToOutput(
        `[CliToolExecutor:Edit] Args received: ${JSON.stringify(args)}`,
      );

      // Check write permission based on mode
      const permission = checkWritePermission(mode);
      if (!permission.allowed) {
        logToOutput(`[CliToolExecutor] Edit blocked: ${permission.reason}`);
        return { success: false, result: "", error: permission.reason };
      }

      const { file_path, old_string, new_string, replace_all } = args as {
        file_path: string;
        old_string: string;
        new_string: string;
        replace_all?: boolean;
      };

      const resolvedPath = resolvePath(file_path);

      try {
        const content = await fs.readFile(resolvedPath, "utf-8");

        let newContent: string;
        if (replace_all) {
          newContent = content.split(old_string).join(new_string);
        } else {
          const idx = content.indexOf(old_string);
          if (idx === -1) {
            return {
              success: false,
              result: "",
              error: `Could not find string to replace in ${file_path}`,
            };
          }
          newContent =
            content.substring(0, idx) +
            new_string +
            content.substring(idx + old_string.length);
        }

        await fs.writeFile(resolvedPath, newContent, "utf-8");
        return { success: true, result: `Successfully edited ${file_path}` };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          result: "",
          error: `Failed to edit file: ${msg}`,
        };
      }
    },

    /**
     * Execute bash command
     * Returns structured output matching BashExecuteOutput interface for UI display
     * In "plan" mode, only read-only commands are allowed
     * In "act" mode, write commands are also allowed (except blocked patterns)
     */
    Bash: async (args: unknown): Promise<CliToolResult> => {
      logToOutput(
        `[CliToolExecutor:Bash] Args received: ${JSON.stringify(args)}`,
      );

      const { command, timeout } = args as {
        command: string;
        timeout?: number;
      };

      logToOutput(
        `[CliToolExecutor:Bash] Command: ${command}, timeout: ${timeout}`,
      );

      // Check bash permission based on mode
      const permission = checkBashPermission(command, mode);
      logToOutput(
        `[CliToolExecutor:Bash] Permission check: allowed=${permission.allowed}, reason=${permission.reason || "none"}`,
      );

      if (!permission.allowed) {
        logToOutput(
          `[CliToolExecutor:Bash] Bash blocked: ${permission.reason} (command: ${command})`,
        );
        return { success: false, result: "", error: permission.reason };
      }

      try {
        const { stdout, stderr } = await execAsync(command, {
          timeout: timeout ?? 120000, // 2 minute default
          maxBuffer: 10 * 1024 * 1024, // 10MB
          cwd: workspaceRoot || process.cwd(), // Execute in workspace directory
        });

        logToOutput(
          `[CliToolExecutor:Bash] Command succeeded: stdout.length=${stdout.length}, stderr.length=${stderr?.length || 0}`,
        );

        // Return structured output for tool call UI component
        return {
          success: true,
          result: JSON.stringify({
            command,
            stdout,
            stderr: stderr || "",
            exitCode: 0,
          }),
        };
      } catch (error) {
        // Extract exit code, stdout, stderr from exec error
        const execError = error as {
          code?: number;
          stdout?: string;
          stderr?: string;
          message?: string;
        };
        const exitCode = execError.code ?? 1;
        const stdout = execError.stdout || "";
        const stderr = execError.stderr || "";
        const errorMessage = execError.message || String(error);

        logToOutput(
          `[CliToolExecutor:Bash] Caught error: exitCode=${exitCode}, stdout.length=${stdout.length}, stderr=${stderr.slice(0, 200)}`,
        );

        // Treat as success if:
        // 1. Exit code is 0, OR
        // 2. We have stdout output (command produced useful results), OR
        // 3. stderr is empty (not a real error, just no results found - e.g., ls on empty dir, grep with no matches)
        const isSuccessful =
          exitCode === 0 ||
          stdout.trim().length > 0 ||
          stderr.trim().length === 0;

        return {
          success: isSuccessful,
          result: JSON.stringify({
            command,
            stdout,
            stderr: stderr || errorMessage,
            exitCode,
          }),
          error: !isSuccessful
            ? `Command failed with exit code ${exitCode}`
            : undefined,
        };
      }
    },

    /**
     * Glob file pattern matching
     * Returns structured output for UI display
     * Always allowed in both modes (read-only operation)
     */
    Glob: async (args: unknown): Promise<CliToolResult> => {
      logToOutput(
        `[CliToolExecutor:Glob] Args received: ${JSON.stringify(args)}`,
      );

      const { pattern, path: basePath } = args as {
        pattern: string;
        path?: string;
      };

      logToOutput(
        `[CliToolExecutor:Glob] Pattern: ${pattern}, basePath: ${basePath}`,
      );

      try {
        const cwd = resolvePath(basePath ?? ".");
        const matches = await glob(pattern, {
          cwd,
          absolute: true,
        });

        // Return structured output for UI display
        return {
          success: true,
          result: JSON.stringify({
            pattern,
            files: matches.map((filePath) => ({ path: filePath })),
            totalMatches: matches.length,
          }),
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, result: "", error: `Glob failed: ${msg}` };
      }
    },

    /**
     * Grep search in files
     * Returns structured output for UI display
     * Always allowed in both modes (read-only operation)
     */
    Grep: async (args: unknown): Promise<CliToolResult> => {
      logToOutput(
        `[CliToolExecutor:Grep] Args received: ${JSON.stringify(args)}`,
      );

      const {
        pattern,
        path: searchPath,
        glob: globPattern,
      } = args as {
        pattern: string;
        path?: string;
        glob?: string;
      };

      logToOutput(
        `[CliToolExecutor:Grep] Pattern: ${pattern}, searchPath: ${searchPath}, glob: ${globPattern}`,
      );

      try {
        // Build ripgrep command with proper escaping
        const rgArgs: string[] = [
          "-n", // line numbers
          "--no-heading",
          "-l", // only show file names (faster, less output)
          "--max-count=100", // limit matches per file
        ];

        if (globPattern) {
          rgArgs.push("--glob", `'${globPattern}'`);
        }

        // Escape the pattern for shell
        const escapedPattern = pattern.replace(/'/g, "'\\''");
        rgArgs.push(`'${escapedPattern}'`);

        rgArgs.push(searchPath ?? ".");

        const { stdout } = await execAsync(`rg ${rgArgs.join(" ")}`, {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30000, // 30 second timeout
          cwd: workspaceRoot || process.cwd(), // Execute in workspace directory
        });

        // Parse output into structured format
        const files = stdout
          .trim()
          .split("\n")
          .filter((line) => line.length > 0)
          .map((filePath) => ({ path: filePath }));

        return {
          success: true,
          result: JSON.stringify({
            pattern,
            files,
            totalMatches: files.length,
          }),
        };
      } catch (error) {
        // rg returns exit code 1 for no matches, which is not an error
        const execError = error as { code?: number; stdout?: string };
        if (execError.code === 1) {
          return {
            success: true,
            result: JSON.stringify({
              pattern,
              files: [],
              totalMatches: 0,
            }),
          };
        }
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, result: "", error: `Grep failed: ${msg}` };
      }
    },
  };
}

/**
 * Result of executing a tool for the CLI
 */
export interface CliToolResult {
  success: boolean;
  result: string;
  error?: string;
}

/**
 * Options for the CLI tool executor
 */
export interface CliToolExecutorOptions {
  /** The tool set from tool-factory */
  tools: ToolSet;
  /** Optional callback for progress updates */
  progressCallback?: (status: string, message: string) => void;
  /** Execution mode - "plan" for read-only, "act" for write operations */
  mode?: ToolExecutorMode;
  /** Workspace root directory for command execution */
  workspaceRoot?: string;
}

/**
 * CLI Tool Executor
 * Executes tools from the tool set and returns serialized results
 */
export interface CliToolExecutor {
  /**
   * Execute a tool by name with given arguments
   * @param toolName - Name of the tool to execute
   * @param toolArgs - Arguments to pass to the tool
   * @param toolCallId - Unique ID for this tool call (for tracking)
   * @returns Serialized result string suitable for sending back to CLI
   */
  executeToolCall: (
    toolName: string,
    toolArgs: unknown,
    toolCallId: string,
  ) => Effect.Effect<CliToolResult, Error>;
}

/**
 * Create a CLI tool executor from a tool set
 */
export function createCliToolExecutor(
  options: CliToolExecutorOptions,
): CliToolExecutor {
  const { tools, progressCallback, mode = "plan", workspaceRoot } = options;

  // Create built-in handlers with mode-aware permissions
  const builtinToolHandlers = createBuiltinToolHandlers(mode, workspaceRoot);

  logToOutput(`[CliToolExecutor] Created executor with mode: ${mode}`);

  return {
    executeToolCall: (
      toolName: string,
      toolArgs: unknown,
      toolCallId: string,
    ) =>
      Effect.gen(function* () {
        logToOutput(
          `[CliToolExecutor] Executing tool: ${toolName} (${toolCallId}) in ${mode} mode`,
        );

        // Check for built-in CLI tools first (Read, Write, Edit, Bash, Glob, Grep)
        const builtinHandler = builtinToolHandlers[toolName];
        if (builtinHandler) {
          logToOutput(
            `[CliToolExecutor] Using built-in handler for: ${toolName}`,
          );

          // Register with abort registry to enable cancellation
          const abortController = ToolCallAbortRegistry.register(toolCallId);

          // Check if already aborted before starting
          if (abortController.signal.aborted) {
            logToOutput(
              `[CliToolExecutor] Tool ${toolName} (${toolCallId}) was already aborted`,
            );
            ToolCallAbortRegistry.cleanup(toolCallId);
            return {
              success: false,
              result: "",
              error: "Tool call was cancelled",
            };
          }

          progressCallback?.(
            "tool-executing",
            JSON.stringify({
              type: "tool-executing",
              toolCallId,
              toolName,
            }),
          );

          try {
            const result = yield* Effect.tryPromise({
              try: () => builtinHandler(toolArgs),
              catch: (error) => {
                const errorMsg =
                  error instanceof Error ? error.message : String(error);
                return new Error(errorMsg);
              },
            });

            logToOutput(
              `[CliToolExecutor] Built-in tool ${toolName} completed, success: ${result.success}`,
            );

            progressCallback?.(
              "tool-completed",
              JSON.stringify({
                type: "tool-completed",
                toolCallId,
                toolName,
              }),
            );

            return result;
          } finally {
            ToolCallAbortRegistry.cleanup(toolCallId);
          }
        }

        // Fall back to custom tool set
        const tool = tools[toolName] as Tool | undefined;

        if (!tool) {
          const errorMsg = `Unknown tool: ${toolName}`;
          logToOutput(`[CliToolExecutor] Error: ${errorMsg}`);
          return {
            success: false,
            result: "",
            error: errorMsg,
          };
        }

        // Check if tool has execute function
        if (!tool.execute) {
          const errorMsg = `Tool ${toolName} does not have an execute function`;
          logToOutput(`[CliToolExecutor] Error: ${errorMsg}`);
          return {
            success: false,
            result: "",
            error: errorMsg,
          };
        }

        // Register with abort registry to enable cancellation
        const abortController = ToolCallAbortRegistry.register(toolCallId);

        // Check if already aborted before starting
        if (abortController.signal.aborted) {
          logToOutput(
            `[CliToolExecutor] Tool ${toolName} (${toolCallId}) was already aborted`,
          );
          ToolCallAbortRegistry.cleanup(toolCallId);
          return {
            success: false,
            result: "",
            error: "Tool call was cancelled",
          };
        }

        progressCallback?.(
          "tool-executing",
          JSON.stringify({
            type: "tool-executing",
            toolCallId,
            toolName,
          }),
        );

        // Capture the execute function to satisfy TypeScript
        const executeFunc = tool.execute;

        try {
          // Execute the tool
          const result = yield* Effect.tryPromise({
            try: async () => {
              // The tool's execute function expects (args, options)
              // Options include toolCallId for tracking and abortSignal for cancellation
              const executeResult = await executeFunc(toolArgs, {
                toolCallId,
                messages: [],
                abortSignal: abortController.signal,
              });

              return executeResult;
            },
            catch: (error) => {
              const errorMsg =
                error instanceof Error ? error.message : String(error);
              logToOutput(
                `[CliToolExecutor] Tool execution error: ${errorMsg}`,
              );
              return new Error(errorMsg);
            },
          });

          // Serialize the result
          const serializedResult =
            typeof result === "string" ? result : JSON.stringify(result);

          logToOutput(
            `[CliToolExecutor] Tool ${toolName} completed, result length: ${serializedResult.length}`,
          );

          progressCallback?.(
            "tool-completed",
            JSON.stringify({
              type: "tool-completed",
              toolCallId,
              toolName,
            }),
          );

          return {
            success: true,
            result: serializedResult,
          };
        } finally {
          ToolCallAbortRegistry.cleanup(toolCallId);
        }
      }).pipe(
        Effect.catchAll((error) => {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          logToOutput(`[CliToolExecutor] Caught error: ${errorMsg}`);

          return Effect.succeed({
            success: false,
            result: "",
            error: errorMsg,
          });
        }),
      ),
  };
}
