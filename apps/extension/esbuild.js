import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",

  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(
          `    ${location.file}:${location.line}:${location.column}:`,
        );
      });
      console.log("[watch] build finished");
    });
  },
};

async function main() {
  // Build the main extension
  const extensionCtx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: true,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.cjs",
    external: ["vscode"],
    logLevel: "silent",
    define: {
      __DEV__: JSON.stringify(!production),
    },
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
    ],
  });

  // Build the MCP server as a separate ESM bundle
  // This runs as a separate process spawned by Claude CLI
  const mcpServerCtx = await esbuild.context({
    entryPoints: ["src/mcp-server/index.ts"],
    bundle: true,
    format: "esm",
    minify: production,
    sourcemap: true,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/mcp-server.mjs",
    external: ["vscode"], // Exclude vscode - MCP server should not use it directly
    logLevel: "silent",
    banner: {
      // Required for ESM compatibility with certain Node.js features
      js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
    },
    plugins: [esbuildProblemMatcherPlugin],
  });

  if (watch) {
    await Promise.all([extensionCtx.watch(), mcpServerCtx.watch()]);
  } else {
    await Promise.all([extensionCtx.rebuild(), mcpServerCtx.rebuild()]);
    await Promise.all([extensionCtx.dispose(), mcpServerCtx.dispose()]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
