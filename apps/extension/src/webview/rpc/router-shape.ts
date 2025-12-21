/**
 * Static router shape definition for webview RPC client
 *
 * This file defines the router structure statically to avoid importing
 * the actual router (which pulls in vscode and other Node.js dependencies).
 *
 * IMPORTANT: Keep this in sync with the actual router in src/rpc/router.ts
 */

import type { RouterRecord, Procedure } from "@clive/webview-rpc";

// Helper to create procedure shapes based on type
function createProcedureShape<T extends "query" | "mutation" | "subscription">(
  type: T,
): Procedure<unknown, unknown, unknown, T> {
  return {
    _def: {
      type,
      input: undefined,
      output: undefined,
      context: undefined,
    },
  } as Procedure<unknown, unknown, unknown, T>;
}

/**
 * Static router shape matching AppRouter structure
 * This is used by the webview RPC client to create type-safe hooks
 */
export const routerShape: RouterRecord = {
  status: {
    cypress: createProcedureShape("query"),
    branchChanges: createProcedureShape("query"),
  },
  agents: {
    planTests: createProcedureShape("mutation"),
    generateTest: createProcedureShape("subscription"),
    executeTest: createProcedureShape("mutation"),
    cancelTest: createProcedureShape("mutation"),
    previewDiff: createProcedureShape("mutation"),
  },
  auth: {
    openLogin: createProcedureShape("mutation"),
    openSignup: createProcedureShape("mutation"),
    checkSession: createProcedureShape("query"),
    logout: createProcedureShape("mutation"),
    storeToken: createProcedureShape("mutation"),
  },
  config: {
    getApiKeys: createProcedureShape("query"),
    saveApiKey: createProcedureShape("mutation"),
    deleteApiKey: createProcedureShape("mutation"),
  },
  conversations: {
    start: createProcedureShape("mutation"),
    sendMessage: createProcedureShape("subscription"),
    getHistory: createProcedureShape("query"),
  },
  system: {
    ready: createProcedureShape("query"),
    log: createProcedureShape("mutation"),
    getTheme: createProcedureShape("query"),
  },
};
