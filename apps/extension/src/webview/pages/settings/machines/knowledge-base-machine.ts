import { setup, assign, fromPromise } from "xstate";
import type {
  KnowledgeBaseStatus,
  KnowledgeBasePhase,
} from "../../../../services/knowledge-base-types.js";
import type { VSCodeAPI } from "../../../services/vscode.js";
import {
  createRegenerateKnowledgeBaseActor,
  createResumeKnowledgeBaseActor,
} from "../actors/regenerate-knowledge-base-actor.js";

/**
 * Error types for knowledge base operations
 */
export type ErrorType =
  | "auth_required" // User not logged in
  | "session_expired" // Token expired
  | "network_error" // API unreachable
  | "generation_failed" // Analysis failed
  | "unknown"; // Catch-all

/**
 * Context for knowledge base machine
 */
export interface KnowledgeBaseContext {
  fetchStatus: () => Promise<KnowledgeBaseStatus>;
  regenerate: () => Promise<{ success: boolean; error?: string }>;
  vscode: VSCodeAPI;
  onPhaseComplete?: () => void;
  status: KnowledgeBaseStatus | null;
  errorType: ErrorType | null;
  errorMessage: string | null;
  error: string | null;
  phases: KnowledgeBasePhase[];
  logs: string[];
}

/**
 * Events for knowledge base machine
 */
export type KnowledgeBaseEvent =
  | { type: "LOAD" }
  | { type: "STATUS_LOADED"; status: KnowledgeBaseStatus }
  | { type: "STATUS_ERROR"; errorType: ErrorType; message: string }
  | { type: "REGENERATE" }
  | { type: "REGENERATE_WITH_PROGRESS" }
  | { type: "RESUME" }
  | { type: "RESUME_WITH_PROGRESS" }
  | { type: "PROGRESS"; message: string }
  | { type: "PHASE_STARTED"; phaseId: number; phaseName: string }
  | { type: "CATEGORY_COMPLETE"; category: string; entryCount: number }
  | { type: "PHASE_COMPLETE"; phaseId: number; totalEntries: number }
  | { type: "GENERATION_STARTED" }
  | { type: "GENERATION_COMPLETE"; status: KnowledgeBaseStatus }
  | { type: "GENERATION_ERROR"; errorType: ErrorType; message: string }
  | { type: "SUBSCRIPTION_COMPLETE" }
  | { type: "SUBSCRIPTION_ERROR"; error: string }
  | { type: "RETRY" }
  | { type: "DISMISS" }
  | { type: "CANCEL" };

/**
 * Input for knowledge base machine
 */
export interface KnowledgeBaseInput {
  fetchStatus: () => Promise<KnowledgeBaseStatus>;
  regenerate: () => Promise<{ success: boolean; error?: string }>;
  vscode: VSCodeAPI;
  onPhaseComplete?: () => void;
}

/**
 * Helper to categorize errors from RPC responses
 */
function categorizeError(error: unknown): {
  errorType: ErrorType;
  message: string;
} {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (
    errorMessage.includes("Authentication required") ||
    errorMessage.includes("not logged in")
  ) {
    return {
      errorType: "auth_required",
      message: errorMessage,
    };
  }

  if (
    errorMessage.includes("Invalid token") ||
    errorMessage.includes("expired") ||
    errorMessage.includes("Session expired")
  ) {
    return {
      errorType: "session_expired",
      message: errorMessage,
    };
  }

  if (
    errorMessage.includes("Network") ||
    errorMessage.includes("fetch") ||
    errorMessage.includes("Failed to fetch")
  ) {
    return {
      errorType: "network_error",
      message: errorMessage,
    };
  }

  if (
    errorMessage.includes("Analysis failed") ||
    errorMessage.includes("Generation failed")
  ) {
    return {
      errorType: "generation_failed",
      message: errorMessage,
    };
  }

  return {
    errorType: "unknown",
    message: errorMessage,
  };
}

/**
 * Actor that fetches knowledge base status
 */
const createFetchStatusActor = fromPromise<
  KnowledgeBaseStatus,
  { fetchStatus: () => Promise<KnowledgeBaseStatus> }
>(async ({ input }) => {
  return await input.fetchStatus();
});

/**
 * Actor that triggers knowledge base regeneration
 */
const createRegenerateActor = fromPromise<
  { success: boolean; error?: string },
  { regenerate: () => Promise<{ success: boolean; error?: string }> }
>(async ({ input }) => {
  return await input.regenerate();
});

/**
 * Knowledge base state machine
 */
