/**
 * React hooks for RPC client
 * These hooks integrate with React Query for caching and state management
 *
 * Note: This file is for the webview side only. The actual implementation
 * will be in the extension's webview code since it needs React Query.
 *
 * Re-export RpcHookFactories from client.ts for convenience
 */
export type { RpcHookFactories } from "./client.js";
