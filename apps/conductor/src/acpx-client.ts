/**
 * AcpxClient
 *
 * TypeScript wrapper around the `acpx` CLI + OpenClaw gateway.
 * Handles agent spawning, prompting, steering, and lifecycle management.
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import type { AcpxResult, AcpxSpawnOptions } from "./types.js";

const execFileAsync = promisify(execFile);

export class AcpxClient {
  constructor(private readonly gatewayUrl: string) {}

  /** Spawn a new agent session via acpx */
  async spawnAgent(opts: AcpxSpawnOptions): Promise<string> {
    const args = [opts.agent || "claude"];

    if (opts.mode === "session") {
      args.push("--mode", "session");
    }

    args.push("--name", opts.name);
    args.push("--cwd", opts.cwd);

    if (opts.thread) {
      args.push("--thread");
    }

    // Use --print to get the session name back, then send the task
    args.push("--print", "session-name");
    args.push("--prompt", opts.task);

    console.log(`[AcpxClient] Spawning agent: acpx ${args.join(" ")}`);

    const { stdout } = await execFileAsync("acpx", args, {
      env: { ...process.env, OPENCLAW_GATEWAY_URL: this.gatewayUrl },
      timeout: 30_000,
    });

    const sessionName = stdout.trim();
    console.log(`[AcpxClient] Agent spawned: ${sessionName}`);
    return sessionName;
  }

  /** Send a prompt to an existing session */
  async prompt(
    session: string,
    message: string,
    opts?: { noWait?: boolean; format?: "json" | "text" },
  ): Promise<AcpxResult> {
    const args = [session, "prompt", message];

    if (opts?.noWait) args.push("--no-wait");
    if (opts?.format) args.push("--format", opts.format);

    try {
      const { stdout, stderr } = await execFileAsync("acpx", args, {
        env: { ...process.env, OPENCLAW_GATEWAY_URL: this.gatewayUrl },
        timeout: 600_000, // 10 min timeout for long-running prompts
      });
      return { output: stdout + stderr, exitCode: 0 };
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string; code?: number };
      return {
        output: (err.stdout || "") + (err.stderr || ""),
        exitCode: err.code || 1,
      };
    }
  }

  /** Steer an agent with a new instruction */
  async steer(session: string, instruction: string): Promise<void> {
    console.log(`[AcpxClient] Steering ${session}: ${instruction.slice(0, 100)}...`);
    await execFileAsync("acpx", [session, "steer", instruction], {
      env: { ...process.env, OPENCLAW_GATEWAY_URL: this.gatewayUrl },
      timeout: 30_000,
    });
  }

  /** Cancel/kill an agent session */
  async cancel(session: string): Promise<void> {
    console.log(`[AcpxClient] Cancelling session: ${session}`);
    try {
      await execFileAsync("acpx", [session, "cancel"], {
        env: { ...process.env, OPENCLAW_GATEWAY_URL: this.gatewayUrl },
        timeout: 15_000,
      });
    } catch {
      // Session may already be dead
      console.warn(`[AcpxClient] Cancel may have failed for ${session} (session may already be dead)`);
    }
  }

  /** Check if an agent session is still alive */
  async isAlive(session: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(
        "acpx",
        [session, "sessions", "show"],
        {
          env: { ...process.env, OPENCLAW_GATEWAY_URL: this.gatewayUrl },
          timeout: 10_000,
        },
      );
      return stdout.includes("running") || stdout.includes("active");
    } catch {
      return false;
    }
  }

  /** List all active sessions */
  async listSessions(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync("acpx", ["sessions", "list"], {
        env: { ...process.env, OPENCLAW_GATEWAY_URL: this.gatewayUrl },
        timeout: 10_000,
      });
      return stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /** Get recent output from a session */
  async getOutput(session: string, lines = 50): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        "acpx",
        [session, "output", "--lines", String(lines)],
        {
          env: { ...process.env, OPENCLAW_GATEWAY_URL: this.gatewayUrl },
          timeout: 10_000,
        },
      );
      return stdout;
    } catch {
      return "";
    }
  }

  /** Stream output from a session (returns the child process for event handling) */
  streamOutput(session: string): ChildProcess {
    return spawn("acpx", [session, "output", "--follow"], {
      env: { ...process.env, OPENCLAW_GATEWAY_URL: this.gatewayUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
}
