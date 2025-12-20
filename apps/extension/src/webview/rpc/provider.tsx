import type React from "react";
import { createContext, useContext, useMemo } from "react";
import type { VSCodeAPI } from "../services/vscode.js";
import {
  useRpcQuery,
  useRpcMutation,
  useRpcSubscription,
  createRpcHookFactories,
  type RpcHookFactories,
} from "./hooks.js";
// Import types - InferRpcClient derives client type from server router
import type {
  RouterRecord,
  InferRpcClient,
  WebviewRpcClient,
} from "@clive/webview-rpc";
import { RpcPaths } from "./client.js";
import type {
  AppRouter,
  StatusCypressOutput,
  BranchChangesOutput,
  PlanTestsInput,
  PlanTestsOutput,
  GenerateTestInput,
  GenerateTestProgress,
  GenerateTestOutput,
} from "./client.js";

/**
 * RPC client type inferred from the backend AppRouter
 * This ensures type safety flows from server to client automatically
 */
type RpcClient = InferRpcClient<AppRouter>;

/**
 * Create RPC client locally (since export isn't working properly)
 */
function createRpcClientLocal<TRouter extends RouterRecord>(
  router: TRouter,
  vscode: VSCodeAPI,
  hookFactories: RpcHookFactories,
): WebviewRpcClient<TRouter> {
  return createClientProxy(
    router,
    vscode,
    hookFactories,
    [],
  ) as WebviewRpcClient<TRouter>;
}

function createClientProxy(
  router: RouterRecord,
  vscode: VSCodeAPI,
  hookFactories: RpcHookFactories,
  path: string[],
): unknown {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string) {
      const value = router[prop];

      // If it's a procedure, return client procedure methods
      if (value && typeof value === "object" && "_def" in value) {
        const currentPath = [...path, prop];

        // Return an object with hook-creating functions
        // These functions will be called by components, which then call the actual hooks
        // Note: hookFactories.useX() returns a function, it doesn't call a hook directly
        return {
          // biome-ignore lint/correctness/useHookAtTopLevel:  We need to return the hook-creating functions
          useQuery: hookFactories.useQuery(currentPath, vscode),
          // biome-ignore lint/correctness/useHookAtTopLevel:  We need to return the hook-creating functions
          useMutation: hookFactories.useMutation(currentPath, vscode),
          // biome-ignore lint/correctness/useHookAtTopLevel:  We need to return the hook-creating functions
          useSubscription: hookFactories.useSubscription(currentPath, vscode),
          /* eslint-enable react-hooks/rules-of-hooks */
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

/**
 * Create a router shape that matches AppRouter structure for client creation
 * This is a lightweight object that matches the router structure without handlers
 */
function createRouterShape(): RouterRecord {
  // Create minimal procedure-like objects that match the router structure
  const createProcedureShape = (
    type: "query" | "mutation" | "subscription",
  ) => ({
    _def: {
      type,
      input: undefined,
      output: undefined,
      context: undefined,
    },
  });

  return {
    status: {
      cypress: createProcedureShape("query"),
      branchChanges: createProcedureShape("query"),
    },
    agents: {
      planTests: createProcedureShape("mutation"),
      generateTest: createProcedureShape("subscription"),
    },
  };
}

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
  const routerShape = useMemo(() => createRouterShape(), []);

  const client = useMemo(
    () =>
      createRpcClientLocal(
        routerShape,
        vscode,
        hookFactories,
      ) as unknown as RpcClient,
    [vscode, hookFactories, routerShape],
  );

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
