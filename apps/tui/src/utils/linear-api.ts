/**
 * Linear API utilities
 * Shared functions for interacting with the Linear API
 */

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

interface LinearGraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface TeamsResponse {
  teams: {
    nodes: LinearTeam[];
  };
}

interface TeamResponse {
  team: LinearTeam | null;
}

/**
 * Fetch teams from Linear API
 */
export async function fetchLinearTeams(apiKey: string): Promise<LinearTeam[]> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({
      query: `
        query {
          teams {
            nodes {
              id
              name
              key
            }
          }
        }
      `,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch teams: ${response.statusText}`);
  }

  const data = (await response.json()) as LinearGraphQLResponse<TeamsResponse>;

  if (data.errors) {
    throw new Error(data.errors[0]?.message || "Failed to fetch teams");
  }

  return data.data?.teams.nodes ?? [];
}

/**
 * Validate Linear API credentials by fetching the team
 */
export async function validateLinearConfig(
  apiKey: string,
  teamID: string,
): Promise<void> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({
      query: `
        query($teamId: String!) {
          team(id: $teamId) {
            id
            name
          }
        }
      `,
      variables: { teamId: teamID },
    }),
  });

  if (!response.ok) {
    throw new Error(`Validation failed: ${response.statusText}`);
  }

  const data = (await response.json()) as LinearGraphQLResponse<TeamResponse>;

  if (data.errors) {
    throw new Error(data.errors[0]?.message || "Invalid team ID");
  }

  if (!data.data?.team) {
    throw new Error("Team not found");
  }
}

/**
 * Get team details by ID
 */
export async function getLinearTeam(
  apiKey: string,
  teamID: string,
): Promise<LinearTeam | null> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({
      query: `
        query($teamId: String!) {
          team(id: $teamId) {
            id
            name
            key
          }
        }
      `,
      variables: { teamId: teamID },
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as LinearGraphQLResponse<TeamResponse>;

  if (data.errors || !data.data?.team) {
    return null;
  }

  return data.data.team;
}

/**
 * Mask an API key for display (show first 8 chars, mask the rest)
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 12) {
    return apiKey.slice(0, 4) + "..." + apiKey.slice(-4);
  }
  return apiKey.slice(0, 8) + "..." + apiKey.slice(-4);
}
