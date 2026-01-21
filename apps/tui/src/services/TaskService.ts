/**
 * TaskService - Unified task management for TUI
 * Coordinates BeadsService and LinearService based on config
 */

import { Effect, Context, Layer, Runtime } from 'effect';
import {
  BeadsService,
  BeadsServiceLive,
  LinearService,
  makeLinearServiceLive,
  type BeadsIssue,
  type LinearIssue,
  type LinearConfig,
} from '@clive/claude-services';
import { Task, Session, Config } from '../types';

// Error types
export class TaskServiceConfigError {
  readonly _tag = 'TaskServiceConfigError';
  constructor(readonly message: string) {}
}

// Service interface
export interface TaskService {
  /**
   * Get current configuration
   */
  readonly getConfig: Effect.Effect<Config, TaskServiceConfigError>;

  /**
   * Load all sessions (epics) from configured source
   */
  readonly loadSessions: Effect.Effect<Session[], TaskServiceConfigError>;

  /**
   * Load tasks for a specific session
   */
  readonly loadTasks: (sessionId: string) => Effect.Effect<Task[], TaskServiceConfigError>;

  /**
   * Load all ready tasks (no blockers)
   */
  readonly loadReadyTasks: Effect.Effect<Task[], TaskServiceConfigError>;

  /**
   * Update task status
   */
  readonly updateTaskStatus: (
    taskId: string,
    status: 'open' | 'in_progress' | 'completed' | 'blocked'
  ) => Effect.Effect<void, TaskServiceConfigError>;

  /**
   * Create a new task
   */
  readonly createTask: (
    sessionId: string,
    title: string,
    type: 'task' | 'bug' | 'feature'
  ) => Effect.Effect<Task, TaskServiceConfigError>;
}

export const TaskService = Context.GenericTag<TaskService>('@clive/tui/TaskService');

// Implementation
export class TaskServiceImpl implements TaskService {
  private runtime: Runtime.Runtime<BeadsService | LinearService>;
  private config: Config;

  constructor(config: Config) {
    this.config = config;

    // Build Effect runtime with appropriate layers
    const layers = this.buildLayers(config);
    this.runtime = Runtime.defaultRuntime.pipe(Runtime.provide(layers)) as any;
  }

  private buildLayers(config: Config) {
    if (config.issueTracker === 'linear' && config.linear) {
      return makeLinearServiceLive(config.linear);
    } else {
      // Default to beads
      return BeadsServiceLive;
    }
  }

  getConfig = Effect.succeed(this.config);

  loadSessions = Effect.gen(function* (this: TaskServiceImpl) {
    const config = yield* this.getConfig;

    if (config.issueTracker === 'linear' && config.linear) {
      // Load Linear epics
      const linearService = yield* LinearService;
      const epics = yield* linearService.listIssues({
        teamId: config.linear.teamID,
      });

      // Filter for epics (if Linear supports epic type) or projects
      return epics.map(
        (epic): Session => ({
          id: epic.id,
          name: epic.title,
          description: epic.description,
          createdAt: epic.createdAt,
          source: 'linear',
          linearData: epic,
        })
      );
    } else {
      // Load Beads epics
      const beadsService = yield* BeadsService;
      const epics = yield* beadsService.list({ type: 'epic' });

      return epics.map(
        (epic): Session => ({
          id: epic.id,
          name: epic.title,
          description: epic.description,
          createdAt: epic.createdAt,
          source: 'beads',
          beadsData: epic,
        })
      );
    }
  }.bind(this)).pipe(
    Effect.catchAll((error) =>
      Effect.fail(
        new TaskServiceConfigError(`Failed to load sessions: ${error}`)
      )
    )
  );

