/**
 * Task Registry
 *
 * Persists task state to .conductor/active-tasks.json.
 * Uses atomic writes (write to temp -> rename) for crash safety.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { transition, isActive } from "./state-machine.js";
import type { TaskEntry, TaskState, ConductorRequest, AgentEntry } from "./types.js";

export class TaskRegistry {
  private tasks: Map<string, TaskEntry> = new Map();
  private readonly filePath: string;

  constructor(registryPath: string, workspace: string) {
    this.filePath = path.isAbsolute(registryPath)
      ? registryPath
      : path.join(workspace, registryPath);
    this.load();
  }

  /** Create a new task from a request */
  create(request: ConductorRequest): TaskEntry {
    const now = new Date().toISOString();
    const entry: TaskEntry = {
      id: randomUUID().slice(0, 8),
      state: "pending",
      prompt: request.prompt,
      slackThread: request.slackThread,
      linearTaskIds: [],
      agents: [],
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    // Fast path: if Linear URLs provided, skip to spawning
    if (request.linearIssueUrls?.length) {
      entry.state = "spawning";
      entry.linearTaskIds = request.linearIssueUrls;
    }

    this.tasks.set(entry.id, entry);
    this.save();
    return entry;
  }

  /** Get a task by ID */
  get(id: string): TaskEntry | undefined {
    return this.tasks.get(id);
  }

  /** Get all tasks */
  all(): TaskEntry[] {
    return Array.from(this.tasks.values());
  }

  /** Get all active (non-terminal) tasks */
  active(): TaskEntry[] {
    return this.all().filter((t) => isActive(t.state));
  }

  /** Transition a task to a new state */
  transitionState(id: string, newState: TaskState): TaskEntry {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    task.state = transition(task.state, newState);
    task.updatedAt = new Date().toISOString();
    this.save();
    return task;
  }

  /** Update task fields (partial update) */
  update(id: string, updates: Partial<Omit<TaskEntry, "id" | "createdAt">>): TaskEntry {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    Object.assign(task, updates, { updatedAt: new Date().toISOString() });
    this.save();
    return task;
  }

  /** Add an agent entry to a task */
  addAgent(taskId: string, agent: AgentEntry): TaskEntry {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    task.agents.push(agent);
    task.updatedAt = new Date().toISOString();
    this.save();
    return task;
  }

  /** Update an agent's status within a task */
  updateAgentStatus(
    taskId: string,
    sessionName: string,
    status: AgentEntry["status"],
  ): TaskEntry {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const agent = task.agents.find((a) => a.acpxSessionName === sessionName);
    if (!agent) throw new Error(`Agent not found: ${sessionName}`);

    agent.status = status;
    agent.lastActivityAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    this.save();
    return task;
  }

  /** Load registry from disk */
  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const data: TaskEntry[] = JSON.parse(raw);
        this.tasks = new Map(data.map((t) => [t.id, t]));
        console.log(`[TaskRegistry] Loaded ${this.tasks.size} tasks from ${this.filePath}`);
      }
    } catch (error) {
      console.warn("[TaskRegistry] Failed to load registry, starting fresh:", error);
      this.tasks = new Map();
    }
  }

  /** Persist registry to disk with atomic write */
  private save(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    const tmpPath = `${this.filePath}.tmp`;
    const data = JSON.stringify(Array.from(this.tasks.values()), null, 2);
    fs.writeFileSync(tmpPath, data, "utf-8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
