/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import dotenv from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load environment variables from root .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const rootEnvPath = resolve(__dirname, "../../.env");

dotenv.config({ path: rootEnvPath });

// Import env validation after loading root .env
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
    transpilePackages: [
        "@clive/api",
        "@clive/db",
        "@clive/ui",
        "@clive/validators",
    ],
};

export default config;
