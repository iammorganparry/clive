/**
 * TUI RPC Hooks
 *
 * React Query integration for RPC calls in the TUI.
 * Follows the same patterns as the extension's webview hooks.
 */

import type {
  RpcMessage,
  RpcResponse,
  RpcSubscriptionUpdate,
  StdioMessageTransport,
} from "@clive/webview-rpc";
import {
  QueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
  useMutation as useReactMutation,
  useQuery as useReactQuery,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Query client for caching
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000, // Cache for 5 seconds
      refetchOnWindowFocus: false, // Terminal doesn't have window focus events
    },
  },
});

// Pending request storage
const pendingRequests = new Map<
  string,
  {
    resolve: (data: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }
>();

// Subscription handlers
export const subscriptionHandlers = new Map<
  string,
  {
    onData: (data: unknown) => void;
    onComplete: (data: unknown) => void;
    onError: (error: Error) => void;
  }
>();

let messageIdCounter = 0;

export function generateId(): string {
  return `rpc-${Date.now()}-${++messageIdCounter}`;
}

/**
 * Initialize RPC message handling for a transport
 */
export function initializeRpcMessageHandler(
  transport: StdioMessageTransport,
): void {
  // The StdioMessageTransport handles message routing internally
  // This function is provided for API compatibility with the extension
}

/**
 * Create a request function for RPC calls
 */
export function createRequest(
  transport: StdioMessageTransport,
  path: string[] | readonly string[],
  type: "query" | "mutation",
  timeout = 30000,
) {
  return async (input?: unknown): Promise<unknown> => {
    const id = transport.generateId();
    const message: RpcMessage = {
      id,
      type,
      path: [...path],
      input,
    };

    const response = await transport.request(message);
    if (response.success) {
      return response.data;
    }
    throw new Error(response.error?.message || "Unknown error");
  };
}

/**
 * Hook for RPC queries
 */
export function useRpcQuery<TInput, TOutput>(
  transport: StdioMessageTransport,
  path: string[] | readonly string[],
  input?: TInput,
  options?: Omit<UseQueryOptions<TOutput, Error>, "queryKey" | "queryFn">,
) {
  const queryKey = useMemo(() => ["rpc", ...path, input], [path, input]);
  const queryFn = useMemo(
    () => createRequest(transport, path, "query"),
    [transport, path],
  );

  return useReactQuery<TOutput, Error>({
    queryKey,
    queryFn: () => queryFn(input) as Promise<TOutput>,
    ...options,
  });
}

/**
 * Hook for RPC mutations
 */
export function useRpcMutation<TInput, TOutput>(
  transport: StdioMessageTransport,
  path: string[] | readonly string[],
  options?: Omit<UseMutationOptions<TOutput, Error, TInput>, "mutationFn">,
) {
  const mutationFn = useMemo(
    () => createRequest(transport, path, "mutation"),
    [transport, path],
  );

  return useReactMutation<TOutput, Error, TInput>({
    mutationFn: (input: TInput) => mutationFn(input) as Promise<TOutput>,
    ...options,
  });
}

/**
 * Hook for RPC subscriptions
 */
export function useRpcSubscription<TInput, TOutput, TProgress = unknown>(
  transport: StdioMessageTransport,
  path: string[] | readonly string[],
  options?: {
    input?: TInput;
    onData?: (data: TProgress) => void;
    onComplete?: (data: TOutput) => void;
    onError?: (error: Error) => void;
    enabled?: boolean;
  },
) {
  const [status, setStatus] = useState<
    "idle" | "subscribing" | "active" | "complete" | "error"
  >("idle");
  const [data, setData] = useState<TOutput | undefined>();
  const [progressData, setProgressData] = useState<TProgress | undefined>();
  const [error, setError] = useState<Error | null>(null);
  const subscriptionIdRef = useRef<string | null>(null);
  const unsubscribeFnRef = useRef<(() => void) | null>(null);

  // Store callbacks in a ref to avoid stale closures
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const subscribe = useCallback(
    (input?: TInput) => {
      const id = transport.generateId();
      subscriptionIdRef.current = id;
      setStatus("subscribing");
      setError(null);

      const message: RpcMessage = {
        id,
        type: "subscription",
        path: [...path],
        input: input ?? optionsRef.current?.input,
      };

      // Set up subscription handlers
      const unsubscribe = transport.subscribe(
        message,
        (update: RpcSubscriptionUpdate) => {
          if (update.type === "data") {
            setStatus("active");
            setProgressData(update.data as TProgress);
            optionsRef.current?.onData?.(update.data as TProgress);
          } else if (update.type === "complete") {
            setStatus("complete");
            setData(update.data as TOutput);
            optionsRef.current?.onComplete?.(update.data as TOutput);
            subscriptionIdRef.current = null;
            unsubscribeFnRef.current = null;
          } else if (update.type === "error") {
            setStatus("error");
            const err = new Error(update.error?.message || "Unknown error");
            setError(err);
            optionsRef.current?.onError?.(err);
            subscriptionIdRef.current = null;
            unsubscribeFnRef.current = null;
          }
        },
      );

      unsubscribeFnRef.current = unsubscribe;
    },
    [transport, path],
  );

  const unsubscribe = useCallback(() => {
    if (unsubscribeFnRef.current) {
      unsubscribeFnRef.current();
      unsubscribeFnRef.current = null;
      subscriptionIdRef.current = null;
      setStatus("idle");
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeFnRef.current) {
        unsubscribeFnRef.current();
      }
    };
  }, []);

  return {
    subscribe,
    unsubscribe,
    status,
    data,
    progressData,
    error,
    isLoading: status === "subscribing" || status === "active",
    subscriptionId: subscriptionIdRef.current,
  };
}

/**
 * Context for the RPC transport
 */
import { createContext, type ReactNode, useContext } from "react";

interface RpcContextValue {
  transport: StdioMessageTransport | null;
}

const RpcContext = createContext<RpcContextValue>({ transport: null });

export function RpcProvider({
  transport,
  children,
}: {
  transport: StdioMessageTransport | null;
  children: ReactNode;
}) {
  return (
    <RpcContext.Provider value={{ transport }}>{children}</RpcContext.Provider>
  );
}

export function useRpcTransport(): StdioMessageTransport | null {
  const { transport } = useContext(RpcContext);
  return transport;
}
