/**
 * @clive/webview-rpc
 *
 * Type-safe RPC system for VS Code webview communication
 */

// Re-export types and functions for convenience
export type { RpcHookFactories } from "./client.js";
export * from "./client.js";
export { createRpcClient } from "./client.js";
export * from "./hooks.js";
export * from "./procedure.js";
export * from "./router.js";
export * from "./transport.js";
export * from "./transports/stdio.js";
// Re-export RpcSubscriptionMessage for use in handlers
export type { RpcSubscriptionMessage } from "./types.js";
export * from "./types.js";
