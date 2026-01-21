/**
 * LinearService - Effect service for Linear API operations
 * Provides typed interface to Linear issue tracking
 */

import { Context, Effect, Layer } from "effect";

// Error types
export class LinearNotConfiguredError {
  readonly _tag = "LinearNotConfiguredError";
  constructor(readonly message: string = "Linear API key not configured") {}
}

export class LinearApiError {
  readonly _tag = "LinearApiError";
  constructor(
    readonly message: string,
    readonly statusCode?: number,
    readonly response?: unknown
  ) {}
}

// Domain types
export interface LinearIssue {
  id: string;
  identifier: string; // e.g., "LIN-123"
  title: string;
  description?: string;
  state: {
    id: string;
    name: string;
    type: "backlog" | "unstarted" | "started" | "completed" | "canceled";
  };
  priority: number; // 0-4
  assignee?: {
    id: string;
    name: string;
    email: string;
  };
  team: {
    id: string;
    name: string;
    key: string;
  };
  project?: {
    id: string;
    name: string;
  };
  labels: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
  url: string;
}

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
  description?: string;
}

export interface LinearProject {
  id: string;
  name: string;
  description?: string;
  state: string;
  team: {
    id: string;
    name: string;
  };
}

export interface LinearWorkflowState {
  id: string;
  name: string;
  type: "backlog" | "unstarted" | "started" | "completed" | "canceled";
  color: string;
  position: number;
}

export interface LinearCreateIssueOptions {
  teamId: string;
  title: string;
  description?: string;
  priority?: number;
  assigneeId?: string;
  projectId?: string;
  stateId?: string;
  labelIds?: string[];
}

export interface LinearUpdateIssueOptions {
  title?: string;
  description?: string;
  priority?: number;
  assigneeId?: string;
  projectId?: string;
  stateId?: string;
  labelIds?: string[];
}

export interface LinearListIssuesOptions {
  teamId?: string;
  projectId?: string;
  assigneeId?: string;
  stateType?: "backlog" | "unstarted" | "started" | "completed" | "canceled";
  limit?: number;
}

export interface LinearConfig {
  apiKey: string;
  teamId?: string;
}

// Service interface
export interface LinearService {
  /**
   * Check if Linear is configured
   */
  readonly checkConfigured: Effect.Effect<boolean, never>;

  /**
   * List teams in workspace
   */
  readonly listTeams: Effect.Effect<LinearTeam[], LinearApiError>;

  /**
   * Get team by ID or key
   */
  readonly getTeam: (
    idOrKey: string
  ) => Effect.Effect<LinearTeam, LinearApiError | LinearNotConfiguredError>;

  /**
   * List workflow states for a team
   */
  readonly listWorkflowStates: (
    teamId: string
  ) => Effect.Effect<LinearWorkflowState[], LinearApiError>;

  /**
   * List projects
   */
  readonly listProjects: (
    teamId?: string
  ) => Effect.Effect<LinearProject[], LinearApiError>;

  /**
   * List issues with filters
   */
  readonly listIssues: (
    options?: LinearListIssuesOptions
  ) => Effect.Effect<LinearIssue[], LinearApiError>;

  /**
   * Get issue by ID or identifier
   */
  readonly getIssue: (
    idOrIdentifier: string
  ) => Effect.Effect<LinearIssue, LinearApiError | LinearNotConfiguredError>;

  /**
   * Create a new issue
   */
  readonly createIssue: (
    options: LinearCreateIssueOptions
  ) => Effect.Effect<LinearIssue, LinearApiError>;

  /**
   * Update an existing issue
   */
  readonly updateIssue: (
    id: string,
    options: LinearUpdateIssueOptions
  ) => Effect.Effect<LinearIssue, LinearApiError>;
}

export const LinearService = Context.GenericTag<LinearService>(
  "@clive/LinearService"
);