  loadTasks = (sessionId: string) =>
    Effect.gen(function* (this: TaskServiceImpl) {
      const config = yield* this.getConfig;

      if (config.issueTracker === 'linear' && config.linear) {
        // Load Linear issues for project
        const linearService = yield* LinearService;
        const issues = yield* linearService.listIssues({
          projectId: sessionId,
          teamId: config.linear.teamID,
        });

        return issues as Task[];
      } else {
        // Load Beads issues
        const beadsService = yield* BeadsService;
        const issues = yield* beadsService.list();

        // Filter by parent epic (if beads supports parent relationships)
        // For now, return all non-epic issues
        return issues.filter((issue) => issue.type !== 'epic') as Task[];
      }
    }.bind(this)).pipe(
      Effect.catchAll((error) =>
        Effect.fail(
          new TaskServiceConfigError(`Failed to load tasks: ${error}`)
        )
      )
    );

  loadReadyTasks = Effect.gen(function* (this: TaskServiceImpl) {
    const config = yield* this.getConfig;

    if (config.issueTracker === 'linear' && config.linear) {
      // Load Linear issues with 'started' state
      const linearService = yield* LinearService;
      const issues = yield* linearService.listIssues({
        teamId: config.linear.teamID,
        stateType: 'started',
      });

      return issues as Task[];
    } else {
      // Load ready beads issues
      const beadsService = yield* BeadsService;
      const issues = yield* beadsService.ready;

      return issues as Task[];
    }
  }.bind(this)).pipe(
    Effect.catchAll((error) =>
      Effect.fail(
        new TaskServiceConfigError(`Failed to load ready tasks: ${error}`)
      )
    )
  );

  updateTaskStatus = (
    taskId: string,
    status: 'open' | 'in_progress' | 'completed' | 'blocked'
  ) =>
    Effect.gen(function* (this: TaskServiceImpl) {
      const config = yield* this.getConfig;

      if (config.issueTracker === 'linear' && config.linear) {
        // Update Linear issue state
        const linearService = yield* LinearService;

        // Map status to Linear state
        // Would need to look up state IDs based on team
        const states = yield* linearService.listWorkflowStates(config.linear.teamID);
        const targetState = states.find((s) => {
          if (status === 'in_progress') return s.type === 'started';
          if (status === 'completed') return s.type === 'completed';
          if (status === 'blocked') return s.type === 'unstarted'; // or custom
          return s.type === 'backlog';
        });

        if (targetState) {
          yield* linearService.updateIssue(taskId, {
            stateId: targetState.id,
          });
        }
      } else {
        // Update Beads issue
        const beadsService = yield* BeadsService;
        yield* beadsService.update(taskId, { status });
      }
    }.bind(this)).pipe(
      Effect.catchAll((error) =>
        Effect.fail(
          new TaskServiceConfigError(`Failed to update task status: ${error}`)
        )
      )
    );

  createTask = (
    sessionId: string,
    title: string,
    type: 'task' | 'bug' | 'feature'
  ) =>
    Effect.gen(function* (this: TaskServiceImpl) {
      const config = yield* this.getConfig;

      if (config.issueTracker === 'linear' && config.linear) {
        // Create Linear issue
        const linearService = yield* LinearService;
        const issue = yield* linearService.createIssue({
          teamId: config.linear.teamID,
          title,
          projectId: sessionId,
        });

        return issue as Task;
      } else {
        // Create Beads issue
        const beadsService = yield* BeadsService;
        const issue = yield* beadsService.create({
          title,
          type,
          priority: 2,
        });

        return issue as Task;
      }
    }.bind(this)).pipe(
      Effect.catchAll((error) =>
        Effect.fail(
          new TaskServiceConfigError(`Failed to create task: ${error}`)
        )
      )
    );
}

// Factory function to create TaskService layer
export function makeTaskServiceLive(config: Config): Layer.Layer<TaskService> {
  return Layer.succeed(TaskService, new TaskServiceImpl(config));
}

// Helper to create TaskService instance for React hooks
export function createTaskService(config: Config): TaskService {
  const impl = new TaskServiceImpl(config);
  return {
    getConfig: impl.getConfig,
    loadSessions: impl.loadSessions,
    loadTasks: impl.loadTasks,
    loadReadyTasks: impl.loadReadyTasks,
    updateTaskStatus: impl.updateTaskStatus,
    createTask: impl.createTask,
  };
}
