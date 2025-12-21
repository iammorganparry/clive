/**
 * RPC client configuration and types for the webview
 *
 * This module provides the client-side types and utilities for
 * communicating with the extension's RPC router.
 */

import type { AppRouter } from "../../rpc/router.js";
import type { InferRouterInput, InferRouterOutput } from "@clive/webview-rpc";

/**
 * Re-export the router type for use in the webview
 */
export type { AppRouter };

/**
 * Infer all input types from the router
 * Usage: RouterInput["status"]["cypress"] for specific procedure input
 */
export type RouterInput = InferRouterInput<AppRouter>;

/**
 * Infer all output types from the router
 * Usage: RouterOutput["status"]["cypress"] for specific procedure output
 */
export type RouterOutput = InferRouterOutput<AppRouter>;
