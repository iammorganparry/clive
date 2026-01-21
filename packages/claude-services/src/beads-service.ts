/**
 * BeadsService - Effect service for beads CLI operations
 * Provides typed interface to beads issue tracking system
 */

import { Context, Effect, Layer } from "effect";
import { spawn } from "child_process";

// Error types
export class BeadsNotFoundError {
  readonly _tag = "BeadsNotFoundError";
  constructor(readonly message: string = "Beads CLI not found in PATH") {}
}

export class BeadsExecutionError {
  readonly _tag = "BeadsExecutionError";
  constructor(
    readonly message: string,
    readonly exitCode?: number,
    readonly stderr?: string
  ) {}
}

// Domain types
export interface BeadsIssue {
  id: string;
  title: string;
  description?: string;
  status: "open" | "in_progress" | "closed" | "blocked";
  type: "task" | "bug" | "feature" | "epic";
  priority: number; // 0-4
  assignee?: string;
  createdAt: Date;
  updatedAt: Date;
  blockedBy?: string[];
  blocks?: string[];
  dependsOn?: string[];
}

export interface BeadsCreateOptions {
  title: string;
  type: "task" | "bug" | "feature" | "epic";
  priority?: number;
  description?: string;
  assignee?: string;
}

export interface BeadsUpdateOptions {
  status?: "open" | "in_progress" | "closed" | "blocked";
  title?: string;
  description?: string;
  assignee?: string;
  priority?: number;
}

export interface BeadsListOptions {
  status?: "open" | "in_progress" | "closed" | "blocked";
  type?: "task" | "bug" | "feature" | "epic";
  assignee?: string;
}

export interface BeadsStats {
  total: number;
  open: number;
  inProgress: number;
  closed: number;
  blocked: number;
}

// Service interface
export interface BeadsService {
  /**
   * Check if beads CLI is available
   */
  readonly checkAvailable: Effect.Effect<boolean, BeadsNotFoundError>;

  /**
   * List issues with optional filters
   */
  readonly list: (
    options?: BeadsListOptions
  ) => Effect.Effect<BeadsIssue[], BeadsExecutionError>;

  /**
   * Show detailed issue by ID
   */
  readonly show: (
    id: string
  ) => Effect.Effect<BeadsIssue, BeadsExecutionError | BeadsNotFoundError>;

  /**
   * Create a new issue
   */
  readonly create: (
    options: BeadsCreateOptions
  ) => Effect.Effect<BeadsIssue, BeadsExecutionError>;

  /**
   * Update an existing issue
   */
  readonly update: (
    id: string,
    options: BeadsUpdateOptions
  ) => Effect.Effect<BeadsIssue, BeadsExecutionError>;

  /**
   * Close one or more issues
   */
  readonly close: (
    ids: string[],
    reason?: string
  ) => Effect.Effect<void, BeadsExecutionError>;

  /**
   * Add dependency (issueId depends on dependsOnId)
   */
  readonly addDependency: (
    issueId: string,
    dependsOnId: string
  ) => Effect.Effect<void, BeadsExecutionError>;

  /**
   * List issues ready to work (no blockers)
   */
  readonly ready: Effect.Effect<BeadsIssue[], BeadsExecutionError>;

  /**
   * List all blocked issues
   */
  readonly blocked: Effect.Effect<BeadsIssue[], BeadsExecutionError>;

  /**
   * Get project statistics
   */
  readonly stats: Effect.Effect<BeadsStats, BeadsExecutionError>;

  /**
   * Sync with git remote
   */
  readonly sync: Effect.Effect<void, BeadsExecutionError>;

  /**
   * Check sync status
   */
  readonly syncStatus: Effect.Effect<
    { synced: boolean; ahead: number; behind: number },
    BeadsExecutionError
  >;
}

export const BeadsService = Context.GenericTag<BeadsService>("@clive/BeadsService");

