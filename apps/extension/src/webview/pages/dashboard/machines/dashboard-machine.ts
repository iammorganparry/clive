import { assign, setup } from "xstate";
import type { BranchChangesData } from "../components/branch-changes.js";

export interface DashboardContext {
  branchChanges: BranchChangesData | null;
}

export type DashboardEvent = {
  type: "DATA_LOADED";
  branchChanges: BranchChangesData | null;
};

export interface DashboardInput {
  branchChanges: BranchChangesData | null;
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
  }),
  states: {
    loading: {
      on: {
        DATA_LOADED: {
          target: "ready",
          actions: assign({
            branchChanges: ({ event }) => event.branchChanges,
          }),
        },
      },
    },
    ready: {
      on: {
        DATA_LOADED: {
          actions: assign({
            branchChanges: ({ event }) => event.branchChanges,
          }),
        },
      },
    },
  },
});

export type DashboardMachine = typeof dashboardMachine;
