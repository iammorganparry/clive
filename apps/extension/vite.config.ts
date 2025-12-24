import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // Load env file from the root of the monorepo (two levels up from vite.config.ts)
  // Vite automatically loads .env files from the project root, but in a monorepo
  // we need to explicitly point to the root directory
  const rootDir = path.resolve(__dirname, "../../");
  const _env = loadEnv(mode, rootDir, "VITE_");

  return {
    plugins: [
      tailwindcss(),
      react(),
      {
        name: "remove-html-output",
        writeBundle(options, bundle) {
          // Remove HTML files and src directory since we generate HTML dynamically
          const outDir = options.dir || "dist/webview";

          // Remove HTML files from bundle
          for (const fileName in bundle) {
            if (fileName.endsWith(".html")) {
              delete bundle[fileName];
            }
          }

          // Clean up any HTML files and src directory that were created
          try {
            const htmlPath = path.join(outDir, "src", "webview", "index.html");
            if (fs.existsSync(htmlPath)) {
              fs.unlinkSync(htmlPath);
              // Remove empty directories
              const srcWebviewDir = path.join(outDir, "src", "webview");
              const srcDir = path.join(outDir, "src");
              if (fs.existsSync(srcWebviewDir)) {
                fs.rmSync(srcWebviewDir, { recursive: true });
              }
              if (fs.existsSync(srcDir)) {
                fs.rmSync(srcDir, { recursive: true });
              }
            }
          } catch (_error) {
            // Ignore cleanup errors
          }
        },
      },
    ],
    build: {
      outDir: "dist/webview",
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: path.resolve(__dirname, "src/webview/index.html"),
        output: {
          format: "iife", // Output as IIFE, not ES module
          chunkFileNames: "webview-[hash]-[name].js",
          entryFileNames: "webview.js",
          assetFileNames: (assetInfo) => {
            if (assetInfo.name?.endsWith(".css")) {
              return "webview.css";
            }
            // Keep original name for other assets
            return assetInfo.name || "asset";
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    // Configure Vite to load .env files from monorepo root
    envDir: rootDir,
    // Explicitly define env variables using the loaded env values
    // This ensures they're available in the built bundle
  };
});
