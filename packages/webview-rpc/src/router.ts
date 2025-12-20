import type { RouterRecord } from "./types.js";
import { createProcedureBuilder } from "./procedure.js";

/**
 * Create a router with type-safe procedures
 */
export function createRouter<TContext>() {
  return {
    /**
     * Create a router from a record of routes
     */
    router: <T extends RouterRecord>(routes: T): T => routes,

    /**
     * Create a procedure builder
     */
    procedure: createProcedureBuilder<TContext>(),
  };
}

