/**
 * Build Claude CLI Command
 *
 * Constructs a `claude` CLI command string for running in a tmux window.
 * No --print flag — this runs interactive mode so the user can observe
 * and interact with Claude directly in the terminal.
 *
 * Uses loadCommand() from command-loader.ts for system prompts and tool configs.
 */

import { loadCommand } from "./command-loader";

/** Session mode — matches modes from command files (plan.md, build.md, review.md) */
export type SessionMode = "plan" | "build" | "review";

export interface BuildClaudeCommandOptions {
  /** Session mode (plan, build, review) — loads system prompt + tool config from command files */
  mode?: SessionMode;
  /** Initial prompt to send to Claude */
  prompt?: string;
  /** Workspace root directory */
  workspaceRoot: string;
  /** Model override (defaults to command file metadata or "opus") */
  model?: string;
  /** System prompt override (defaults to command file content) */
  systemPrompt?: string;
  /** Allowed tools override */
  allowedTools?: string[];
  /** Disallowed tools override */
  disallowedTools?: string[];
  /** Conversation ID to resume */
  resume?: string;
  /** Additional directories to add context from */
  addDirs?: string[];
  /** Permission mode (defaults to bypassPermissions for worker, plan for interactive) */
  permissionMode?: string;
}

/**
 * Build a claude CLI command string for interactive execution in a tmux window.
 */
export function buildClaudeCommand(opts: BuildClaudeCommandOptions): string {
  const args: string[] = ["claude"];

  // Load command file for mode-specific config
  const command = opts.mode
    ? loadCommand(opts.mode, opts.workspaceRoot)
    : null;

  // Model
  const model = opts.model || command?.metadata.model || "opus";
  args.push("--model", model);

  // System prompt
  const systemPrompt = opts.systemPrompt || command?.content;
  if (systemPrompt) {
    // Write system prompt to a temp approach using process substitution
    // For long system prompts, use --system-prompt with shell escaping
    args.push("--system-prompt", shellEscape(systemPrompt));
  }

  // Permission mode
  const permissionMode = opts.permissionMode || "bypassPermissions";
  args.push("--permission-mode", permissionMode);

  // Allowed tools
  const allowedTools = opts.allowedTools || command?.metadata.allowedTools;
  if (allowedTools && allowedTools.length > 0) {
    for (const tool of allowedTools) {
      args.push("--allowedTools", shellEscape(tool));
    }
  }

  // Disallowed tools
  const disallowedTools =
    opts.disallowedTools || command?.metadata.deniedTools;
  if (disallowedTools && disallowedTools.length > 0) {
    for (const tool of disallowedTools) {
      args.push("--disallowedTools", shellEscape(tool));
    }
  }

  // Resume session
  if (opts.resume) {
    args.push("--resume", opts.resume);
  }

  // Additional directories
  if (opts.addDirs) {
    for (const dir of opts.addDirs) {
      args.push("--add-dir", shellEscape(dir));
    }
  }

  // Initial prompt — passed as a positional argument for interactive mode.
  // Do NOT use -p/--print which runs non-interactively.
  if (opts.prompt) {
    args.push(shellEscape(opts.prompt));
  }

  return args.join(" ");
}

/**
 * Shell-escape a string for safe embedding in a command.
 * Uses single quotes with proper escaping of embedded single quotes.
 */
function shellEscape(str: string): string {
  // If the string has no special characters, just quote it
  if (/^[a-zA-Z0-9._\-\/=:,]+$/.test(str)) {
    return `'${str}'`;
  }
  // Replace single quotes with '\'' and wrap in single quotes
  return `'${str.replace(/'/g, "'\\''")}'`;
}
