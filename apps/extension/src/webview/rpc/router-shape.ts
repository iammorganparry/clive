/**
 * Router shape definition for webview RPC client
 *
 * This file dynamically generates the router shape from the actual appRouter
 * to ensure it stays in sync with the router implementation.
 *
 * The routerShape export is kept for backwards compatibility,
 * but inferredRouterShape is now the source of truth.
 */

import type { RouterRecord, Procedure } from "@clive/webview-rpc";
import { appRouter } from "../../rpc/router.js";

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
 * Check if a value is a Procedure (has _def.type)
 */
const isProcedure = (
  value: unknown,
): value is Procedure<
  unknown,
  unknown,
  unknown,
  "query" | "mutation" | "subscription"
> => {
  return (
    value !== null &&
    typeof value === "object" &&
    "_def" in value &&
    typeof (value as { _def?: { type?: string } })._def === "object" &&
    (value as { _def?: { type?: string } })._def !== null &&
    typeof (value as { _def: { type: string } })._def.type === "string"
  );
};

/**
 * Dynamically create a router shape from a RouterRecord
 * Recursively processes nested routers and extracts procedure types
 */
export const createRouterShape = (router: RouterRecord): RouterRecord => {
  return Object.fromEntries(
    Object.entries(router).map(([key, value]) => {
      // If it's a procedure, extract the type and create a procedure shape
      if (isProcedure(value)) {
        const procedureType = value._def.type as
          | "query"
          | "mutation"
          | "subscription";
        return [key, createProcedureShape(procedureType)];
      }
      // Otherwise, it's a nested router - recursively process it
      return [key, createRouterShape(value as RouterRecord)];
    }),
  ) as RouterRecord;
};

/**
 * Dynamically inferred router shape based on the actual appRouter
 * This ensures the router shape stays in sync with the router implementation
 */
export const routerShape = createRouterShape(appRouter);
