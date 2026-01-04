import { Data, Effect, Stream } from "effect";
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { logToOutput } from "../utils/logger.js";

const execAsync = promisify(exec);

/**
 * Error when Claude CLI is not found
 */
export class ClaudeCliNotFoundError extends Data.TaggedError(
  "ClaudeCliNotFoundError",
)<{
  message: string;
  searchedPaths: string[];
}> {}

/**
 * Error when Claude CLI is not authenticated
 */
export class ClaudeCliNotAuthenticatedError extends Data.TaggedError(
  "ClaudeCliNotAuthenticatedError",
)<{
  message: string;
}> {}

/**
 * Error during Claude CLI execution
 */
export class ClaudeCliExecutionError extends Data.TaggedError(
  "ClaudeCliExecutionError",
)<{
  message: string;
  stderr?: string;
  exitCode?: number;
}> {}

/**
 * Status of the Claude CLI installation
 */
export interface ClaudeCliStatus {
  installed: boolean;
  path: string | null;
  authenticated: boolean;
  version: string | null;
}

/**
 * Event types from Claude CLI streaming output
 */
export type ClaudeCliEvent =
  | { type: "text"; content: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; content: string }
  | { type: "thinking"; content: string }
  | { type: "error"; message: string }
  | { type: "done" };

/**
 * Options for executing a prompt via Claude CLI
 */
export interface ClaudeCliExecuteOptions {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  workspaceRoot?: string;
  /** Path to MCP bridge socket (enables custom tools via MCP) */
  mcpSocketPath?: string;
  /** Path to MCP server JavaScript file */
  mcpServerPath?: string;
}

/**
 * Handle for bi-directional CLI communication
 * Allows reading events from stdout and sending tool results via stdin
 */
export interface CliExecutionHandle {
  /** Stream of events from CLI stdout */
  stream: Stream.Stream<ClaudeCliEvent, ClaudeCliExecutionError>;
  /** Send a tool result back to the CLI via stdin */
  sendToolResult: (toolCallId: string, result: string) => void;
  /** Kill the CLI process */
  kill: () => void;
}

/**
 * Get platform-specific CLI search paths
 */