export const knowledgeBaseMachine = setup({
  types: {
    context: {} as KnowledgeBaseContext,
    events: {} as KnowledgeBaseEvent,
    input: {} as KnowledgeBaseInput,
  },
  actors: {
    fetchStatus: createFetchStatusActor,
    regenerate: createRegenerateActor,
    regenerateKnowledgeBase: createRegenerateKnowledgeBaseActor,
    resumeKnowledgeBase: createResumeKnowledgeBaseActor,
  },
  actions: {
    setStatus: assign(({ event }) => {
      if (event.type !== "STATUS_LOADED") return {};
      return {
        status: event.status,
        errorType: null,
        errorMessage: null,
      };
    }),
    setStatusError: assign(({ event }) => {
      if (event.type !== "STATUS_ERROR") return {};
      return {
        errorType: event.errorType,
        errorMessage: event.message,
        status: null,
      };
    }),
    setGenerationError: assign(({ event }) => {
      if (event.type !== "GENERATION_ERROR") return {};
      return {
        errorType: event.errorType,
        errorMessage: event.message,
      };
    }),
    clearError: assign({
      errorType: () => null,
      errorMessage: () => null,
    }),
    setError: assign(({ event }) => {
      if (event.type !== "SUBSCRIPTION_ERROR") return {};
      return { error: event.error };
    }),
    addLog: assign(({ context, event }) => {
      if (event.type !== "PROGRESS") return {};
      return {
        logs: [...context.logs, event.message],
      };
    }),
    setPhaseStarted: assign(({ context, event }) => {
      if (event.type !== "PHASE_STARTED") return {};
      const phases = context.phases.map((phase) =>
        phase.id === event.phaseId
          ? { ...phase, status: "in_progress" as const }
          : phase,
      );
      return {
        phases,
        logs: [...context.logs, `Started phase: ${event.phaseName}`],
      };
    }),
    setCategoryComplete: assign(({ context, event }) => {
      if (event.type !== "CATEGORY_COMPLETE") return {};
      const phases = context.phases
        .map((phase) => {
          if (phase.categories.includes(event.category)) {
            const categoryEntries = {
              ...phase.categoryEntries,
              [event.category]: event.entryCount,
            };
            return { ...phase, categoryEntries };
          }
          return phase;
        })
        // filter out duplicate phases
        .filter((phase) => phase.categories.includes(event.category));
      return {
        phases,
        logs: [
          ...context.logs,
          `${event.category} analysis complete - ${event.entryCount} entries`,
        ],
      };
    }),
    setPhaseComplete: assign(({ context, event }) => {
      if (event.type !== "PHASE_COMPLETE") return {};
      const phases = context.phases.map((phase) =>
        phase.id === event.phaseId
          ? { ...phase, status: "completed" as const }
          : phase,
      );
      return {
        phases,
        logs: [
          ...context.logs,
          `Phase ${event.phaseId} complete - ${event.totalEntries} total entries`,
        ],
      };
    }),
    resetPhases: assign(({ context }) => ({
      phases: context.phases.map((phase) => ({
        ...phase,
        status: "pending" as const,
        categoryEntries: {},
      })),
      logs: [],
    })),
  },
  guards: {
    hasKnowledge: ({ context }) => {
      return context.status?.hasKnowledge ?? false;
    },
  },
}).createMachine({
  id: "knowledgeBase",
  initial: "loading",
  context: ({ input }) => ({
    fetchStatus: input.fetchStatus,
    regenerate: input.regenerate,
    vscode: input.vscode,
    status: null,
    errorType: null,
    errorMessage: null,
    error: null,
    phases: [
      {
        id: 1,
        name: "Framework Discovery",
        description: "Discover testing frameworks and patterns",
        categories: ["framework", "patterns"],
        status: "pending",
        categoryEntries: {},
      },
      {
        id: 2,
        name: "Core Infrastructure",
        description: "Analyze mocks, fixtures, and hooks",
        categories: ["mocks", "fixtures", "hooks"],
        status: "pending",
        categoryEntries: {},
      },
      {
        id: 3,
        name: "Test Details",
        description: "Analyze selectors, routes, assertions, and utilities",
        categories: [
          "selectors",
          "routes",
          "assertions",
          "utilities",
          "coverage",
        ],
        status: "pending",
        categoryEntries: {},
      },
      {
        id: 4,
        name: "Analysis",
        description: "Identify gaps and improvements",
        categories: ["gaps", "improvements"],
        status: "pending",
        categoryEntries: {},
      },
    ],
    logs: [],
  }),
  states: {
    loading: {
      entry: "clearError",
      invoke: {
        id: "fetchStatus",
        src: "fetchStatus",
        input: ({ context }) => ({ fetchStatus: context.fetchStatus }),
        onDone: {
          target: "checkingStatus",
          actions: assign({
            status: ({ event }) => event.output,
            errorType: () => null,
            errorMessage: () => null,
          }),
        },
        onError: {
          target: "error",
          actions: assign(({ event }) => {
            const { errorType, message } = categorizeError(event.error);
            return {
              errorType,
              errorMessage: message,
              status: null,
            };
          }),
        },
      },
    },
    checkingStatus: {
      always: [
        {
          guard: "hasKnowledge",
          target: "generated",
        },
        {
          target: "idle",
        },
      ],
    },
    idle: {
      on: {
        REGENERATE: {
          target: "generating",
          actions: "clearError",
        },
        REGENERATE_WITH_PROGRESS: {
          target: "generatingWithProgress",
          actions: ["clearError", "resetPhases"],
        },
        RESUME: {
          target: "generating",
          actions: "clearError",
        },
        RESUME_WITH_PROGRESS: {
          target: "resumingWithProgress",
          actions: ["clearError", "resetPhases"],
        },
        LOAD: {
          target: "loading",
        },
      },
    },
    generatingWithProgress: {
      entry: "clearError",
      invoke: {
        id: "regenerateKnowledgeBase",
        src: "regenerateKnowledgeBase",
        input: ({ context }) => ({
          vscode: context.vscode,
          onPhaseComplete: context.onPhaseComplete,
        }),
      },
      on: {
        PROGRESS: {
          actions: "addLog",
        },
        PHASE_STARTED: {
          actions: "setPhaseStarted",
        },
        CATEGORY_COMPLETE: {
          actions: "setCategoryComplete",
        },
        PHASE_COMPLETE: {
          actions: "setPhaseComplete",
        },
        SUBSCRIPTION_COMPLETE: {
          target: "polling",
          actions: assign({
            errorType: () => null,
            errorMessage: () => null,
          }),
        },
        SUBSCRIPTION_ERROR: {
          target: "error",
          actions: "setError",
        },
        CANCEL: {
          target: "idle",
        },
      },
    },
    resumingWithProgress: {
      entry: "clearError",
      invoke: {
        id: "resumeKnowledgeBase",
        src: "resumeKnowledgeBase",
        input: ({ context }) => ({
          vscode: context.vscode,
          onPhaseComplete: context.onPhaseComplete,
        }),
      },
      on: {
        PROGRESS: {
          actions: "addLog",
        },
        PHASE_STARTED: {
          actions: "setPhaseStarted",
        },
        CATEGORY_COMPLETE: {
          actions: "setCategoryComplete",
        },
        PHASE_COMPLETE: {
          actions: "setPhaseComplete",
        },
        SUBSCRIPTION_COMPLETE: {
          target: "polling",
          actions: assign({
            errorType: () => null,
            errorMessage: () => null,
          }),
        },
        SUBSCRIPTION_ERROR: {
          target: "error",
          actions: "setError",
        },
        CANCEL: {
          target: "idle",
        },
      },
    },
    generating: {
      entry: "clearError",
      invoke: {
        id: "regenerate",
        src: "regenerate",
        input: ({ context }) => ({ regenerate: context.regenerate }),
        onDone: [
          {
            guard: ({ event }) => event.output.success === false,
            target: "error",
            actions: assign(({ event }) => {
              const { errorType, message } = categorizeError(
                event.output.error || "Generation failed",
              );
              return {
                errorType,
                errorMessage: message,
              };
            }),
          },
          {
            target: "polling",
            actions: assign({
              errorType: () => null,
              errorMessage: () => null,
            }),
          },
        ],
        onError: {
          target: "error",
          actions: assign(({ event }) => {
            const { errorType, message } = categorizeError(event.error);
            return {
              errorType,
              errorMessage: message,
            };
          }),
        },
      },
      on: {
        CANCEL: {
          target: "idle",
        },
      },
    },
    polling: {
      // Poll status every 2 seconds while generating
      after: {
        2000: {
          target: "checkingGenerationStatus",
        },
      },
      on: {
        CANCEL: {
          target: "idle",
        },
      },
    },
    checkingGenerationStatus: {
      invoke: {
        id: "fetchStatus",
        src: "fetchStatus",
        input: ({ context }) => ({ fetchStatus: context.fetchStatus }),
        onDone: [
          {
            guard: ({ event }) => event.output.hasKnowledge === true,
            target: "generated",
            actions: assign({
              status: ({ event }) => event.output,
              errorType: () => null,
              errorMessage: () => null,
            }),
          },
          {
            // Still generating, continue polling
            target: "polling",
          },
        ],
        onError: {
          // On error during polling, continue polling (might be transient)
          target: "polling",
        },
      },
    },
    generated: {
      on: {
        REGENERATE: {
          target: "generating",
          actions: "clearError",
        },
        REGENERATE_WITH_PROGRESS: {
          target: "generatingWithProgress",
          actions: ["clearError", "resetPhases"],
        },
        RESUME: {
          target: "generating",
          actions: "clearError",
        },
        RESUME_WITH_PROGRESS: {
          target: "resumingWithProgress",
          actions: ["clearError", "resetPhases"],
        },
        LOAD: {
          target: "loading",
        },
      },
    },
    error: {
      on: {
        RETRY: {
          target: "generating",
          actions: "clearError",
        },
        DISMISS: {
          target: "idle",
          actions: "clearError",
        },
        LOAD: {
          target: "loading",
        },
      },
    },
  },
});

export type KnowledgeBaseMachine = typeof knowledgeBaseMachine;
