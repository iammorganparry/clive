import type React from "react";
import { createContext, useContext, useMemo, useEffect } from "react";
import type { VSCodeAPI } from "../services/vscode.js";
import {
  useRpcQuery,
  useRpcMutation,
  useRpcSubscription,
  createRpcHookFactories,
  initializeRpcMessageHandler,
} from "./hooks.js";
// Import types - InferRpcClient derives client type from server router
import type { InferRpcClient } from "@clive/webview-rpc";
import { createRpcClient } from "@clive/webview-rpc";
import type { AppRouter } from "./client.js";
import { routerShape } from "./router-shape.js";

/**
 * RPC client type inferred from the backend AppRouter
 * This ensures type safety flows from server to client automatically
 */
type RpcClient = InferRpcClient<AppRouter>;

interface RpcContextValue {
  vscode: VSCodeAPI;
  client: RpcClient;
}

const RpcContext = createContext<RpcContextValue | null>(null);

interface RpcProviderProps {
  vscode: VSCodeAPI;
  children: React.ReactNode;
}

/**
 * Provider component for RPC client
 */
export function RpcProvider({ vscode, children }: RpcProviderProps) {
  const hookFactories = useMemo(() => createRpcHookFactories(), []);

  const client = useMemo(
    () =>
      createRpcClient(
        routerShape,
        vscode,
        hookFactories,
      ) as unknown as RpcClient,
    [vscode, hookFactories],
  );

  // Initialize RPC message handler
  useEffect(() => {
    // No-op fallback handler - RPC messages are handled, non-RPC messages are ignored
    const rpcHandler = initializeRpcMessageHandler(() => {
      // No-op: legacy messages are not handled
    });
    window.addEventListener("message", rpcHandler);

    return () => {
      window.removeEventListener("message", rpcHandler);
    };
  }, []);

  const value = useMemo(() => ({ vscode, client }), [vscode, client]);
  return <RpcContext.Provider value={value}>{children}</RpcContext.Provider>;
}

/**
 * Hook to access the typed RPC client
 */
export function useRpc() {
  const context = useContext(RpcContext);
  if (!context) {
    throw new Error("useRpc must be used within an RpcProvider");
  }
  return context.client;
}

/**
 * Re-export hooks for custom usage
 */
export { useRpcQuery, useRpcMutation, useRpcSubscription };
