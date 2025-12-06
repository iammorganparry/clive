import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";

// Import env files to validate at build time
// This import will cause env validation to run when the config is loaded
import "./src/env";

const config: NextConfig = {
  /** Enables hot reloading for local packages without a build step */
  transpilePackages: [
    "@clive/api",
    "@clive/auth",
    "@clive/db",
    "@clive/ui",
    "@clive/validators",
  ],

  /** We already do linting and typechecking as separate tasks in CI */
  typescript: { ignoreBuildErrors: true },
};

export default withWorkflow(config);
