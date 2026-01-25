import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    // Exclude repository tests that require database mocking at the Effect layer level
    // These are integration tests that should run with a real database
    exclude: [
      "node_modules",
      "dist",
      "src/services/__tests__/conversation-repository.spec.ts",
      "src/services/__tests__/message-repository.spec.ts",
    ],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
