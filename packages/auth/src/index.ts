import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "@clive/db/client";
import * as schema from "@clive/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import {
  bearer,
  deviceAuthorization,
  jwt,
  organization,
} from "better-auth/plugins";
import dotenv from "dotenv";

// Load environment variables from root .env file
// From packages/auth/src/index.ts, go up 3 levels to reach root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({
  path: resolve(__dirname, "../../../.env"),
});

const githubClientId = process.env.GITHUB_CLIENT_ID;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
const betterAuthSecret = process.env.BETTER_AUTH_SECRET;

if (!githubClientId || !githubClientSecret) {
  throw new Error(
    "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set in environment variables",
  );
}

if (!betterAuthSecret) {
  console.warn(
    "[Auth] BETTER_AUTH_SECRET not set - JWT token validation may fail",
  );
}

export const auth = betterAuth({
  secret: betterAuthSecret,
  logger: {
    level: "warn", // Only show warnings and actual errors
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  /**
   * @contract BetterAuth.github
   * @see contracts/system.md#BetterAuth.github
   */
  socialProviders: {
    github: {
      clientId: githubClientId,
      clientSecret: githubClientSecret,
    },
  },
  plugins: [
    /**
     * @contract BetterAuth.jwt
     * @see contracts/system.md#BetterAuth.jwt
     */
    nextCookies(),
    jwt(),
    bearer(),
    /**
     * @contract BetterAuth.organization
     * @see contracts/system.md#BetterAuth.organization
     */
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: "owner",
      membershipLimit: 100,
    }),
    /**
     * @contract BetterAuth.deviceAuthorization
     * @see contracts/system.md#BetterAuth.deviceAuthorization
     */
    deviceAuthorization({
      verificationUri: "/device",
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
