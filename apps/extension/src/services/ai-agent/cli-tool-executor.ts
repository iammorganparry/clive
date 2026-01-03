/**
 * CLI Tool Executor
 * Bridges Claude CLI tool requests to existing tool implementations
 * Executes tools and returns serialized results for sending back to CLI
 *
 * Handles Claude CLI's built-in tools (Read, Write, Edit, Bash, Glob, Grep)
 * as well as custom tools from the tool factory.
 */

import { Effect } from "effect";
import type { ToolSet, Tool } from "ai";
import { logToOutput } from "../../utils/logger.js";
import * as fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { glob } from "glob";

const execAsync = promisify(exec);

/**
 * Built-in CLI tool handlers
 * These handle the standard Claude CLI tools (Read, Write, Edit, Bash, Glob, Grep)
 */
type BuiltinToolHandler = (args: unknown) => Promise<CliToolResult>;

const builtinToolHandlers: Record<string, BuiltinToolHandler> = {
  /**
   * Read file contents
   * Returns structured output matching ReadFileOutput interface for UI display
   */
  Read: async (args: unknown): Promise<CliToolResult> => {
    const { file_path, offset, limit } = args as {
      file_path: string;
      offset?: number;
      limit?: number;
    };

    try {
      const content = await fs.readFile(file_path, "utf-8");
      const lines = content.split("\n");

      // Apply offset and limit if specified
      const startLine = offset ?? 0;
      const endLine = limit ? startLine + limit : lines.length;
      const selectedLines = lines.slice(startLine, endLine);

      // Format with line numbers like cat -n
      const numberedContent = selectedLines
        .map((line, idx) => `${String(startLine + idx + 1).padStart(6)}→${line}`)
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
      return { success: false, result: "", error: `Failed to read file: ${msg}` };
    }
  },

  /**
   * Write file contents
   */
  Write: async (args: unknown): Promise<CliToolResult> => {
    const { file_path, content } = args as {
      file_path: string;
      content: string;
    };

    try {
      await fs.writeFile(file_path, content, "utf-8");
      return { success: true, result: `Successfully wrote to ${file_path}` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, result: "", error: `Failed to write file: ${msg}` };
    }
  },

  /**
   * Edit file with string replacement
   */
  Edit: async (args: unknown): Promise<CliToolResult> => {
    const { file_path, old_string, new_string, replace_all } = args as {
      file_path: string;
      old_string: string;
      new_string: string;
      replace_all?: boolean;
    };

    try {
      const content = await fs.readFile(file_path, "utf-8");

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

      await fs.writeFile(file_path, newContent, "utf-8");
      return { success: true, result: `Successfully edited ${file_path}` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, result: "", error: `Failed to edit file: ${msg}` };
    }
  },

  /**
   * Execute bash command
   * Returns structured output matching BashExecuteOutput interface for UI display
   */
  Bash: async (args: unknown): Promise<CliToolResult> => {
    const { command, timeout } = args as {
      command: string;
      timeout?: number;
    };

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: timeout ?? 120000, // 2 minute default
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      // Return structured output for BashExecuteTerminal UI component
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
      const stderr = execError.stderr || execError.message || String(error);

      return {
        success: exitCode === 0,
        result: JSON.stringify({
          command,
          stdout,
          stderr,
          exitCode,
        }),
        error: exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
      };
    }
  },

  /**
   * Glob file pattern matching
   * Returns structured output for UI display
   */
  Glob: async (args: unknown): Promise<CliToolResult> => {
    const { pattern, path: basePath } = args as {
      pattern: string;
      path?: string;
    };

    try {
      const cwd = basePath ?? process.cwd();
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
   */
  Grep: async (args: unknown): Promise<CliToolResult> => {
    const { pattern, path: searchPath, glob: globPattern } = args as {
      pattern: string;
      path?: string;
      glob?: string;
    };

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
  const { tools, progressCallback } = options;

  return {
    executeToolCall: (
      toolName: string,
      toolArgs: unknown,
      toolCallId: string,
    ) =>
      Effect.gen(function* () {
        logToOutput(
          `[CliToolExecutor] Executing tool: ${toolName} (${toolCallId})`,
        );

        // Check for built-in CLI tools first (Read, Write, Edit, Bash, Glob, Grep)
        const builtinHandler = builtinToolHandlers[toolName];
        if (builtinHandler) {
          logToOutput(`[CliToolExecutor] Using built-in handler for: ${toolName}`);

          progressCallback?.(
            "tool-executing",
            JSON.stringify({
              type: "tool-executing",
              toolCallId,
              toolName,
            }),
          );

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

        // Execute the tool
        const result = yield* Effect.tryPromise({
          try: async () => {
            // The tool's execute function expects (args, options)
            // Options include toolCallId for tracking
            const executeResult = await executeFunc(toolArgs, {
              toolCallId,
              messages: [],
              abortSignal: undefined,
            });

            return executeResult;
          },
          catch: (error) => {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            logToOutput(`[CliToolExecutor] Tool execution error: ${errorMsg}`);
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
