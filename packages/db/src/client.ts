import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL or POSTGRES_URL must be set");
}

const client = postgres(connectionString);

export const db = drizzle(client, {
  schema,
  casing: "snake_case",
});
