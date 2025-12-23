import { setup, assign } from "xstate";
import type { ActorRefFrom } from "xstate";
import type { fileTestMachine } from "./file-test-machine.js";
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
  fileActors: Map<string, ActorRefFrom<typeof fileTestMachine>>;
  cypressStatus: CypressStatusData | null;
}

export type DashboardEvent =
  | {
      type: "DATA_LOADED";
      branchChanges: BranchChangesData | null;
      cypressStatus: CypressStatusData | null;
    }
  | {
      type: "SPAWN_FILE_ACTOR";
      filePath: string;
      actor: ActorRefFrom<typeof fileTestMachine>;
    }
  | { type: "REMOVE_FILE_ACTOR"; filePath: string };

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
    fileActors: new Map<string, ActorRefFrom<typeof fileTestMachine>>(),
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
        SPAWN_FILE_ACTOR: {
          actions: assign({
            fileActors: ({ context, event }) => {
              const next = new Map(context.fileActors);
              next.set(event.filePath, event.actor);
              return next;
            },
          }),
        },
        REMOVE_FILE_ACTOR: {
          actions: assign({
            fileActors: ({ context, event }) => {
              const next = new Map(context.fileActors);
              next.delete(event.filePath);
              return next;
            },
          }),
        },
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
