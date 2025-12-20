import type {
  RouterRecord,
  Procedure,
  InferProcedureInput,
  InferProcedureOutput,
} from "./types.js";

/**
 * Hook factory functions that create React hooks bound to a specific path
 */
export interface RpcHookFactories {
  useQuery: <TInput, TOutput>(
    path: string[],
    vscode: unknown,
  ) => (options?: { input?: TInput; enabled?: boolean }) => {
    data: TOutput | undefined;
    isLoading: boolean;
    error: Error | null;
    refetch: () => void;
  };

  useMutation: <TInput, TOutput>(
    path: string[],
    vscode: unknown,
  ) => (options?: {
    onSuccess?: (data: TOutput) => void;
    onError?: (error: Error) => void;
  }) => {
    mutate: (input: TInput) => void;
    mutateAsync: (input: TInput) => Promise<TOutput>;
    isPending: boolean;
    error: Error | null;
  };

  useSubscription: <TInput, TOutput, TProgress = unknown>(
    path: string[],
    vscode: unknown,
  ) => (options?: {
    input?: TInput;
    onData?: (data: TProgress) => void;
    onComplete?: (data: TOutput) => void;
    onError?: (error: Error) => void;
    enabled?: boolean;
  }) => {
    subscribe: (input?: TInput) => void;
    data: TOutput | undefined;
    progressData: TProgress | undefined;
    status: "idle" | "subscribing" | "active" | "complete" | "error";
    error: Error | null;
    isLoading: boolean;
    unsubscribe: () => void;
  };
}

/**
 * Type-safe RPC client
 */
export type WebviewRpcClient<TRouter extends RouterRecord> = {
  [K in keyof TRouter]: TRouter[K] extends Procedure<
    unknown,
    unknown,
    unknown,
    "query" | "mutation" | "subscription"
  >
    ? ClientProcedure<TRouter[K]>
    : TRouter[K] extends RouterRecord
      ? WebviewRpcClient<TRouter[K]>
      : never;
};

export interface ClientProcedure<
  TProcedure extends Procedure<
    unknown,
    unknown,
    unknown,
    "query" | "mutation" | "subscription"
  >,
> {
  useQuery: (options?: {
    input?: InferProcedureInput<TProcedure>;
    enabled?: boolean;
  }) => {
    data: InferProcedureOutput<TProcedure> | undefined;
    isLoading: boolean;
    error: Error | null;
    refetch: () => void;
  };

  useMutation: (options?: {
    onSuccess?: (data: InferProcedureOutput<TProcedure>) => void;
    onError?: (error: Error) => void;
  }) => {
    mutate: (input: InferProcedureInput<TProcedure>) => void;
    mutateAsync: (
      input: InferProcedureInput<TProcedure>,
    ) => Promise<InferProcedureOutput<TProcedure>>;
    isPending: boolean;
    error: Error | null;
  };

  useSubscription: (options?: {
    input?: InferProcedureInput<TProcedure>;
    onData?: (data: unknown) => void;
    onComplete?: (data: InferProcedureOutput<TProcedure>) => void;
    onError?: (error: Error) => void;
    enabled?: boolean;
  }) => {
    subscribe: (input?: InferProcedureInput<TProcedure>) => void;
    data: InferProcedureOutput<TProcedure> | undefined;
    progressData: unknown;
    status: "idle" | "subscribing" | "active" | "complete" | "error";
    error: Error | null;
    isLoading: boolean;
    unsubscribe: () => void;
  };
}

/**
 * Create a type-safe RPC client from a router
 */
export function createRpcClient<TRouter extends RouterRecord>(
  router: TRouter,
  vscode: unknown,
  hookFactories: RpcHookFactories,
): WebviewRpcClient<TRouter> {
  return createClientProxy(
    router,
    vscode,
    hookFactories,
    [],
  ) as WebviewRpcClient<TRouter>;
}

/**
 * @deprecated Use createRpcClient instead
 */
export const createClient = createRpcClient;

function createClientProxy(
  router: RouterRecord,
  vscode: unknown,
  hookFactories: RpcHookFactories,
  path: string[],
): unknown {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string) {
      const value = router[prop];

      // If it's a procedure, return client procedure methods
      if (value && typeof value === "object" && "_def" in value) {
        const procedure = value as Procedure<
          unknown,
          unknown,
          unknown,
          "query" | "mutation" | "subscription"
        >;
        const currentPath = [...path, prop];

        // Create bound hook functions
        const createQueryHook = hookFactories.useQuery(currentPath, vscode) as <
          TInput,
          TOutput,
        >(options?: {
          input?: TInput;
          enabled?: boolean;
        }) => {
          data: TOutput | undefined;
          isLoading: boolean;
          error: Error | null;
          refetch: () => void;
        };

        const createMutationHook = hookFactories.useMutation(
          currentPath,
          vscode,
        ) as <TInput, TOutput>(options?: {
          onSuccess?: (data: TOutput) => void;
          onError?: (error: Error) => void;
        }) => {
          mutate: (input: TInput) => void;
          mutateAsync: (input: TInput) => Promise<TOutput>;
          isPending: boolean;
          error: Error | null;
        };

        const createSubscriptionHook = hookFactories.useSubscription(
          currentPath,
          vscode,
        ) as <TInput, TOutput, TProgress = unknown>(options?: {
          input?: TInput;
          onData?: (data: TProgress) => void;
          onComplete?: (data: TOutput) => void;
          onError?: (error: Error) => void;
          enabled?: boolean;
        }) => {
          subscribe: (input?: TInput) => void;
          data: TOutput | undefined;
          progressData: TProgress | undefined;
          status: "idle" | "subscribing" | "active" | "complete" | "error";
          error: Error | null;
          isLoading: boolean;
          unsubscribe: () => void;
        };

        return {
          useQuery: createQueryHook,
          useMutation: createMutationHook,
          useSubscription: createSubscriptionHook,
        };
      }

      // If it's a nested router, recurse
      if (value && typeof value === "object") {
        return createClientProxy(value as RouterRecord, vscode, hookFactories, [
          ...path,
          prop,
        ]);
      }

      return undefined;
    },
  });
}