// Implementation
export const BeadsServiceLive = Layer.succeed(
  BeadsService,
  BeadsService.of({
    checkAvailable: Effect.gen(function* () {
      const result = yield* execBeads(["--version"]);
      return result.exitCode === 0;
    }).pipe(
      Effect.catchAll(() => Effect.fail(new BeadsNotFoundError()))
    ),

    list: (options) =>
      Effect.gen(function* () {
        const args = ["list", "--format=json"];

        if (options?.status) {
          args.push(`--status=${options.status}`);
        }
        if (options?.type) {
          args.push(`--type=${options.type}`);
        }
        if (options?.assignee) {
          args.push(`--assignee=${options.assignee}`);
        }

        const result = yield* execBeads(args);
        return parseIssueList(result.stdout);
      }),

    show: (id) =>
      Effect.gen(function* () {
        const result = yield* execBeads(["show", id, "--format=json"]);
        return parseIssue(result.stdout);
      }),

    create: (options) =>
      Effect.gen(function* () {
        const args = [
          "create",
          `--title=${options.title}`,
          `--type=${options.type}`,
        ];

        if (options.priority !== undefined) {
          args.push(`--priority=${options.priority}`);
        }
        if (options.description) {
          args.push(`--description=${options.description}`);
        }
        if (options.assignee) {
          args.push(`--assignee=${options.assignee}`);
        }

        args.push("--format=json");

        const result = yield* execBeads(args);
        return parseIssue(result.stdout);
      }),

    update: (id, options) =>
      Effect.gen(function* () {
        const args = ["update", id];

        if (options.status) {
          args.push(`--status=${options.status}`);
        }
        if (options.title) {
          args.push(`--title=${options.title}`);
        }
        if (options.description) {
          args.push(`--description=${options.description}`);
        }
        if (options.assignee) {
          args.push(`--assignee=${options.assignee}`);
        }
        if (options.priority !== undefined) {
          args.push(`--priority=${options.priority}`);
        }

        args.push("--format=json");

        const result = yield* execBeads(args);
        return parseIssue(result.stdout);
      }),

    close: (ids, reason) =>
      Effect.gen(function* () {
        const args = ["close", ...ids];

        if (reason) {
          args.push(`--reason=${reason}`);
        }

        yield* execBeads(args);
      }),

    addDependency: (issueId, dependsOnId) =>
      Effect.gen(function* () {
        yield* execBeads(["dep", "add", issueId, dependsOnId]);
      }),

    ready: Effect.gen(function* () {
      const result = yield* execBeads(["ready", "--format=json"]);
      return parseIssueList(result.stdout);
    }),

    blocked: Effect.gen(function* () {
      const result = yield* execBeads(["blocked", "--format=json"]);
      return parseIssueList(result.stdout);
    }),

    stats: Effect.gen(function* () {
      const result = yield* execBeads(["stats", "--format=json"]);
      return parseStats(result.stdout);
    }),

    sync: Effect.gen(function* () {
      yield* execBeads(["sync"]);
    }),

    syncStatus: Effect.gen(function* () {
      const result = yield* execBeads(["sync", "--status", "--format=json"]);
      return parseSyncStatus(result.stdout);
    }),
  })
);

// Helper: Execute beads command
function execBeads(
  args: string[]
): Effect.Effect<
  { stdout: string; stderr: string; exitCode: number },
  BeadsExecutionError
> {
  return Effect.async<
    { stdout: string; stderr: string; exitCode: number },
    BeadsExecutionError
  >((resume) => {
    const proc = spawn("bd", args, {
      shell: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resume(Effect.succeed({ stdout, stderr, exitCode: code }));
      } else {
        resume(
          Effect.fail(
            new BeadsExecutionError(
              `Beads command failed with exit code ${code}`,
              code ?? undefined,
              stderr
            )
          )
        );
      }
    });

    proc.on("error", (err) => {
      resume(
        Effect.fail(new BeadsExecutionError(`Failed to spawn beads: ${err.message}`))
      );
    });
  });
}

// Parsers
function parseIssue(json: string): BeadsIssue {
  const raw = JSON.parse(json);
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    status: raw.status,
    type: raw.type,
    priority: raw.priority ?? 2,
    assignee: raw.assignee,
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
    blockedBy: raw.blocked_by,
    blocks: raw.blocks,
    dependsOn: raw.depends_on,
  };
}

function parseIssueList(json: string): BeadsIssue[] {
  const raw = JSON.parse(json);
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map(parseIssue);
}

function parseStats(json: string): BeadsStats {
  const raw = JSON.parse(json);
  return {
    total: raw.total ?? 0,
    open: raw.open ?? 0,
    inProgress: raw.in_progress ?? 0,
    closed: raw.closed ?? 0,
    blocked: raw.blocked ?? 0,
  };
}

function parseSyncStatus(json: string): {
  synced: boolean;
  ahead: number;
  behind: number;
} {
  const raw = JSON.parse(json);
  return {
    synced: raw.synced ?? false,
    ahead: raw.ahead ?? 0,
    behind: raw.behind ?? 0,
  };
}
