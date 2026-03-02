/**
 * Monitor Loop
 *
 * Interval-based babysitting loop that checks all active tasks.
 * Runs every 30s (configurable) and handles:
 * - Agent health checks (alive? stuck?)
 * - CI status monitoring
 * - PR review status monitoring
 * - Graduated responses to problems
 */

import type { AgentManager } from "./agent-manager.js";
import type { CiMonitor } from "./ci-monitor.js";
import type { ConductorConfig } from "./config.js";
import type { PrMonitor } from "./pr-monitor.js";
import type { SlackReporter } from "./slack-reporter.js";
import type { TaskRegistry } from "./task-registry.js";
import { isActive } from "./state-machine.js";
import type { TaskEntry } from "./types.js";

export class MonitorLoop {
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly registry: TaskRegistry,
    private readonly agentManager: AgentManager,
    private readonly ciMonitor: CiMonitor,
    private readonly prMonitor: PrMonitor,
    private readonly slackReporter: SlackReporter,
    private readonly config: ConductorConfig,
  ) {}

  /** Start the monitor loop */
  start(): void {
    if (this.interval) return;
    console.log(
      `[MonitorLoop] Starting with ${this.config.monitorInterval}ms interval`,
    );
    this.interval = setInterval(
      () => this.tick(),
      this.config.monitorInterval,
    );
    // Run immediately on start
    this.tick();
  }

  /** Stop the monitor loop */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log("[MonitorLoop] Stopped");
  }

  /** Single tick of the monitor loop */
  private async tick(): Promise<void> {
    if (this.running) return; // Skip if previous tick still running
    this.running = true;

    try {
      const activeTasks = this.registry.active();
      for (const task of activeTasks) {
        await this.checkTask(task);
      }
    } catch (error) {
      console.error("[MonitorLoop] Tick error:", error);
    } finally {
      this.running = false;
    }
  }

  /** Check a single task */
  private async checkTask(task: TaskEntry): Promise<void> {
    // Check agent health for tasks with running agents
    if (task.state === "planning" || task.state === "building") {
      await this.checkAgents(task);
    }

    // Check CI status for tasks with open PRs
    if (task.state === "pr_open" && task.branchName) {
      await this.checkCi(task);
    }

    // Check PR review status
    if (task.state === "reviewing" && task.prUrl) {
      await this.checkReview(task);
    }
  }

  /** Check agents for a task */
  private async checkAgents(task: TaskEntry): Promise<void> {
    const checks = await this.agentManager.checkAgentHealth(task);

    for (const check of checks) {
      if (!check.alive || check.stuck) {
        const level = this.agentManager.determineResponseLevel(task, check);
        await this.agentManager.respondToAgent(task, check, level);

        // Report to Slack
        if (task.slackThread && level !== "warn") {
          const msg =
            level === "steer"
              ? `:warning: Agent \`${check.sessionName}\` appears stuck (${Math.round(check.minutesSinceActivity)}min idle). Attempting to steer.`
              : level === "respawn"
                ? `:recycle: Agent \`${check.sessionName}\` failed. Respawning (attempt ${task.retryCount + 1}/${this.config.maxRetries}).`
                : `:x: Agent \`${check.sessionName}\` failed after ${this.config.maxRetries} retries. Task marked as failed.`;
          await this.slackReporter.postUpdate(task.slackThread, msg);
        }
      }

      // Check for completion markers in output
      if (check.alive && !check.stuck) {
        const output = await this.agentManager["acpx"].getOutput(
          check.sessionName,
          100,
        );
        const markers = this.agentManager.checkCompletionMarkers(output);

        if (markers.allComplete) {
          this.agentManager.releaseAgent(task.id, check.sessionName);
          // All tasks done -- transition to PR creation
          if (task.slackThread) {
            await this.slackReporter.postUpdate(
              task.slackThread,
              ":white_check_mark: All build tasks complete! Creating PR...",
            );
          }
        } else if (markers.taskComplete) {
          // Single task done -- agent should continue or we spawn next iteration
          const agentEntry = task.agents.find(
            (a) => a.acpxSessionName === check.sessionName,
          );
          if (agentEntry) {
            agentEntry.lastActivityAt = new Date().toISOString();
          }
        }
      }
    }
  }

  /** Check CI status for a task */
  private async checkCi(task: TaskEntry): Promise<void> {
    if (!task.branchName) return;
    const ciStatus = await this.ciMonitor.checkBranch(task.branchName);

    if (ciStatus !== task.ciStatus) {
      this.registry.update(task.id, { ciStatus });

      if (task.slackThread) {
        const emoji =
          ciStatus === "passing"
            ? ":white_check_mark:"
            : ciStatus === "failing"
              ? ":x:"
              : ":hourglass:";
        await this.slackReporter.postUpdate(
          task.slackThread,
          `${emoji} CI status: *${ciStatus}*`,
        );
      }

      // If CI passes and PR is open, transition to reviewing
      if (ciStatus === "passing" && task.state === "pr_open") {
        this.registry.transitionState(task.id, "reviewing");
      }
    }
  }

  /** Check PR review status */
  private async checkReview(task: TaskEntry): Promise<void> {
    if (!task.prUrl) return;
    const reviewStatus = await this.prMonitor.checkReview(task.prUrl);

    if (reviewStatus !== task.reviewStatus) {
      this.registry.update(task.id, { reviewStatus });

      if (reviewStatus === "approved") {
        this.registry.transitionState(task.id, "complete");
        if (task.slackThread) {
          await this.slackReporter.postCompletion(task.slackThread, task);
        }
      } else if (reviewStatus === "changes_requested") {
        // Transition back to building to address feedback
        this.registry.transitionState(task.id, "building");
        if (task.slackThread) {
          await this.slackReporter.postUpdate(
            task.slackThread,
            ":memo: Changes requested on PR. Spawning agent to address feedback...",
          );
        }
      }
    }
  }
}
