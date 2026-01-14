import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.tsx",
    "rpc-server": "src/rpc/server.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  platform: "node",
  banner: {
    // Required for ESM compatibility with certain Node.js features
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
  },
});
