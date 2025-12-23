import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useQuery as useReactQuery,
  useMutation as useReactMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";
import type { RpcMessage, RpcHookFactories } from "@clive/webview-rpc";
import type { VSCodeAPI } from "../services/vscode.js";

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
 * Initialize RPC message handling - call this once in your app
 */
export function initializeRpcMessageHandler(
  handleMessage: (event: MessageEvent) => void,
): (event: MessageEvent) => void {
  return (event: MessageEvent) => {
    const data = event.data as Record<string, unknown>;

    // Handle RPC response
    if ("id" in data && "success" in data && typeof data.id === "string") {
      const pending = pendingRequests.get(data.id);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingRequests.delete(data.id);
        if (data.success) {
          pending.resolve(data.data);
        } else {
          pending.reject(
            new Error(
              (data.error as { message?: string })?.message || "Unknown error",
            ),
          );
        }
        return;
      }
    }

    // Handle subscription update
    if (
      "id" in data &&
      "type" in data &&
      typeof data.id === "string" &&
      (data.type === "data" ||
        data.type === "complete" ||
        data.type === "error")
    ) {
      const handler = subscriptionHandlers.get(data.id);
      if (handler) {
        if (data.type === "data") {
          handler.onData(data.data);
        } else if (data.type === "complete") {
          handler.onComplete(data.data);
          subscriptionHandlers.delete(data.id);
        } else if (data.type === "error") {
          handler.onError(
            new Error(
              (data.error as { message?: string })?.message || "Unknown error",
            ),
          );
          subscriptionHandlers.delete(data.id);
        }
        return;
      }
    }

    // Pass to original handler for non-RPC messages
    handleMessage(event);
  };
}

/**
 * Create a request function for RPC calls
 * Exported for use in non-hook contexts (e.g., XState actors)
 */
export function createRequest(
  vscode: VSCodeAPI,
  path: string[] | readonly string[],
  type: "query" | "mutation",
  timeout = 30000,
) {
  return async (input?: unknown): Promise<unknown> => {
    const id = generateId();
    const message: RpcMessage = {
      id,
      type,
      path: [...path],
      input,
    };

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error("Request timeout"));
      }, timeout);

      pendingRequests.set(id, { resolve, reject, timeout: timeoutId });
      vscode.postMessage(message);
    });
  };
}

/**
 * Hook for RPC queries
 */
export function useRpcQuery<TInput, TOutput>(
  vscode: VSCodeAPI,
  path: string[] | readonly string[],
  input?: TInput,
  options?: Omit<UseQueryOptions<TOutput, Error>, "queryKey" | "queryFn">,
) {
  const queryKey = useMemo(() => ["rpc", ...path, input], [path, input]);
  const queryFn = useMemo(
    () => createRequest(vscode, path, "query"),
    [vscode, path],
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
  vscode: VSCodeAPI,
  path: string[] | readonly string[],
  options?: Omit<UseMutationOptions<TOutput, Error, TInput>, "mutationFn">,
) {
  const mutationFn = useMemo(
    () => createRequest(vscode, path, "mutation"),
    [vscode, path],
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
  vscode: VSCodeAPI,
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

  // Store callbacks in a ref to avoid stale closures
  // Update ref on every render to always have latest callbacks
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const subscribe = useCallback(
    (input?: TInput) => {
      const id = generateId();
      subscriptionIdRef.current = id;
      setStatus("subscribing");
      setError(null);

      const message: RpcMessage = {
        id,
        type: "subscription",
        path: [...path],
        input: input ?? optionsRef.current?.input,
      };

      subscriptionHandlers.set(id, {
        onData: (progressValue: unknown) => {
          setStatus("active");
          setProgressData(progressValue as TProgress);
          optionsRef.current?.onData?.(progressValue as TProgress);
        },
        onComplete: (result: unknown) => {
          setStatus("complete");
          setData(result as TOutput);
          optionsRef.current?.onComplete?.(result as TOutput);
          subscriptionIdRef.current = null;
        },
        onError: (err: Error) => {
          setStatus("error");
          setError(err);
          optionsRef.current?.onError?.(err);
          subscriptionIdRef.current = null;
        },
      });

      vscode.postMessage(message);
    },
    [vscode, path],
  );

  const unsubscribe = useCallback(() => {
    if (subscriptionIdRef.current) {
      const id = subscriptionIdRef.current;
      subscriptionHandlers.delete(id);

      // Send unsubscribe message
      const message: RpcMessage = {
        id,
        type: "subscription",
        path: [...path],
        input: { _unsubscribe: true },
      };
      vscode.postMessage(message);

      subscriptionIdRef.current = null;
      setStatus("idle");
    }
  }, [vscode, path]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (subscriptionIdRef.current) {
        subscriptionHandlers.delete(subscriptionIdRef.current);
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
  };
}

/**
 * Create hook factories for use with createRpcClient
 * These factories return functions that, when called, return hooks
 */
export function createRpcHookFactories(): RpcHookFactories<VSCodeAPI> {
  return {
    useQuery: <TInput, TOutput>(path: string[], vscode: VSCodeAPI) => {
      return (options?: {
        input?: TInput;
        enabled?: boolean;
        refetchInterval?: number | false;
      }) => {
        const result = useRpcQuery<TInput, TOutput>(
          vscode,
          path,
          options?.input,
          {
            enabled: options?.enabled,
            refetchInterval: options?.refetchInterval,
          },
        );
        // Narrow down to match the interface
        return {
          data: result.data as TOutput | undefined,
          isLoading: result.isLoading,
          error: result.error,
          refetch: result.refetch,
        };
      };
    },

    useMutation: <TInput, TOutput>(path: string[], vscode: VSCodeAPI) => {
      return (options?: {
        onSuccess?: (data: TOutput) => void;
        onError?: (error: Error) => void;
      }) => {
        const mutation = useRpcMutation<TInput, TOutput>(vscode, path, options);
        return {
          mutate: mutation.mutate,
          mutateAsync: mutation.mutateAsync,
          isPending: mutation.isPending,
          error: mutation.error,
        };
      };
    },

    useSubscription: <TInput, TOutput, TProgress = unknown>(
      path: string[],
      vscode: VSCodeAPI,
    ) => {
      return (options?: {
        input?: TInput;
        onData?: (data: TProgress) => void;
        onComplete?: (data: TOutput) => void;
        onError?: (error: Error) => void;
        enabled?: boolean;
      }) => {
        const subscription = useRpcSubscription<TInput, TOutput, TProgress>(
          vscode,
          path,
          {
            input: options?.input,
            onData: options?.onData,
            onComplete: options?.onComplete,
            onError: options?.onError,
            enabled: options?.enabled,
          },
        );
        return {
          subscribe: subscription.subscribe,
          data: subscription.data,
          progressData: subscription.progressData,
          status: subscription.status,
          error: subscription.error,
          isLoading: subscription.isLoading,
          unsubscribe: subscription.unsubscribe,
        };
      };
    },
  };
}
