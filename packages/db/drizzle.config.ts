import dotenv from "dotenv";
import type { Config } from "drizzle-kit";

dotenv.config({
  path: "../../.env",
});

if (!process.env.POSTGRES_URL) {
  throw new Error(
    "Missing POSTGRES_URL environment variable. " +
      "Please create a .env file in the root directory with: " +
      "POSTGRES_URL=postgresql://supabase_admin:your-super-secret-and-long-postgres-password@localhost:5432/postgres",
  );
}

// Validate URL format
const postgresUrl = process.env.POSTGRES_URL.trim();
if (
  !postgresUrl.startsWith("postgresql://") &&
  !postgresUrl.startsWith("postgres://")
) {
  throw new Error(
    `Invalid POSTGRES_URL format. Expected postgresql:// or postgres://, got: ${postgresUrl.substring(0, 50)}`,
  );
}

// Try to parse the URL to validate it
let parsedUrl: URL;
try {
  parsedUrl = new URL(postgresUrl);
} catch (error) {
  throw new Error(
    `Failed to parse POSTGRES_URL: ${error instanceof Error ? error.message : String(error)}. ` +
      `URL: ${postgresUrl.substring(0, 50)}...`,
  );
}

// Validate hostname
if (!parsedUrl.hostname || parsedUrl.hostname === "base") {
  throw new Error(
    `Invalid hostname in POSTGRES_URL: "${parsedUrl.hostname}". ` +
      `Expected localhost or a valid hostname. ` +
      `Full URL: ${postgresUrl.substring(0, 80)}...`,
  );
}

// Convert pooling port (6543) to direct connection port (5432) if needed
const nonPoolingUrl = postgresUrl.replace(":6543", ":5432");

export default {
  schema: "./src/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: nonPoolingUrl },
  out: "./drizzle",
  casing: "snake_case",
} satisfies Config;