// Implementation
export const makeLinearServiceLive = (config: LinearConfig) =>
  Layer.succeed(
    LinearService,
    LinearService.of({
      checkConfigured: Effect.succeed(!!config.apiKey),

      listTeams: Effect.gen(function* () {
        const query = `
          query {
            teams {
              nodes {
                id
                name
                key
                description
              }
            }
          }
        `;

        const response = yield* executeGraphQL<{
          teams: { nodes: LinearTeam[] };
        }>(config.apiKey, query);

        return response.teams.nodes;
      }),

      getTeam: (idOrKey) =>
        Effect.gen(function* () {
          const query = `
            query($id: String!) {
              team(id: $id) {
                id
                name
                key
                description
              }
            }
          `;

          const response = yield* executeGraphQL<{ team: LinearTeam }>(
            config.apiKey,
            query,
            { id: idOrKey }
          );

          return response.team;
        }),

      listWorkflowStates: (teamId) =>
        Effect.gen(function* () {
          const query = `
            query($teamId: String!) {
              team(id: $teamId) {
                states {
                  nodes {
                    id
                    name
                    type
                    color
                    position
                  }
                }
              }
            }
          `;

          const response = yield* executeGraphQL<{
            team: { states: { nodes: LinearWorkflowState[] } };
          }>(config.apiKey, query, { teamId });

          return response.team.states.nodes;
        }),

      listProjects: (teamId) =>
        Effect.gen(function* () {
          const query = teamId
            ? `
            query($teamId: String!) {
              projects(filter: { team: { id: { eq: $teamId } } }) {
                nodes {
                  id
                  name
                  description
                  state
                  team {
                    id
                    name
                  }
                }
              }
            }
          `
            : `
            query {
              projects {
                nodes {
                  id
                  name
                  description
                  state
                  team {
                    id
                    name
                  }
                }
              }
            }
          `;

          const response = yield* executeGraphQL<{
            projects: { nodes: LinearProject[] };
          }>(config.apiKey, query, teamId ? { teamId } : undefined);

          return response.projects.nodes;
        }),

      listIssues: (options) =>
        Effect.gen(function* () {
          const filters: string[] = [];
          const variables: Record<string, unknown> = {};

          if (options?.teamId) {
            filters.push('team: { id: { eq: $teamId } }');
            variables.teamId = options.teamId;
          }
          if (options?.projectId) {
            filters.push('project: { id: { eq: $projectId } }');
            variables.projectId = options.projectId;
          }
          if (options?.assigneeId) {
            filters.push('assignee: { id: { eq: $assigneeId } }');
            variables.assigneeId = options.assigneeId;
          }
          if (options?.stateType) {
            filters.push('state: { type: { eq: $stateType } }');
            variables.stateType = options.stateType;
          }

          const filterString =
            filters.length > 0 ? `filter: { ${filters.join(', ')} }` : '';
          const limit = options?.limit ?? 50;

          const query = `
            query${Object.keys(variables).length > 0 ? `(${Object.keys(variables).map(k => `$${k}: String!`).join(', ')})` : ''} {
              issues(${filterString} first: ${limit}) {
                nodes {
                  id
                  identifier
                  title
                  description
                  priority
                  state {
                    id
                    name
                    type
                  }
                  assignee {
                    id
                    name
                    email
                  }
                  team {
                    id
                    name
                    key
                  }
                  project {
                    id
                    name
                  }
                  labels {
                    nodes {
                      id
                      name
                      color
                    }
                  }
                  createdAt
                  updatedAt
                  url
                }
              }
            }
          `;

          const response = yield* executeGraphQL<{
            issues: { nodes: Array<unknown> };
          }>(
            config.apiKey,
            query,
            Object.keys(variables).length > 0 ? variables : undefined
          );

          return response.issues.nodes.map(parseLinearIssue);
        }),

      getIssue: (idOrIdentifier) =>
        Effect.gen(function* () {
          const query = `
            query($id: String!) {
              issue(id: $id) {
                id
                identifier
                title
                description
                priority
                state {
                  id
                  name
                  type
                }
                assignee {
                  id
                  name
                  email
                }
                team {
                  id
                  name
                  key
                }
                project {
                  id
                  name
                }
                labels {
                  nodes {
                    id
                    name
                    color
                  }
                }
                createdAt
                updatedAt
                url
              }
            }
          `;

          const response = yield* executeGraphQL<{ issue: unknown }>(
            config.apiKey,
            query,
            { id: idOrIdentifier }
          );

          return parseLinearIssue(response.issue);
        }),

      createIssue: (options) =>
        Effect.gen(function* () {
          const mutation = `
            mutation($input: IssueCreateInput!) {
              issueCreate(input: $input) {
                success
                issue {
                  id
                  identifier
                  title
                  description
                  priority
                  state {
                    id
                    name
                    type
                  }
                  assignee {
                    id
                    name
                    email
                  }
                  team {
                    id
                    name
                    key
                  }
                  project {
                    id
                    name
                  }
                  labels {
                    nodes {
                      id
                      name
                      color
                    }
                  }
                  createdAt
                  updatedAt
                  url
                }
              }
            }
          `;

          const input: Record<string, unknown> = {
            teamId: options.teamId,
            title: options.title,
          };

          if (options.description) input.description = options.description;
          if (options.priority !== undefined) input.priority = options.priority;
          if (options.assigneeId) input.assigneeId = options.assigneeId;
          if (options.projectId) input.projectId = options.projectId;
          if (options.stateId) input.stateId = options.stateId;
          if (options.labelIds) input.labelIds = options.labelIds;

          const response = yield* executeGraphQL<{
            issueCreate: { success: boolean; issue: unknown };
          }>(config.apiKey, mutation, { input });

          if (!response.issueCreate.success) {
            return yield* Effect.fail(
              new LinearApiError("Failed to create issue")
            );
          }

          return parseLinearIssue(response.issueCreate.issue);
        }),

      updateIssue: (id, options) =>
        Effect.gen(function* () {
          const mutation = `
            mutation($id: String!, $input: IssueUpdateInput!) {
              issueUpdate(id: $id, input: $input) {
                success
                issue {
                  id
                  identifier
                  title
                  description
                  priority
                  state {
                    id
                    name
                    type
                  }
                  assignee {
                    id
                    name
                    email
                  }
                  team {
                    id
                    name
                    key
                  }
                  project {
                    id
                    name
                  }
                  labels {
                    nodes {
                      id
                      name
                      color
                    }
                  }
                  createdAt
                  updatedAt
                  url
                }
              }
            }
          `;

          const input: Record<string, unknown> = {};

          if (options.title) input.title = options.title;
          if (options.description !== undefined)
            input.description = options.description;
          if (options.priority !== undefined) input.priority = options.priority;
          if (options.assigneeId !== undefined)
            input.assigneeId = options.assigneeId;
          if (options.projectId !== undefined)
            input.projectId = options.projectId;
          if (options.stateId !== undefined) input.stateId = options.stateId;
          if (options.labelIds !== undefined) input.labelIds = options.labelIds;

          const response = yield* executeGraphQL<{
            issueUpdate: { success: boolean; issue: unknown };
          }>(config.apiKey, mutation, { id, input });

          if (!response.issueUpdate.success) {
            return yield* Effect.fail(
              new LinearApiError("Failed to update issue")
            );
          }

          return parseLinearIssue(response.issueUpdate.issue);
        }),
    })
  );