function getCliSearchPaths(): string[] {
  const platform = os.platform();
  const home = os.homedir();

  if (platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return [
      path.join(appData, "Claude", "claude.exe"),
      path.join(home, ".claude", "claude.exe"),
      // Also check PATH
      "claude",
    ];
  }

  // macOS and Linux
  return [
    "/usr/local/bin/claude",
    path.join(home, ".local", "bin", "claude"),
    path.join(home, ".claude", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    // Also check PATH
    "claude",
  ];
}

/**
 * Check if a file exists and is executable
 */
function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Service for interacting with the Claude Code CLI
 * Allows users to use their Claude subscription instead of API keys
 */
export class ClaudeCliService extends Effect.Service<ClaudeCliService>()(
  "ClaudeCliService",
  {
    effect: Effect.gen(function* () {
      /**
       * Find the Claude CLI executable path
       */
      const findCliPath = () =>
        Effect.gen(function* () {
          const searchPaths = getCliSearchPaths();

          // First, check specific paths
          for (const searchPath of searchPaths) {
            if (searchPath === "claude") continue; // Skip PATH check for now
            if (isExecutable(searchPath)) {
              yield* Effect.logDebug(
                `[ClaudeCliService] Found CLI at: ${searchPath}`,
              );
              return searchPath;
            }
          }

          // Check if 'claude' is in PATH
          const pathCheckResult = yield* Effect.tryPromise({
            try: () =>
              execAsync(
                os.platform() === "win32" ? "where claude" : "which claude",
              ),
            catch: () => new Error("Not found in PATH"),
          }).pipe(
            Effect.map((result) => result.stdout),
            Effect.catchAll(() => Effect.succeed(null as string | null)),
          );

          if (pathCheckResult) {
            const cliPath = pathCheckResult.trim().split("\n")[0];
            if (cliPath && isExecutable(cliPath)) {
              yield* Effect.logDebug(
                `[ClaudeCliService] Found CLI in PATH: ${cliPath}`,
              );
              return cliPath;
            }
          }

          return yield* Effect.fail(
            new ClaudeCliNotFoundError({
              message:
                "Claude CLI not found. Please install Claude Code from https://claude.ai/download",
              searchedPaths: searchPaths,
            }),
          );
        });

      /**
       * Get the CLI version
       */
      const getVersion = (cliPath: string) =>
        Effect.tryPromise({
          try: () => execAsync(`"${cliPath}" --version`),
          catch: () => new Error("Failed to get version"),
        }).pipe(
          Effect.map((result) => result.stdout.trim()),
          Effect.catchAll(() => Effect.succeed(null as string | null)),
        );

      /**
       * Check if the user is authenticated with Claude
       */
      const checkAuthentication = (cliPath: string) =>
        Effect.tryPromise({
          try: async () => {
            // Try to run a simple command that requires auth
            const { stderr } = await execAsync(
              `"${cliPath}" --print "test" 2>&1`,
              {
                timeout: 10000,
              },
            );
            // If we get a response without auth errors, user is authenticated
            return (
              !stderr.includes("not logged in") &&
              !stderr.includes("authentication")
            );
          },
          catch: (error) => new Error(String(error)),
        }).pipe(
          Effect.catchAll((error) => {
            // Check if error message indicates auth issue
            const errorStr = error.message;
            const isAuthenticated =
              !errorStr.includes("not logged in") &&
              !errorStr.includes("authentication");
            return Effect.succeed(isAuthenticated);
          }),
        );

      /**
       * Parse a single line of NDJSON output from Claude CLI
       * Handles both Anthropic API format and Claude CLI stream-json format
       */
      const parseCliOutput = (line: string): ClaudeCliEvent | null => {
        if (!line.trim()) return null;

        // Debug: Log raw line
        logToOutput(`[ClaudeCliService] Raw line: ${line.substring(0, 200)}`);

        try {
          const data = JSON.parse(line);

          // Debug: Log parsed event type
          logToOutput(`[ClaudeCliService] Parsed event type: ${data.type}`);

          // Claude CLI stream-json format events
          // Handle content_block_start for tool_use
          if (data.type === "content_block_start") {
            if (data.content_block?.type === "tool_use") {
              return {
                type: "tool_use",
                id: data.content_block.id,
                name: data.content_block.name,
                input: data.content_block.input || {},
              };
            }
            if (data.content_block?.type === "thinking") {
              return { type: "thinking", content: data.content_block.thinking || "" };
            }
          }

          // Handle content_block_delta
          if (data.type === "content_block_delta") {
            if (data.delta?.type === "text_delta") {
              return { type: "text", content: data.delta.text };
            }
            if (data.delta?.type === "thinking_delta") {
              return { type: "thinking", content: data.delta.thinking };
            }
            if (data.delta?.type === "input_json_delta") {
              // Tool input is being streamed - we'll get complete input later
              return null;
            }
          }

          // Handle message_start - contains model info
          if (data.type === "message_start") {
            // Just acknowledge, no event needed
            return null;
          }

          // Handle message_delta - contains stop reason
          if (data.type === "message_delta") {
            if (data.delta?.stop_reason === "end_turn" || data.delta?.stop_reason === "tool_use") {
              return { type: "done" };
            }
            return null;
          }

          // Handle message_stop
          if (data.type === "message_stop" || data.type === "result") {
            return { type: "done" };
          }

          // Handle assistant message with content array
          if (data.type === "assistant" && data.message?.content) {
            for (const block of data.message.content) {
              if (block.type === "text") {
                return { type: "text", content: block.text };
              }
              if (block.type === "tool_use") {
                return {
                  type: "tool_use",
                  id: block.id,
                  name: block.name,
                  input: block.input,
                };
              }
              if (block.type === "thinking") {
                return { type: "thinking", content: block.thinking };
              }
            }
          }

          // Handle error events
          if (data.type === "error") {
            return {
              type: "error",
              message: data.error?.message || data.message || "Unknown error",
            };
          }

          // Unknown event type - log it for debugging
          logToOutput(`[ClaudeCliService] Unknown event type: ${data.type} ${JSON.stringify(data).substring(0, 200)}`);
          return null;
        } catch {
          // Not valid JSON, might be plain text output
          return { type: "text", content: line };
        }
      };

      return {
        /**
         * Detect if Claude CLI is installed and get status
         */
        detectCli: () =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              "[ClaudeCliService] Detecting Claude CLI...",
            );

            const cliPathResult = yield* findCliPath().pipe(
              Effect.map((p) => ({ found: true, path: p })),
              Effect.catchAll(() =>
                Effect.succeed({ found: false, path: null as string | null }),
              ),
            );

            if (!cliPathResult.found || !cliPathResult.path) {
              return {
                installed: false,
                path: null,
                authenticated: false,
                version: null,
              };
            }

            const version = yield* getVersion(cliPathResult.path);
            const authenticated = yield* checkAuthentication(
              cliPathResult.path,
            );

            yield* Effect.logDebug(
              `[ClaudeCliService] CLI detected: path=${cliPathResult.path}, version=${version}, authenticated=${authenticated}`,
            );

            return {
              installed: true,
              path: cliPathResult.path,
              authenticated,
              version,
            };
          }),

        /**
         * Check if the user is authenticated
         */
        checkAuth: () =>
          Effect.gen(function* () {
            const cliPath = yield* findCliPath();
            return yield* checkAuthentication(cliPath);
          }),

        /**
         * Trigger the authentication flow (opens browser)
         */
        authenticate: () =>
          Effect.gen(function* () {
            const cliPath = yield* findCliPath();
            yield* Effect.logDebug(
              "[ClaudeCliService] Starting authentication flow...",
            );

            // Run 'claude login' or '/login' command
            const result = yield* Effect.tryPromise({
              try: async () => {
                const { stdout, stderr } = await execAsync(
                  `"${cliPath}" /login`,
                  {
                    timeout: 120000, // 2 minute timeout for auth flow
                  },
                );
                return { stdout, stderr, success: true };
              },
              catch: (error) =>
                new ClaudeCliExecutionError({
                  message: `Authentication failed: ${String(error)}`,
                }),
            });

            if (!result.success) {
              return false;
            }

            // Verify authentication succeeded
            return yield* checkAuthentication(cliPath);
          }),

        /**
         * Execute a prompt via Claude CLI and stream the response
         * Returns a handle for bi-directional communication
         */
        execute: (options: ClaudeCliExecuteOptions) =>
          Effect.gen(function* () {
            const cliPath = yield* findCliPath();

            // Check authentication first
            const isAuthenticated = yield* checkAuthentication(cliPath);
            if (!isAuthenticated) {
              return yield* Effect.fail(
                new ClaudeCliNotAuthenticatedError({
                  message:
                    "Not authenticated with Claude. Please run 'claude login' first.",
                }),
              );
            }

            yield* Effect.logDebug(
              `[ClaudeCliService] Executing prompt via CLI: ${options.prompt.slice(0, 100)}...`,
            );

            // Build CLI arguments for streaming output
            // Note: --input-format stream-json would make the CLI wait for stdin
            // For now, we use command-line prompt and only output streaming
            const args: string[] = [
              "--print", // Non-interactive mode
              "--verbose", // Required for stream-json with --print
              "--output-format",
              "stream-json", // Stream JSON output
            ];

            // Add MCP server configuration if provided
            if (options.mcpSocketPath && options.mcpServerPath && options.workspaceRoot) {
              const mcpConfig = {
                "clive-tools": {
                  type: "stdio",
                  command: "node",
                  args: [options.mcpServerPath],
                  env: {
                    CLIVE_WORKSPACE: options.workspaceRoot,
                    CLIVE_SOCKET: options.mcpSocketPath,
                  },
                },
              };
              args.push("--mcp", JSON.stringify(mcpConfig));
              logToOutput(`[ClaudeCliService] MCP config added: ${JSON.stringify(mcpConfig)}`);
            }

            // Debug: Log the full command being executed
            const fullArgs = [...args, options.prompt];
            logToOutput(`[ClaudeCliService] Spawning CLI: ${cliPath}`);
            logToOutput(`[ClaudeCliService] Args: ${JSON.stringify(fullArgs)}`);

            if (options.model) {
              args.push("--model", options.model);
            }

            if (options.maxTokens) {
              args.push("--max-tokens", String(options.maxTokens));
            }

            if (options.systemPrompt) {
              args.push("--system-prompt", options.systemPrompt);
            }

            // Add the prompt as the last argument
            args.push(options.prompt);

            // Spawn the CLI process with inherited environment for auth
            const child = spawn(cliPath, args, {
              stdio: ["pipe", "pipe", "pipe"],
              env: { ...process.env },
            });

            logToOutput(`[ClaudeCliService] Process spawned with PID: ${child.pid}`);
            logToOutput(`[ClaudeCliService] stdout readable: ${child.stdout?.readable}, stderr readable: ${child.stderr?.readable}`);

            // Listen for spawn event to confirm process started
            child.on("spawn", () => {
              logToOutput(`[ClaudeCliService] Process spawn event fired`);
            });

            // Close stdin immediately for --print mode
            // This signals to the CLI that no more input is coming and it should start processing
            child.stdin.end();
            logToOutput(`[ClaudeCliService] stdin closed to signal start`);

            // Create a stream from the CLI process stdout
            const stream = Stream.async<
              ClaudeCliEvent,
              ClaudeCliExecutionError
            >((emit) => {
              let buffer = "";

              child.stdout.on("data", (data: Buffer) => {
                const chunk = data.toString();
                logToOutput(`[ClaudeCliService] stdout chunk (${chunk.length} bytes): ${chunk.substring(0, 100)}`);
                buffer += chunk;
                const lines = buffer.split("\n");
                buffer = lines.pop() || ""; // Keep incomplete line in buffer

                for (const line of lines) {
                  const event = parseCliOutput(line);
                  if (event) {
                    logToOutput(`[ClaudeCliService] Emitting event: ${event.type}`);
                    emit.single(event);
                  }
                }
              });

              child.stderr.on("data", (data: Buffer) => {
                const errorText = data.toString();
                logToOutput(`[ClaudeCliService] stderr: ${errorText}`);
                emit.single({ type: "error", message: errorText });
              });

              child.on("error", (error) => {
                logToOutput(`[ClaudeCliService] Process error: ${error.message}`);
                emit.fail(
                  new ClaudeCliExecutionError({
                    message: `CLI process error: ${error.message}`,
                  }),
                );
              });

              child.on("close", (code) => {
                logToOutput(`[ClaudeCliService] Process closed with code: ${code}`);
                // Process any remaining buffer
                if (buffer.trim()) {
                  const event = parseCliOutput(buffer);
                  if (event) {
                    emit.single(event);
                  }
                }

                if (code !== 0 && code !== null) {
                  emit.fail(
                    new ClaudeCliExecutionError({
                      message: `CLI exited with code ${code}`,
                      exitCode: code,
                    }),
                  );
                } else {
                  emit.single({ type: "done" });
                  emit.end();
                }
              });

              // Handle abort signal
              if (options.signal) {
                options.signal.addEventListener("abort", () => {
                  child.kill("SIGTERM");
                });
              }
            });

            // Create the execution handle with bi-directional communication
            const handle: CliExecutionHandle = {
              stream,

              /**
               * Send a tool result back to the CLI via stdin
               * The CLI expects NDJSON format: {"type": "tool_result", "tool_use_id": "...", "content": "..."}
               */
              sendToolResult: (toolCallId: string, result: string) => {
                if (!child.stdin?.writable) {
                  console.error(
                    "[ClaudeCliService] Cannot send tool result - stdin not writable",
                  );
                  return;
                }

                const message = JSON.stringify({
                  type: "tool_result",
                  tool_use_id: toolCallId,
                  content: result,
                });

                child.stdin.write(`${message}\n`);
              },

              /**
               * Kill the CLI process
               */
              kill: () => {
                child.kill("SIGTERM");
              },
            };

            return handle;
          }),

        /**
         * Get the path to the Claude CLI executable
         */
        getCliPath: () => findCliPath(),
      };
    }),
  },
) {}

/**
 * Live layer for ClaudeCliService
 */
export const ClaudeCliServiceLive = ClaudeCliService.Default;
