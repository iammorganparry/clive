/**
 * Conductor
 *
 * Main orchestration brain. Receives requests, manages the full lifecycle:
 * 1. Create worktree
 * 2. Run planning agent (or skip for fast path)
 * 3. Spawn build agents for each task
 * 4. Monitor completion
 * 5. Create PR
 * 6. Report status
 */

import { execSync } from "node:child_process";
import { WorktreeManager } from "@clive/worktree-manager";
import type { AcpxClient } from "./acpx-client.js";
import type { AgentManager } from "./agent-manager.js";
import type { ConductorConfig } from "./config.js";
import type { MonitorLoop } from "./monitor-loop.js";
import type { PrMonitor } from "./pr-monitor.js";
import type { SlackReporter } from "./slack-reporter.js";
import type { TaskRegistry } from "./task-registry.js";
import {
  COMPLETION_MARKERS,
  type ConductorRequest,
  type TaskEntry,
} from "./types.js";

export class Conductor {
  private readonly worktreeManager: WorktreeManager;

  constructor(
    private readonly config: ConductorConfig,
    private readonly registry: TaskRegistry,
    private readonly agentManager: AgentManager,
    private readonly monitorLoop: MonitorLoop,
    private readonly slackReporter: SlackReporter,
    private readonly prMonitor: PrMonitor,
    private readonly acpx: AcpxClient,
  ) {
    this.worktreeManager = new WorktreeManager(
      config.workspace,
      config.worktreeDir,
    );
  }

  /** Start the conductor (monitor loop + recovery) */
  async start(): Promise<void> {
    console.log("[Conductor] Starting...");

    // Recover any active tasks from a previous run
    const activeTasks = this.registry.active();
    if (activeTasks.length > 0) {
      console.log(`[Conductor] Recovering ${activeTasks.length} active tasks`);
    }

    this.monitorLoop.start();
    console.log("[Conductor] Started");
  }

  /** Stop the conductor gracefully */
  async stop(): Promise<void> {
    console.log("[Conductor] Stopping...");
    this.monitorLoop.stop();

    // Cancel all running agents
    const activeTasks = this.registry.active();
    for (const task of activeTasks) {
      for (const agent of task.agents) {
        if (agent.status === "running") {
          try {
            await this.acpx.cancel(agent.acpxSessionName);
          } catch {
            // Best effort
          }
        }
      }
    }

    console.log("[Conductor] Stopped");
  }

