/**
 * Type utilities for webview RPC
 */

export type Procedure<
  TInput,
  TOutput,
  TContext,
  TType extends "query" | "mutation" | "subscription",
> = {
  _def: {
    /**
     * The input type for client-side type inference.
     * At runtime, this is actually a Zod schema - use ZodSchema type for runtime access.
     */
    input: TInput;
    output: TOutput;
    context: TContext;
    type: TType;
    handler?: unknown;
  };
};

/**
 * Zod schema type for runtime validation.
 * Use this when you need to call safeParse() on the input.
 */
export interface ZodSchema {
  safeParse(
    data: unknown,
  ):
    | { success: true; data: unknown }
    | { success: false; error: { message: string } };
}

/**
 * Helper to check if a value is a Zod schema
 */
export function isZodSchema(value: unknown): value is ZodSchema {
  return (
    value !== null &&
    typeof value === "object" &&
    "safeParse" in value &&
    typeof (value as ZodSchema).safeParse === "function"
  );
}

// Use a recursive type that avoids circular reference
export type RouterRecord = {
  [key: string]: RouterRecord | Procedure<any, any, any, any>;
};

export type InferProcedureInput<TProcedure> =
  TProcedure extends Procedure<infer TInput, any, any, any> ? TInput : never;

export type InferProcedureOutput<TProcedure> =
  TProcedure extends Procedure<any, infer TOutput, any, any> ? TOutput : never;

export type InferRouterInput<TRouter> = {
  [K in keyof TRouter]: TRouter[K] extends Procedure<any, any, any, any>
    ? InferProcedureInput<TRouter[K]>
    : TRouter[K] extends RouterRecord
      ? InferRouterInput<TRouter[K]>
      : never;
};

export type InferRouterOutput<TRouter> = {
  [K in keyof TRouter]: TRouter[K] extends Procedure<any, any, any, any>
    ? InferProcedureOutput<TRouter[K]>
    : TRouter[K] extends RouterRecord
      ? InferRouterOutput<TRouter[K]>
      : never;
};

export type ProcedureType<TProcedure> =
  TProcedure extends Procedure<any, any, any, infer TType> ? TType : never;

/**
 * Shared hook return types for reuse across the codebase
 */
export type QueryHookReturn<TOutput> = {
  data: TOutput | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};

export type MutationHookReturn<TInput, TOutput> = {
  mutate: (input: TInput) => void;
  mutateAsync: (input: TInput) => Promise<TOutput>;
  isPending: boolean;
  error: Error | null;
};

export type SubscriptionHookReturn<TInput, TOutput, TProgress = unknown> = {
  subscribe: (input?: TInput) => void;
  data: TOutput | undefined;
  progressData: TProgress | undefined;
  status: "idle" | "subscribing" | "active" | "complete" | "error";
  error: Error | null;
  isLoading: boolean;
  unsubscribe: () => void;
};

/**
 * Infer the client type from a procedure based on its type (query/mutation/subscription)
 */
export type InferClientProcedure<TProcedure> =
  TProcedure extends Procedure<infer TInput, infer TOutput, any, infer TType>
    ? TType extends "query"
      ? {
          useQuery: (options?: {
            input?: TInput;
            enabled?: boolean;
          }) => QueryHookReturn<TOutput>;
        }
      : TType extends "mutation"
        ? {
            useMutation: (options?: {
              onSuccess?: (data: TOutput) => void;
              onError?: (error: Error) => void;
            }) => MutationHookReturn<TInput, TOutput>;
          }
        : TType extends "subscription"
          ? {
              useSubscription: (options?: {
                input?: TInput;
                onData?: (data: unknown) => void;
                onComplete?: (data: TOutput) => void;
                onError?: (error: Error) => void;
                enabled?: boolean;
              }) => SubscriptionHookReturn<TInput, TOutput, unknown>;
            }
          : never
    : never;

/**
 * Infer the full client type from a router, recursively handling nested routers
 */
export type InferRpcClient<TRouter> = {
  [K in keyof TRouter]: TRouter[K] extends Procedure<any, any, any, any>
    ? InferClientProcedure<TRouter[K]>
    : TRouter[K] extends RouterRecord
      ? InferRpcClient<TRouter[K]>
      : never;
};

/**
 * Message format for RPC communication
 */
export interface RpcMessage {
  id: string;
  type: "query" | "mutation" | "subscription";
  path: string[];
  input?: unknown;
}

export interface RpcResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: {
    message: string;
    code?: string;
  };
}

export interface RpcSubscriptionUpdate {
  id: string;
  type: "data" | "complete" | "error";
  data?: unknown;
  error?: {
    message: string;
    code?: string;
  };
}
