/**
 * React hooks for RPC client
 * These hooks integrate with React Query for caching and state management
 *
 * Note: This file is for the webview side only. The actual implementation
 * will be in the extension's webview code since it needs React Query.
 */

export interface UseQueryOptions<TInput, TOutput> {
  input?: TInput;
  enabled?: boolean;
}

export interface UseMutationOptions<TOutput> {
  onSuccess?: (data: TOutput) => void;
  onError?: (error: Error) => void;
}

export interface UseSubscriptionOptions<TInput, TOutput> {
  input?: TInput;
  onData?: (data: unknown) => void;
  onComplete?: (data: TOutput) => void;
  onError?: (error: Error) => void;
}

/**
 * These types are exported for use in the webview implementation
 * The actual hook implementations will be in apps/extension/src/webview/rpc/hooks.tsx
 */
export type RpcHookConfig = {
  path: string[];
  type: "query" | "mutation" | "subscription";
  transport: unknown;
};

