/**
 * TaskService - Unified task management for TUI
 * Coordinates BeadsService and LinearService based on config
 */

import { Effect, Layer, Runtime, Data } from 'effect';
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
export class TaskServiceConfigError extends Data.TaggedError('TaskServiceConfigError')<{
  readonly message: string;
}> {}

// Helper to create service effects for a given config
export function createTaskService(config: Config) {
  // Build the layer based on config
  const serviceLayer = config.issueTracker === 'linear' && config.linear
    ? makeLinearServiceLive(config.linear)
    : BeadsServiceLive;

  // Helper to wrap effects with the layer
  const provide = <A, E>(effect: Effect.Effect<A, E, BeadsService | LinearService>) =>
    Effect.provide(effect, serviceLayer);

  return {
    getConfig: Effect.succeed(config),

    loadSessions: provide(
      Effect.gen(function* () {
        if (config.issueTracker === 'linear' && config.linear) {
          // Match Go TUI logic: fetch parent issues + assigned issues
          const linearService = yield* LinearService;

          // Get current user ID first
          const viewer = yield* linearService.getCurrentUser;

          // Fetch all issues for the team (we'll filter client-side)
          const allIssues = yield* linearService.listIssues({
            teamId: config.linear.teamID,
            limit: 100,
          });

          // Filter for parent issues (top-level with no parent that have children)
          const parentIssues = allIssues.filter(
            (issue) => !issue.parent && issue.children && issue.children.nodes.length > 0
          );

          // Fetch issues assigned to current user
          const assignedIssues = yield* linearService.listIssues({
            teamId: config.linear.teamID,
            assigneeId: viewer.id,
            limit: 100,
          });

          // Merge and deduplicate by ID
          const issueMap = new Map<string, LinearIssue>();

          // Add parent issues (already filtered for those with children)
          for (const issue of parentIssues) {
            issueMap.set(issue.id, issue);
          }

          // Add assigned issues (filter for top-level only)
          for (const issue of assignedIssues) {
            if (!issue.parent) {
              issueMap.set(issue.id, issue);
            }
          }

          // Convert to sessions
          const sessions = Array.from(issueMap.values()).map(
            (issue): Session => ({
              id: issue.id,
              name: issue.title,
              description: issue.description,
              createdAt: issue.createdAt,
              source: 'linear',
              linearData: issue,
            })
          );

          // Sort by updated date (most recent first)
          return sessions.sort((a, b) => {
            const aUpdated = a.linearData?.updatedAt || a.createdAt;
            const bUpdated = b.linearData?.updatedAt || b.createdAt;
            return new Date(bUpdated).getTime() - new Date(aUpdated).getTime();
          });
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
      }).pipe(
        Effect.catchAll((error) => {
          // Log the full error for debugging
          const errorMsg = error instanceof Error
            ? `${error.message}\n${error.stack}`
            : JSON.stringify(error, null, 2);

          return Effect.fail(
            new TaskServiceConfigError({ message: `Failed to load sessions: ${errorMsg}` })
          );
        })
      )
    ),

    loadTasks: (sessionId: string) =>
      provide(
        Effect.gen(function* () {
          let tasks: Task[];

          if (config.issueTracker === 'linear' && config.linear) {
            // Load Linear sub-issues (children) of the epic/parent issue
            const linearService = yield* LinearService;
            const issues = yield* linearService.getSubIssues(sessionId);
            tasks = issues as Task[];
          } else {
            // Load Beads issues
            const beadsService = yield* BeadsService;
            const issues = yield* beadsService.list();

            // Filter by parent epic
            tasks = issues.filter((issue) => issue.type !== 'epic') as Task[];
          }

          // Cache tasks to filesystem for build script
          yield* Effect.tryPromise({
            try: async () => {
              const fs = await import('fs/promises');
              const path = await import('path');
              const os = await import('os');

              const epicDir = path.join(os.homedir(), '.claude', 'epics', sessionId);
              await fs.mkdir(epicDir, { recursive: true });

              const tasksFile = path.join(epicDir, 'tasks.json');
              await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
            },
            catch: (error) => {
              // Log but don't fail the entire operation if caching fails
              console.error('Failed to cache tasks to filesystem:', error);
              return error;
            },
          }).pipe(
            Effect.catchAll(() => Effect.succeed(undefined)) // Ignore cache failures
          );

          return tasks;
        }).pipe(
          Effect.catchAll((error) =>
            Effect.fail(
              new TaskServiceConfigError({ message: `Failed to load tasks: ${error}` })
            )
          )
        )
      ),

    loadReadyTasks: provide(
      Effect.gen(function* () {
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
      }).pipe(
        Effect.catchAll((error) =>
          Effect.fail(
            new TaskServiceConfigError({ message: `Failed to load ready tasks: ${error}` })
          )
        )
      )
    ),

    updateTaskStatus: (
      taskId: string,
      status: 'open' | 'in_progress' | 'completed' | 'blocked'
    ) =>
      provide(
        Effect.gen(function* () {
          if (config.issueTracker === 'linear' && config.linear) {
            // Update Linear issue state
            const linearService = yield* LinearService;

            // Map status to Linear state
            const states = yield* linearService.listWorkflowStates(config.linear.teamID);
            const targetState = states.find((s) => {
              if (status === 'in_progress') return s.type === 'started';
              if (status === 'completed') return s.type === 'completed';
              if (status === 'blocked') return s.type === 'unstarted';
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
            const linearStatus = status === 'completed' ? 'closed' : status;
            yield* beadsService.update(taskId, { status: linearStatus });
          }
        }).pipe(
          Effect.catchAll((error) =>
            Effect.fail(
              new TaskServiceConfigError({ message: `Failed to update task status: ${error}` })
            )
          )
        )
      ),

    createTask: (sessionId: string, title: string, type: 'task' | 'bug' | 'feature') =>
      provide(
        Effect.gen(function* () {
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
        }).pipe(
          Effect.catchAll((error) =>
            Effect.fail(
              new TaskServiceConfigError({ message: `Failed to create task: ${error}` })
            )
          )
        )
      ),
  };
}
