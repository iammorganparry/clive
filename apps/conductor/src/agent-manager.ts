/**
 * Agent Manager
 *
 * Handles the lifecycle of OpenClaw agents:
 * - Spawning planning and build agents in worktrees
 * - Health monitoring (alive + stuck detection)
 * - Graduated response: warn -> steer -> kill+respawn -> fail
 * - Output parsing for completion markers and Linear URLs
 */

import type { AcpxClient } from "./acpx-client.js";
import type { ConductorConfig } from "./config.js";
import type { ResourceGovernor } from "./resource-governor.js";
import type { TaskRegistry } from "./task-registry.js";
import {
  COMPLETION_MARKERS,
  type AgentEntry,
  type AgentHealthCheck,
  type AgentType,
  type ResponseLevel,
  type TaskEntry,
} from "./types.js";

/** Pattern to detect Linear issue URLs in agent output */
const LINEAR_URL_PATTERN = /https:\/\/linear\.app\/[^\s)]+\/issue\/[A-Z]+-\d+/g;

export class AgentManager {
  constructor(
    private readonly acpx: AcpxClient,
    private readonly registry: TaskRegistry,
    private readonly governor: ResourceGovernor,
    private readonly config: ConductorConfig,
  ) {}

  /** Spawn a planning agent that runs /clive-plan in the worktree */
  async spawnPlanningAgent(task: TaskEntry): Promise<AgentEntry> {
    const sessionName = `plan-${task.id}`;
    const cwd = task.worktreePath || this.config.workspace;

    await this.governor.acquire();

    try {
      await this.acpx.spawnAgent({
        name: sessionName,
        agent: "claude",
        cwd,
        task: `/clive-plan "${task.prompt || "Plan the work"}"`,
        mode: "session",
      });
    } catch (error) {
      this.governor.release();
      throw error;
    }

    const agent: AgentEntry = {
      acpxSessionName: sessionName,
      linearTaskId: "",
      agent: "claude",
      status: "running",
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };

    this.registry.addAgent(task.id, agent);
    return agent;
  }

  /** Spawn a build agent that runs /clive-build in the worktree */
  async spawnBuildAgent(
    task: TaskEntry,
    opts?: { agent?: AgentType },
  ): Promise<AgentEntry> {
    const iteration = task.agents.filter((a) =>
      a.acpxSessionName.startsWith("build-"),
    ).length;
    const sessionName = `build-${task.id}-${iteration}`;
    const cwd = task.worktreePath || this.config.workspace;

    await this.governor.acquire();

    try {
      await this.acpx.spawnAgent({
        name: sessionName,
        agent: opts?.agent || "claude",
        cwd,
        task: "/clive-build",
        mode: "session",
      });
    } catch (error) {
      this.governor.release();
      throw error;
    }

    const agent: AgentEntry = {
      acpxSessionName: sessionName,
      linearTaskId: "",
      agent: opts?.agent || "claude",
      status: "running",
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };

    this.registry.addAgent(task.id, agent);
    return agent;
  }

  /** Check health of all agents for a task */
  async checkAgentHealth(task: TaskEntry): Promise<AgentHealthCheck[]> {
    const checks: AgentHealthCheck[] = [];

    for (const agent of task.agents) {
      if (agent.status !== "running") continue;

      const alive = await this.acpx.isAlive(agent.acpxSessionName);
      const minutesSinceActivity =
        (Date.now() - new Date(agent.lastActivityAt).getTime()) / 60_000;
      const stuck =
        alive && minutesSinceActivity > this.config.stuckThresholdMinutes;

      let lastOutput: string | undefined;
      if (stuck || !alive) {
        lastOutput = await this.acpx.getOutput(agent.acpxSessionName, 20);
      }

      checks.push({
        sessionName: agent.acpxSessionName,
        alive,
        stuck,
        lastOutput,
        minutesSinceActivity,
      });
    }

    return checks;
  }

  /** Determine the appropriate response level for a problematic agent */
  determineResponseLevel(
    task: TaskEntry,
    check: AgentHealthCheck,
  ): ResponseLevel {
    if (!check.alive) {
      return task.retryCount >= this.config.maxRetries ? "fail" : "respawn";
    }
    if (check.stuck) {
      if (check.minutesSinceActivity > this.config.stuckThresholdMinutes * 3) {
        return task.retryCount >= this.config.maxRetries ? "fail" : "respawn";
      }
      if (check.minutesSinceActivity > this.config.stuckThresholdMinutes * 2) {
        return "steer";
      }
      return "warn";
    }
    return "warn";
  }

  /** Apply graduated response to a problematic agent */
  async respondToAgent(
    task: TaskEntry,
    check: AgentHealthCheck,
    level: ResponseLevel,
  ): Promise<void> {
    console.log(
      `[AgentManager] Responding to ${check.sessionName}: level=${level}`,
    );

    switch (level) {
      case "warn":
        console.warn(
          `[AgentManager] Agent ${check.sessionName} may be stuck (${Math.round(check.minutesSinceActivity)}min idle)`,
        );
        break;

      case "steer":
        await this.acpx.steer(
          check.sessionName,
          "You appear to be stuck. Please summarize your current status and what's blocking you. If you're waiting for something, try a different approach.",
        );
        break;

      case "respawn": {
        await this.acpx.cancel(check.sessionName);
        this.governor.release();
        this.registry.updateAgentStatus(task.id, check.sessionName, "failed");
        this.registry.update(task.id, { retryCount: task.retryCount + 1 });

        // Determine if this was a planning or build agent and respawn
        if (check.sessionName.startsWith("plan-")) {
          await this.spawnPlanningAgent(task);
        } else {
          await this.spawnBuildAgent(task);
        }
        break;
      }

      case "fail":
        await this.acpx.cancel(check.sessionName);
        this.governor.release();
        this.registry.updateAgentStatus(task.id, check.sessionName, "failed");
        this.registry.transitionState(task.id, "failed");
        break;
    }
  }

  /** Parse agent output for Linear issue URLs */
  parseLinearUrls(output: string): string[] {
    const matches = output.match(LINEAR_URL_PATTERN);
    return matches ? [...new Set(matches)] : [];
  }

  /** Check if agent output contains completion markers */
  checkCompletionMarkers(output: string): {
    taskComplete: boolean;
    allComplete: boolean;
  } {
    return {
      taskComplete: output.includes(COMPLETION_MARKERS.TASK_COMPLETE),
      allComplete: output.includes(COMPLETION_MARKERS.ALL_TASKS_COMPLETE),
    };
  }

  /** Release the governor slot for a completed/failed agent */
  releaseAgent(taskId: string, sessionName: string): void {
    this.governor.release();
    this.registry.updateAgentStatus(taskId, sessionName, "completed");
  }
}