  /** Handle an incoming request -- main entry point */
  async handleRequest(request: ConductorRequest): Promise<TaskEntry> {
    const task = this.registry.create(request);
    console.log(`[Conductor] Created task ${task.id} (state: ${task.state})`);

    if (request.slackThread) {
      await this.slackReporter.postUpdate(
        request.slackThread,
        `:rocket: Starting task \`${task.id}\`...`,
      );
    }

    // Run orchestration asynchronously
    this.orchestrate(task).catch((error) => {
      console.error(
        `[Conductor] Orchestration failed for task ${task.id}:`,
        error,
      );
      this.registry.transitionState(task.id, "failed");
      if (request.slackThread) {
        this.slackReporter.postError(
          request.slackThread,
          `Task ${task.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    return task;
  }

  /** Main orchestration flow */
  private async orchestrate(task: TaskEntry): Promise<void> {
    // Step 1: Create worktree
    const worktreePath = this.worktreeManager.create(task.id);
    const branchName = `clive/${task.id}`;
    this.registry.update(task.id, { worktreePath, branchName });

    // Step 2: Planning (or skip for fast path)
    if (task.state === "pending") {
      await this.runPlanning(task);
    }

    // Step 3: Build loop
    await this.runBuildLoop(task);

    // Step 4: Create PR
    await this.createPr(task);

    // Step 5: Monitor loop handles CI + review from here
    if (task.slackThread) {
      await this.slackReporter.postTaskStatus(task.slackThread, task);
    }
  }

  /** Run planning phase */
  private async runPlanning(task: TaskEntry): Promise<void> {
    this.registry.transitionState(task.id, "planning");

    if (task.slackThread) {
      await this.slackReporter.postUpdate(
        task.slackThread,
        ":thinking_face: Starting planning phase...",
      );
    }

    const agent = await this.agentManager.spawnPlanningAgent(task);

    // Wait for planning to complete by polling output
    const linearUrls = await this.waitForPlanningCompletion(
      task,
      agent.acpxSessionName,
    );

    // Update task with Linear issue IDs
    if (linearUrls.length > 0) {
      this.registry.update(task.id, { linearTaskIds: linearUrls });
    }

    this.agentManager.releaseAgent(task.id, agent.acpxSessionName);
    this.registry.transitionState(task.id, "spawning");

    if (task.slackThread) {
      await this.slackReporter.postUpdate(
        task.slackThread,
        `:white_check_mark: Planning complete! ${linearUrls.length} tasks created.`,
      );
    }
  }

  /** Poll for planning agent completion and extract Linear URLs */
  private async waitForPlanningCompletion(
    task: TaskEntry,
    sessionName: string,
  ): Promise<string[]> {
    const maxWaitMs = 30 * 60 * 1000; // 30 minutes
    const pollIntervalMs = 10_000; // 10 seconds
    const startTime = Date.now();
    let linearUrls: string[] = [];

    while (Date.now() - startTime < maxWaitMs) {
      const alive = await this.acpx.isAlive(sessionName);
      const output = await this.acpx.getOutput(sessionName, 200);

      // Extract any Linear URLs found so far
      const urls = this.agentManager.parseLinearUrls(output);
      if (urls.length > 0) {
        linearUrls = urls;
      }

      if (!alive) {
        // Agent finished
        break;
      }

      await sleep(pollIntervalMs);
    }

    return linearUrls;
  }

  /** Run the build loop (Ralph loop: one task at a time) */
  private async runBuildLoop(task: TaskEntry): Promise<void> {
    this.registry.transitionState(task.id, "building");

    if (task.slackThread) {
      await this.slackReporter.postUpdate(
        task.slackThread,
        ":hammer_and_wrench: Starting build phase...",
      );
    }

    let allComplete = false;
    let iteration = 0;
    const maxIterations = 20; // Safety limit

    while (!allComplete && iteration < maxIterations) {
      iteration++;
      console.log(
        `[Conductor] Build iteration ${iteration} for task ${task.id}`,
      );

      const agent = await this.agentManager.spawnBuildAgent(task);

      // Wait for this build iteration to complete
      const result = await this.waitForBuildCompletion(
        task,
        agent.acpxSessionName,
      );
      this.agentManager.releaseAgent(task.id, agent.acpxSessionName);

      if (result.allComplete) {
        allComplete = true;
      } else if (!result.taskComplete) {
        // Agent died without completing -- retry handled by monitor loop
        console.warn(
          `[Conductor] Build agent died without completing in iteration ${iteration}`,
        );
        const freshTask = this.registry.get(task.id);
        if (freshTask?.state === "failed") break;
      }

      if (task.slackThread && result.taskComplete && !result.allComplete) {
        await this.slackReporter.postUpdate(
          task.slackThread,
          `:white_check_mark: Build iteration ${iteration} complete. Continuing...`,
        );
      }
    }

    if (!allComplete) {
      console.warn(
        `[Conductor] Build loop ended without ALL_TASKS_COMPLETE for task ${task.id}`,
      );
    }
  }

  /** Poll for build agent completion */
  private async waitForBuildCompletion(
    task: TaskEntry,
    sessionName: string,
  ): Promise<{ taskComplete: boolean; allComplete: boolean }> {
    const maxWaitMs = 60 * 60 * 1000; // 60 minutes
    const pollIntervalMs = 15_000; // 15 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const alive = await this.acpx.isAlive(sessionName);
      const output = await this.acpx.getOutput(sessionName, 100);
      const markers = this.agentManager.checkCompletionMarkers(output);

      if (markers.allComplete || markers.taskComplete || !alive) {
        return markers;
      }

      await sleep(pollIntervalMs);
    }

    return { taskComplete: false, allComplete: false };
  }

  /** Create a PR after all build tasks complete */
  private async createPr(task: TaskEntry): Promise<void> {
    const freshTask = this.registry.get(task.id)!;
    if (!freshTask.worktreePath || !freshTask.branchName) return;

    try {
      // Push the branch
      execSync("git push -u origin HEAD", {
        cwd: freshTask.worktreePath,
        stdio: "pipe",
      });

      // Create PR
      const prUrl = await this.prMonitor.createPr({
        branch: freshTask.branchName,
        title: `[Conductor] ${freshTask.prompt?.slice(0, 60) || "Automated changes"}`,
        body: this.buildPrBody(freshTask),
      });

      this.registry.update(task.id, { prUrl });
      this.registry.transitionState(task.id, "pr_open");

      if (freshTask.slackThread) {
        await this.slackReporter.postUpdate(
          freshTask.slackThread,
          `:git-pull-request: PR created: <${prUrl}|View PR>`,
        );
      }
    } catch (error) {
      console.error(
        `[Conductor] Failed to create PR for task ${task.id}:`,
        error,
      );
      throw error;
    }
  }

  /** Build PR description body */
  private buildPrBody(task: TaskEntry): string {
    const lines = [
      "## Summary",
      "",
      `Automated by Conductor (task \`${task.id}\`).`,
      "",
    ];

    if (task.prompt) {
      lines.push(`**Request:** ${task.prompt}`, "");
    }

    if (task.linearEpicId) {
      lines.push(`**Linear Epic:** ${task.linearEpicId}`, "");
    }

    if (task.linearTaskIds.length > 0) {
      lines.push("**Linear Tasks:**");
      for (const url of task.linearTaskIds) {
        lines.push(`- ${url}`);
      }
      lines.push("");
    }

    lines.push(
      "## Agent History",
      "",
      `Total agents spawned: ${task.agents.length}`,
      `Retries: ${task.retryCount}`,
      "",
    );

    return lines.join("\n");
  }

  /** Get status of a task */
  getStatus(taskId: string): TaskEntry | undefined {
    return this.registry.get(taskId);
  }

  /** Get all tasks */
  getAllTasks(): TaskEntry[] {
    return this.registry.all();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
