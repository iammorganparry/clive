import { setup, assign } from "xstate";
import type { BranchChangesData } from "../components/branch-changes.js";

interface CypressStatusData {
  overallStatus: "installed" | "not_installed" | "partial";
  packages: Array<{
    name: string;
    path: string;
    relativePath: string;
    hasCypressPackage: boolean;
    hasCypressConfig: boolean;
    isConfigured: boolean;
  }>;
  workspaceRoot: string;
}

export interface DashboardContext {
  branchChanges: BranchChangesData | null;
  cypressStatus: CypressStatusData | null;
}

export type DashboardEvent = {
  type: "DATA_LOADED";
  branchChanges: BranchChangesData | null;
  cypressStatus: CypressStatusData | null;
};

export interface DashboardInput {
  branchChanges: BranchChangesData | null;
  cypressStatus: CypressStatusData | null;
}

export const dashboardMachine = setup({
  types: {
    context: {} as DashboardContext,
    events: {} as DashboardEvent,
    input: {} as DashboardInput,
  },
}).createMachine({
  id: "dashboard",
  initial: "loading",
  context: ({ input }): DashboardContext => ({
    branchChanges: input.branchChanges ?? null,
    cypressStatus: input.cypressStatus ?? null,
  }),
  states: {
    loading: {
      on: {
        DATA_LOADED: {
          target: "ready",
          actions: assign({
            branchChanges: ({ event }) => event.branchChanges,
            cypressStatus: ({ event }) => event.cypressStatus,
          }),
        },
      },
    },
    ready: {
      on: {
        DATA_LOADED: {
          actions: assign({
            branchChanges: ({ event }) => event.branchChanges,
            cypressStatus: ({ event }) => event.cypressStatus,
          }),
        },
      },
    },
  },
});

export type DashboardMachine = typeof dashboardMachine;
