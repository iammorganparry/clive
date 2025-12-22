import { db } from "@clive/db/client";
import { Context, Layer } from "effect";

/**
 * DrizzleDB tag - provides access to the Drizzle database client
 * This layer pattern enables dependency injection for testing
 */
export class DrizzleDB extends Context.Tag("DrizzleDB")<
  DrizzleDB,
  typeof db
>() {}

/**
 * Default layer using the actual database client
 */
export const DrizzleDBLive = Layer.succeed(DrizzleDB, db);

/**
 * Type for the database client
 */
export type DrizzleClient = typeof db;
