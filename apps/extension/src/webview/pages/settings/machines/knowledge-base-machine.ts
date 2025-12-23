import { setup, assign, fromPromise } from "xstate";
import type { KnowledgeBaseStatus } from "../../../../services/knowledge-base-types.js";

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
  status: KnowledgeBaseStatus | null;
  errorType: ErrorType | null;
  errorMessage: string | null;
}

/**
 * Events for knowledge base machine
 */
export type KnowledgeBaseEvent =
  | { type: "LOAD" }
  | { type: "STATUS_LOADED"; status: KnowledgeBaseStatus }
  | { type: "STATUS_ERROR"; errorType: ErrorType; message: string }
  | { type: "REGENERATE" }
  | { type: "GENERATION_STARTED" }
  | { type: "GENERATION_COMPLETE"; status: KnowledgeBaseStatus }
  | { type: "GENERATION_ERROR"; errorType: ErrorType; message: string }
  | { type: "RETRY" }
  | { type: "DISMISS" }
  | { type: "CANCEL" };

/**
 * Input for knowledge base machine
 */
export interface KnowledgeBaseInput {
  fetchStatus: () => Promise<KnowledgeBaseStatus>;
  regenerate: () => Promise<{ success: boolean; error?: string }>;
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
    status: null,
    errorType: null,
    errorMessage: null,
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
        LOAD: {
          target: "loading",
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