// Helper: Execute GraphQL query
function executeGraphQL<T>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>
): Effect.Effect<T, LinearApiError> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: apiKey,
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        throw new LinearApiError(
          `Linear API request failed: ${response.statusText}`,
          response.status
        );
      }

      const json = await response.json() as {
        data?: T;
        errors?: Array<{ message: string; [key: string]: unknown }>;
      };

      if (json.errors) {
        throw new LinearApiError(
          `Linear API errors: ${JSON.stringify(json.errors)}`,
          undefined,
          json.errors
        );
      }

      return json.data as T;
    },
    catch: (error) => {
      if (error instanceof LinearApiError) {
        return error;
      }
      return new LinearApiError(
        `Linear API request failed: ${error}`,
        undefined,
        error
      );
    },
  });
}

// Parser
function parseLinearIssue(raw: any): LinearIssue {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    description: raw.description,
    state: {
      id: raw.state.id,
      name: raw.state.name,
      type: raw.state.type,
    },
    priority: raw.priority ?? 0,
    assignee: raw.assignee
      ? {
          id: raw.assignee.id,
          name: raw.assignee.name,
          email: raw.assignee.email,
        }
      : undefined,
    team: {
      id: raw.team.id,
      name: raw.team.name,
      key: raw.team.key,
    },
    project: raw.project
      ? {
          id: raw.project.id,
          name: raw.project.name,
        }
      : undefined,
    labels: (raw.labels?.nodes ?? []).map((label: any) => ({
      id: label.id,
      name: label.name,
      color: label.color,
    })),
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
    url: raw.url,
  };
}
