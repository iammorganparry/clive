import { exec, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { Data, Effect, Stream } from "effect";

const execAsync = promisify(exec);

/**
 * Simple logger for claude-cli-service with TUI prefix
 * Can be replaced with more sophisticated logging if needed
 */
function logToOutput(message: string) {
  if (process.env.NODE_ENV === "development" || process.env.DEBUG) {
    console.log(`[TUI] ${message}`);
  }
}

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
  /** Session ID to resume (uses --resume flag) */
  resumeSessionId?: string;
  /** Beta features to enable (passed via --betas flag) */
  betas?: string[];
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
  /** Send a user message to continue the conversation */
  sendMessage: (message: string) => void;
  /** Close stdin to signal completion */
  close: () => void;
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
       * Track AskUserQuestion tool_use_ids to prevent auto-approval
       * AskUserQuestion must NOT be auto-approved (user needs to provide real answers)
       */
      const pendingQuestionIds = new Set<string>();

      /**
       * Parse a single line of NDJSON output from Claude CLI
       * Handles both Anthropic API format and Claude CLI stream-json format
       * @param onPermissionDenial - Callback for auto-approving permission denials (except AskUserQuestion)
       */
      const parseCliOutput = (
        line: string,
        onPermissionDenial?: (
          toolUseId: string,
          isAskUserQuestion: boolean,
        ) => void,
      ): ClaudeCliEvent | null => {
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
              // Track AskUserQuestion tool uses to prevent auto-approval
              if (data.content_block.name === "AskUserQuestion") {
                pendingQuestionIds.add(data.content_block.id);
                logToOutput(
                  `[ClaudeCliService] Tracking AskUserQuestion: ${data.content_block.id}`,
                );
              }

              return {
                type: "tool_use",
                id: data.content_block.id,
                name: data.content_block.name,
                input: data.content_block.input || {},
              };
            }
            if (data.content_block?.type === "thinking") {
              return {
                type: "thinking",
                content: data.content_block.thinking || "",
              };
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
            if (
              data.delta?.stop_reason === "end_turn" ||
              data.delta?.stop_reason === "tool_use"
            ) {
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

          // Ignore system events (CLI initialization info)
          if (data.type === "system") {
            return null;
          }

          // Parse user events to extract tool_result for UI updates
          // These are tool results echoed back by CLI (from MCP server)
          if (data.type === "user") {
            const content = data.message?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                // Check for permission denials (tool_result with is_error: true)
                // Auto-approve permission denials EXCEPT for AskUserQuestion
                if (
                  block.type === "tool_result" &&
                  block.is_error === true &&
                  block.tool_use_id
                ) {
                  // Check if this is an AskUserQuestion - if so, don't auto-approve
                  const isAskUserQuestion = pendingQuestionIds.has(
                    block.tool_use_id,
                  );

                  // Call the permission denial callback
                  if (onPermissionDenial) {
                    onPermissionDenial(block.tool_use_id, isAskUserQuestion);
                  }

                  // Don't return this event to UI
                  return null;
                }

                if (block.type === "tool_result" && block.tool_use_id) {
                  // Return tool_result event for UI status updates
                  return {
                    type: "tool_result" as const,
                    id: block.tool_use_id,
                    content:
                      typeof block.content === "string"
                        ? block.content
                        : JSON.stringify(block.content),
                  };
                }
              }
            }
            return null;
          }

          // Unknown event type - log it for debugging
          logToOutput(
            `[ClaudeCliService] Unknown event type: ${data.type} ${JSON.stringify(data).substring(0, 200)}`,
          );
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

            // Build CLI arguments for bidirectional streaming
            // --input-format stream-json enables stdin input for prompts and tool results
            // --output-format stream-json enables streaming JSON output
            const args: string[] = [
              "--print", // Non-interactive mode
              "--verbose", // Required for stream-json with --print
              // Note: --debug disabled due to conversation replay bug with stream-json mode
              "--output-format",
              "stream-json", // Stream JSON output
              "--input-format",
              "stream-json", // Enable stdin input for prompts and tool results
              "--disallowedTools",
              "TodoWrite", // Disable unsupported TodoWrite tool
            ];

            // Sandbox file access to workspace directory only
            if (options.workspaceRoot) {
              args.push("--add-dir", options.workspaceRoot);
              logToOutput(
                `[ClaudeCliService] Directory sandboxed to: ${options.workspaceRoot}`,
              );
            }

            // NOTE: --resume was previously disabled due to tool_use/tool_result bugs
            // These were fixed in Claude CLI v2.1.0 and v2.1.9
            if (options.resumeSessionId) {
              args.push("--resume", options.resumeSessionId);
              logToOutput(
                `[ClaudeCliService] Resuming session: ${options.resumeSessionId}`,
              );
            }

            // Use bypassPermissions mode since we're only allowing MCP tools
            // AskUserQuestion is disabled - Claude will ask questions in text instead
            args.push("--permission-mode", "bypassPermissions");

            // Only allow MCP tools - AskUserQuestion disabled to avoid permission bugs
            // Claude will ask questions in text format instead
            args.push("--allowedTools", "mcp__clive-tools__*");

            // Add MCP server configuration if provided
            if (
              options.mcpSocketPath &&
              options.mcpServerPath &&
              options.workspaceRoot
            ) {
              const mcpConfig = {
                mcpServers: {
                  "clive-tools": {
                    type: "stdio",
                    command: "node",
                    args: [options.mcpServerPath],
                    env: {
                      CLIVE_WORKSPACE: options.workspaceRoot,
                      CLIVE_SOCKET: options.mcpSocketPath,
                    },
                  },
                },
              };
              args.push("--mcp-config", JSON.stringify(mcpConfig));
              logToOutput(
                `[ClaudeCliService] MCP config added: ${JSON.stringify(mcpConfig)}`,
              );
            }

            // Debug: Log the prompt being passed
            logToOutput(
              `[ClaudeCliService] Prompt length: ${options.prompt?.length ?? 0}`,
            );
            logToOutput(
              `[ClaudeCliService] Prompt preview: ${options.prompt?.substring(0, 100) ?? "(empty)"}`,
            );

            // Debug: Log the command being executed
            logToOutput(`[ClaudeCliService] Spawning CLI: ${cliPath}`);
            logToOutput(`[ClaudeCliService] Args: ${JSON.stringify(args)}`);

            if (options.model) {
              args.push("--model", options.model);
            }

            if (options.maxTokens) {
              args.push("--max-tokens", String(options.maxTokens));
            }

            if (options.systemPrompt) {
              args.push("--system-prompt", options.systemPrompt);
            }

            // Add beta features if specified
            if (options.betas && options.betas.length > 0) {
              args.push("--betas", ...options.betas);
              logToOutput(
                `[ClaudeCliService] Betas enabled: ${options.betas.join(", ")}`,
              );
            }

            // Note: Prompt is NOT passed via CLI args when using --input-format stream-json
            // It will be sent via stdin after spawn (see spawn event handler below)

            // Spawn the CLI process with inherited environment for auth
            const child = spawn(cliPath, args, {
              stdio: ["pipe", "pipe", "pipe"],
              env: { ...process.env },
              cwd: options.workspaceRoot || process.cwd(),
            });

            logToOutput(
              `[ClaudeCliService] Process spawned with PID: ${child.pid}`,
            );
            logToOutput(
              `[ClaudeCliService] stdout readable: ${child.stdout?.readable}, stderr readable: ${child.stderr?.readable}`,
            );

            // Track tool_result messages sent to stdin to prevent duplicates (upstream CLI bug workaround)
            // See: https://github.com/anthropics/claude-code/issues/14110
            const sentToolResultMessages = new Set<string>();

            // Listen for spawn event to confirm process started and send prompt
            child.on("spawn", () => {
              logToOutput(`[ClaudeCliService] Process spawn event fired`);

              // Send the prompt via stdin in stream-json format
              // This is required when using --input-format stream-json
              const userMessage = JSON.stringify({
                type: "user",
                message: {
                  role: "user",
                  content: options.prompt,
                },
              });
              child.stdin.write(`${userMessage}\n`);
              logToOutput(
                `[ClaudeCliService] Sent prompt via stdin (${options.prompt.length} chars)`,
              );
            });

            // Note: Do NOT close stdin here - we need it open for bidirectional
            // communication (sending tool results back to CLI)
            // stdin will be closed via handle.close() when execution completes

            // Create a stream from the CLI process stdout
            const stream = Stream.async<
              ClaudeCliEvent,
              ClaudeCliExecutionError
            >((emit) => {
              let buffer = "";

              child.stdout.on("data", (data: Buffer) => {
                const chunk = data.toString();
                logToOutput(
                  `[ClaudeCliService] stdout chunk (${chunk.length} bytes): ${chunk.substring(0, 100)}`,
                );
                buffer += chunk;
                const lines = buffer.split("\n");
                buffer = lines.pop() || ""; // Keep incomplete line in buffer

                for (const line of lines) {
                  // AskUserQuestion is disabled - permission denials should not occur
                  // If they do, log them for debugging but don't auto-approve
                  const event = parseCliOutput(
                    line,
                    (toolUseId, isAskUserQuestion) => {
                      if (isAskUserQuestion) {
                        logToOutput(
                          `[ClaudeCliService] Unexpected permission denial for AskUserQuestion: ${toolUseId} (tool should be disabled)`,
                        );
                      } else {
                        logToOutput(
                          `[ClaudeCliService] Permission denial for tool: ${toolUseId}`,
                        );
                      }
                    },
                  );

                  if (event) {
                    logToOutput(
                      `[ClaudeCliService] Emitting event: ${event.type}`,
                    );
                    emit.single(event);
                  }
                }
              });

              child.stderr.on("data", (data: Buffer) => {
                const errorText = data.toString().trim();
                logToOutput(`[ClaudeCliService] stderr: ${errorText}`);

                // Only emit as error if it's not a warning
                // The CLI uses stderr for both warnings and errors
                if (!errorText.startsWith("Warning:")) {
                  emit.single({ type: "error", message: errorText });
                }
              });

              child.on("error", (error) => {
                logToOutput(
                  `[ClaudeCliService] Process error: ${error.message}`,
                );
                emit.fail(
                  new ClaudeCliExecutionError({
                    message: `CLI process error: ${error.message}`,
                  }),
                );
              });

              child.on("close", (code) => {
                logToOutput(
                  `[ClaudeCliService] Process closed with code: ${code}`,
                );

                // Clear sent tool results for next execution
                sentToolResultMessages.clear();

                // Process any remaining buffer
                if (buffer.trim()) {
                  // No permission handling needed for final buffer processing
                  const event = parseCliOutput(buffer, () => {});
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
               * The CLI expects a 'user' message containing tool_result content blocks
               */
              sendToolResult: (toolCallId: string, result: string) => {
                logToOutput(
                  `[ClaudeCliService] sendToolResult called - toolCallId=${toolCallId}`,
                );
                logToOutput(
                  `[ClaudeCliService] Current sentToolResultMessages size: ${sentToolResultMessages.size}`,
                );
                logToOutput(
                  `[ClaudeCliService] sentToolResultMessages contents: ${JSON.stringify(Array.from(sentToolResultMessages))}`,
                );

                // Create unique key for this tool_result (tool_use_id + result preview)
                // This prevents the upstream CLI bug where duplicate tool_results cause 400 errors
                const resultKey = `${toolCallId}:${result.substring(0, 100)}`;
                logToOutput(
                  `[ClaudeCliService] Generated resultKey: ${resultKey}`,
                );

                // Check if we've already sent this exact tool_result
                if (sentToolResultMessages.has(resultKey)) {
                  logToOutput(
                    `[ClaudeCliService] WARNING: Duplicate tool_result detected and blocked - already sent to stdin`,
                  );
                  logToOutput(`  tool_use_id: ${toolCallId}`);
                  logToOutput(`  result preview: ${result.substring(0, 100)}`);

                  // DO NOT write to stdin - this would cause 400 error
                  return;
                }

                // Mark this tool_result as sent
                sentToolResultMessages.add(resultKey);
                logToOutput(
                  `[ClaudeCliService] Added to sentToolResultMessages. New size: ${sentToolResultMessages.size}`,
                );

                if (!child.stdin?.writable) {
                  console.error(
                    "[ClaudeCliService] Cannot send tool result - stdin not writable",
                  );
                  return;
                }

                // Tool results must be wrapped in a user message with tool_result content blocks
                const message = JSON.stringify({
                  type: "user",
                  message: {
                    role: "user",
                    content: [
                      {
                        type: "tool_result",
                        tool_use_id: toolCallId,
                        content: result,
                      },
                    ],
                  },
                });

                logToOutput(`[ClaudeCliService] Sending tool_result to stdin`);
                logToOutput(`  tool_use_id: ${toolCallId}`);
                logToOutput(`  result preview: ${result.substring(0, 100)}`);

                child.stdin.write(`${message}\n`);
                logToOutput(
                  `[ClaudeCliService] Successfully wrote tool_result to stdin`,
                );

                // Clean up tracked question IDs after sending result
                if (pendingQuestionIds.has(toolCallId)) {
                  pendingQuestionIds.delete(toolCallId);
                  logToOutput(
                    `[ClaudeCliService] Cleaned up AskUserQuestion tracking for ${toolCallId}`,
                  );
                }
              },

              /**
               * Send a user message to continue the conversation
               * The CLI expects a 'user' message containing the text content
               */
              sendMessage: (message: string) => {
                if (!child.stdin?.writable) {
                  console.error(
                    "[ClaudeCliService] Cannot send message - stdin not writable",
                  );
                  return;
                }

                // User messages are sent in stream-json format
                const userMessage = JSON.stringify({
                  type: "user",
                  message: {
                    role: "user",
                    content: message,
                  },
                });

                logToOutput(`[ClaudeCliService] Sending user message to stdin`);
                logToOutput(`  message preview: ${message.substring(0, 100)}`);

                child.stdin.write(`${userMessage}\n`);
                logToOutput(
                  `[ClaudeCliService] Successfully wrote user message to stdin`,
                );
              },

              /**
               * Close stdin to signal completion
               * Call this when the execution loop is done sending tool results
               */
              close: () => {
                if (child.stdin?.writable) {
                  logToOutput(
                    "[ClaudeCliService] Closing stdin to signal completion",
                  );
                  child.stdin.end();
                }
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
