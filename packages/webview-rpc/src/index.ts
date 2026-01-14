/**
 * @clive/webview-rpc
 *
 * Type-safe RPC system for VS Code webview communication
 */

export * from "./types.js";
export * from "./router.js";
export * from "./procedure.js";
export * from "./transport.js";
export * from "./transports/stdio.js";
export * from "./client.js";
export * from "./hooks.js";

// Re-export RpcSubscriptionMessage for use in handlers
export type { RpcSubscriptionMessage } from "./types.js";

// Re-export types and functions for convenience
export type { RpcHookFactories } from "./client.js";
export { createRpcClient } from "./client.js";
